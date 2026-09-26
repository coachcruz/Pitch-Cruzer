import type { SongBuffers } from './prepare';

/** A stretch of the song. `turn: true` = Echo practice: the singer's turn, played silently. */
export interface Range { start: number; end: number; turn?: boolean }
export interface TimelinePiece { timelineStart: number; sourceStart: number; duration: number; turn: boolean }

export type StemName = 'lead' | 'backing' | 'music' | 'voice';

/** Lays the chosen ranges end to end (with repeats) and maps timeline time ↔ song time. */
export class Timeline {
  readonly pieces: TimelinePiece[] = [];
  readonly duration: number;

  constructor(ranges: Range[], repeats: number) {
    let cursor = 0;
    for (let r = 0; r < Math.max(1, repeats); r += 1) {
      for (const range of ranges) {
        const duration = Math.max(0, range.end - range.start);
        if (duration > 0.05) this.pieces.push({ timelineStart: cursor, sourceStart: range.start, duration, turn: Boolean(range.turn) });
        cursor += duration;
      }
    }
    this.duration = cursor;
  }

  sourceTimeAt(t: number): number | null {
    for (const piece of this.pieces) {
      if (t >= piece.timelineStart && t < piece.timelineStart + piece.duration) return piece.sourceStart + (t - piece.timelineStart);
    }
    return null;
  }

  pieceAt(t: number): TimelinePiece | null {
    return this.pieces.find(piece => t >= piece.timelineStart && t < piece.timelineStart + piece.duration) ?? null;
  }

  /** Echo practice timelines have silent "your turn" pieces; only those are scored. */
  get hasTurns(): boolean { return this.pieces.some(piece => piece.turn); }

  timelineFor(sourceTime: number): number | null {
    for (const piece of this.pieces) {
      if (sourceTime >= piece.sourceStart && sourceTime < piece.sourceStart + piece.duration) return piece.timelineStart + sourceTime - piece.sourceStart;
    }
    return null;
  }
}

/**
 * Plays any list of song ranges back-to-back (with repeats) with all stems perfectly in sync,
 * and maps "time since play" back to "time in the original song" for lyrics and the pitch lane.
 */
export class Player {
  readonly ctx: AudioContext;
  readonly gains: Record<StemName, GainNode>;
  private sources: AudioBufferSourceNode[] = [];
  timeline: Timeline = new Timeline([], 1);
  private originAt = 0;
  private endTimer: number | null = null;
  state: 'stopped' | 'playing' | 'paused' = 'stopped';
  totalDuration = 0;
  onEnded: (() => void) | null = null;

