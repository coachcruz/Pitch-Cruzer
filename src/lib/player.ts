import type { SongBuffers } from './prepare';
import { outputDelay } from './sync';

/** A stretch of the song. `turn: true` = Echo practice: the singer's turn, played silently. */
export interface Range { start: number; end: number; turn?: boolean }
export interface TimelinePiece { timelineStart: number; sourceStart: number; duration: number; turn: boolean }

/** Backing vocals play through the "music" channel: the singer is the only voice you control separately. */
export type StemName = 'lead' | 'music' | 'voice';

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

  pieceAt(t: number): TimelinePiece | null {
    return this.pieces.find(piece => t >= piece.timelineStart && t < piece.timelineStart + piece.duration) ?? null;
  }

  sourceTimeAt(t: number): number | null {
    const piece = this.pieceAt(t);
    return piece ? piece.sourceStart + (t - piece.timelineStart) : null;
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
 * Cuts the song stretch [from, from + duration) at the edges of `ranges`: returns the pieces as
 * [start, end, inside] in song time. Used to route a duet partner's lines differently.
 */
export function splitByRanges(from: number, duration: number, ranges: Range[]): Array<[number, number, boolean]> {
  const end = from + duration;
  const pieces: Array<[number, number, boolean]> = [];
  let cursor = from;
  for (const range of ranges.filter(item => item.end > from && item.start < end).sort((a, b) => a.start - b.start)) {
    const a = Math.max(range.start, cursor), b = Math.min(range.end, end);
    if (a > cursor) pieces.push([cursor, a, false]);
    if (b > a) pieces.push([a, b, true]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < end) pieces.push([cursor, end, false]);
  return pieces;
}

/**
 * Plays any list of song ranges back-to-back (with repeats) with all stems perfectly in sync,
 * and maps "time since play" back to "time in the original song" for lyrics and the pitch lane.
 */
export class Player {
  readonly ctx: AudioContext;
  readonly gains: Record<StemName, GainNode>;
  /** Duet: the original singer on your partner's lines, always at full volume. */
  private partnerLead: GainNode;
  private sources: AudioBufferSourceNode[] = [];
  timeline: Timeline = new Timeline([], 1);
  private originAt = 0;
  private endTimer: number | null = null;
  state: 'stopped' | 'playing' | 'paused' = 'stopped';
  totalDuration = 0;
  onEnded: (() => void) | null = null;

  constructor(private buffers: SongBuffers) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const gain = () => { const node = this.ctx.createGain(); node.connect(this.ctx.destination); return node; };
    this.gains = { lead: gain(), music: this.ctx.createGain(), voice: gain() };
    this.partnerLead = gain();
    // Bass/treble EQ for the background track: music gain -> bass shelf -> treble shelf -> speakers.
    this.eqBass = this.ctx.createBiquadFilter();
    this.eqBass.type = 'lowshelf';
    this.eqBass.frequency.value = 200;
    this.eqTreble = this.ctx.createBiquadFilter();
    this.eqTreble.type = 'highshelf';
    this.eqTreble.frequency.value = 3000;
    this.gains.music.connect(this.eqBass);
    this.eqBass.connect(this.eqTreble);
    this.eqTreble.connect(this.ctx.destination);
    // Silent taps for the level meters: the artist (both singer paths) and the music.
    const tap = (...sources: AudioNode[]) => {
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 1024;
      for (const source of sources) source.connect(analyser);
      return analyser;
    };
    this.taps = { artist: tap(this.gains.lead, this.partnerLead), music: tap(this.gains.music) };
  }

  private taps: { artist: AnalyserNode; music: AnalyserNode };
  private tapBuffer = new Float32Array(1024);
  /** Bass/treble shelves on the background track (the music meter taps pre-EQ, so it still shows the track's level). */
  private eqBass: BiquadFilterNode;
  private eqTreble: BiquadFilterNode;

  /** How loud the artist or the music is right now, 0..1 (for the level meters). */
  level(which: 'artist' | 'music'): number {
    if (this.state !== 'playing') return 0;
    this.taps[which].getFloatTimeDomainData(this.tapBuffer);
    let sum = 0;
    for (const sample of this.tapBuffer) sum += sample * sample;
    return Math.min(1, Math.sqrt(sum / this.tapBuffer.length) * 4);
  }

  setLevel(stem: StemName, value: number): void {
    const gain = this.gains[stem].gain;
    gain.cancelScheduledValues(this.ctx.currentTime);   // a change planned ahead (see handOver) gives way
    gain.setTargetAtTime(Math.max(0, value), this.ctx.currentTime, 0.02);
  }

  /** Bass/treble EQ on the background track, in dB (±12). Smooth, so it can move while playing. */
  setEQ(bassDb: number, trebleDb: number): void {
    const clamp = (db: number) => Math.max(-12, Math.min(12, db));
    const t = this.ctx.currentTime;
    this.eqBass.gain.setTargetAtTime(clamp(bassDb), t, 0.02);
    this.eqTreble.gain.setTargetAtTime(clamp(trebleDb), t, 0.02);
  }

  /** Plays `stem` at full level until clock time `at`, then fades it out (50 ms): the artist hands over to you. */
  handOver(stem: StemName, at: number): void {
    const gain = this.gains[stem].gain;
    const now = this.ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(1, now);
    gain.setValueAtTime(1, Math.max(now, at - 0.05));
    gain.linearRampToValueAtTime(0, Math.max(now + 0.01, at));
  }

  /**
   * Builds the timeline for the given ranges and starts playing at `from` seconds into it.
   * `voice`: a recorded take to play along (review). `model`: Echo practice with your own best take as the guide. For each listen piece, `locate`
   * returns where in the take's audio that song moment was sung (or null → the artist sings it).
   * `partner`: duet — song stretches sung by your partner, where the original singer stays at full volume.
   */
  async play(ranges: Range[], repeats: number, options: {
    from?: number; leadIn?: number;
    voice?: { buffer: AudioBuffer; offset: number };
    model?: { buffer: AudioBuffer; locate: (sourceTime: number) => number | null };
    partner?: Range[];
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
      [this.buffers.backing, this.gains.music],
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
      for (const [start, end, partner] of splitByRanges(piece.sourceStart + skip, duration, options.partner ?? [])) {
        this.schedule(this.buffers.lead, partner ? this.partnerLead : this.gains.lead, when + start - (piece.sourceStart + skip), start, end - start);
      }
      for (const [buffer, gain] of stems.slice(1)) this.schedule(buffer, gain, when, piece.sourceStart + skip, duration);
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

  /**
   * Where in the timeline the sound you're hearing right now is. The audio clock runs ahead of the
   * speakers by the output delay (tiny on wired headphones, ~0.2 s on Bluetooth), so the lyrics, the
   * notes and the count-in follow what you hear, not what was just handed to the sound card.
   */
  timelineTime(): number {
    if (this.state === 'stopped') return 0;
    // Bluetooth headphones can be a quarter second late — measured by the Sync check when the browser can't say.
    return this.ctx.currentTime - outputDelay(this.ctx) - this.originAt;
  }

  /** Where in the original song the timeline position `t` is (null during lead-in/after the end). */
  sourceTimeAt(t: number): number | null { return this.timeline.sourceTimeAt(t); }

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