  constructor(public buffers: SongBuffers) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const gain = () => { const node = this.ctx.createGain(); node.connect(this.ctx.destination); return node; };
    this.gains = { lead: gain(), backing: gain(), music: gain(), voice: gain() };
  }

  setLevel(stem: StemName, value: number): void {
    this.gains[stem].gain.setTargetAtTime(Math.max(0, value), this.ctx.currentTime, 0.02);
  }

  /** Builds the timeline for the given ranges and starts playing at `from` seconds into it. */
  /**
   * `model`: Echo practice with your own best take as the guide. For each listen piece, `locate`
   * returns where in the take's audio that song moment was sung (or null → the artist sings it).
   */
  async play(ranges: Range[], repeats: number, options: {
    from?: number; leadIn?: number;
    voice?: { buffer: AudioBuffer; offset: number };
    model?: { buffer: AudioBuffer; locate: (sourceTime: number) => number | null };
  } = {}): Promise<number> {
    this.stop(false);
    if (this.ctx.state !== 'running') await this.ctx.resume();

    this.timeline = new Timeline(ranges, repeats);
    const cursor = this.timeline.duration;
    this.totalDuration = cursor;
    const from = Math.max(0, Math.min(options.from ?? 0, cursor - 0.05));
    const leadIn = options.leadIn ?? 0.08;
    this.originAt = this.ctx.currentTime + leadIn - from;

    const stems: Array<[AudioBuffer | null, GainNode]> = [
      [this.buffers.lead, this.gains.lead],
      [this.buffers.backing, this.gains.backing],
      [this.buffers.instrumental, this.gains.music]
    ];
    for (const piece of this.timeline.pieces) {
      const pieceEnd = piece.timelineStart + piece.duration;
      if (pieceEnd <= from) continue;
      const skip = Math.max(0, from - piece.timelineStart);
      const when = this.originAt + piece.timelineStart + skip;
      const duration = piece.duration - skip;
      if (piece.turn) continue; // Echo practice: silence while the singer sings it back
      const modelAt = options.model ? options.model.locate(piece.sourceStart + skip) : null;
      if (options.model && modelAt !== null && modelAt >= 0 && modelAt + duration <= options.model.buffer.duration + 0.5) {
        // Your own voice replaces the artist's; the music keeps playing underneath.
        this.schedule(options.model.buffer, this.gains.voice, when, modelAt, duration);
        for (const [buffer, gain] of stems.slice(1)) this.schedule(buffer, gain, when, piece.sourceStart + skip, duration);
        continue;
      }
      for (const [buffer, gain] of stems) this.schedule(buffer, gain, when, piece.sourceStart + skip, duration);
    }
    if (options.voice) {
      const voiceStart = this.originAt + options.voice.offset;
      const skip = Math.max(0, this.ctx.currentTime + leadIn - voiceStart);
      this.schedule(options.voice.buffer, this.gains.voice, voiceStart + skip, skip, options.voice.buffer.duration - skip, false);
    }

    this.state = 'playing';
    this.armEndTimer();
    return this.originAt;
  }

  private schedule(buffer: AudioBuffer | null, gain: GainNode, when: number, offset: number, duration: number, fade = true): void {
    if (!buffer || duration <= 0.01 || offset >= buffer.duration) return;
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    const safe = Math.min(duration, buffer.duration - offset);
    if (fade) {
      // 8 ms fades stop clicks where sections are stitched together.
      const envelope = this.ctx.createGain();
      envelope.gain.setValueAtTime(0, when);
      envelope.gain.linearRampToValueAtTime(1, when + 0.008);
      envelope.gain.setValueAtTime(1, when + Math.max(0.008, safe - 0.008));
      envelope.gain.linearRampToValueAtTime(0, when + safe);
      node.connect(envelope).connect(gain);
    } else node.connect(gain);
    node.start(Math.max(this.ctx.currentTime, when), offset, safe);
    this.sources.push(node);
  }

  private armEndTimer(): void {
    if (this.endTimer !== null) window.clearTimeout(this.endTimer);
    const remaining = this.originAt + this.totalDuration - this.ctx.currentTime;
    this.endTimer = window.setTimeout(() => {
      if (this.state !== 'playing') return;
      if (this.timelineTime() < this.totalDuration - 0.05) { this.armEndTimer(); return; }
      this.stop(true);
    }, Math.max(50, remaining * 1000 + 60));
  }

  timelineTime(): number {
    return this.state === 'stopped' ? 0 : this.ctx.currentTime - this.originAt;
  }

  /** Where in the original song the timeline position `t` is (null during lead-in/after the end). */
  sourceTimeAt(t: number): number | null { return this.timeline.sourceTimeAt(t); }

  get origin(): number { return this.originAt; }

  async pause(): Promise<void> {
    if (this.state !== 'playing') return;
    await this.ctx.suspend();
    this.state = 'paused';
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    await this.ctx.resume();
    this.state = 'playing';
    this.armEndTimer();
  }

  stop(notify = true): void {
    for (const node of this.sources) { try { node.stop(); } catch { /* already stopped */ } }
    this.sources = [];
    if (this.endTimer !== null) window.clearTimeout(this.endTimer);
    this.endTimer = null;
    const wasActive = this.state !== 'stopped';
    this.state = 'stopped';
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (notify && wasActive) this.onEnded?.();
  }

  close(): void {
    this.stop(false);
    void this.ctx.close();
  }
}
