import { encodeWav } from './audio';

/**
 * Records THIS page's own sound — the song playing in the built-in YouTube player. Chrome asks once to
 * "share this tab"; the share stays open between takes so recording again never asks twice.
 *
 * Kept light so the video plays smoothly while recording: the sound is collected on the audio thread
 * (an AudioWorklet — nothing is lost if the page is busy), and the tab's picture, which isn't needed,
 * is shared at 1 frame per second at thumbnail size. While the video buffers or pauses the recording
 * holds, so a stall never ends up in the song.
 */
const COLLECTOR = `registerProcessor('collect', class extends AudioWorkletProcessor {
  constructor() { super(); this.block = new Float32Array(4096); this.filled = 0; }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      for (let i = 0; i < input[0].length; i += 1) {
        let sum = 0;
        for (const channel of input) sum += channel[i];
        this.block[this.filled++] = sum / input.length;
        if (this.filled === this.block.length) {
          this.port.postMessage(this.block, [this.block.buffer]);
          this.block = new Float32Array(4096);
          this.filled = 0;
        }
      }
    }
    return true;
  }
});`;

export class PageRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private collector: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
  private meterBuffer = new Float32Array(2048);
  recording = false;
  private held = false;
  seconds = 0;
  /** Loudest level of the current take (stays ~0 if nothing audible is being recorded). */
  peak = 0;

  static supported(): boolean {
    return Boolean(navigator.mediaDevices?.getDisplayMedia) && 'AudioContext' in window;
  }

  /**
   * Can this browser share a tab's sound? Only Chrome, Edge and other Chromium browsers on a computer.
   * Safari (Mac or iPhone), Firefox and phones can open a share but never with the tab's sound — so
   * they're told up front instead of finding out from a silent recording.
   */
  static canShareTabAudio(): boolean {
    if (!PageRecorder.supported()) return false;
    const data = (navigator as { userAgentData?: { mobile?: boolean; brands?: Array<{ brand: string }> } }).userAgentData;
    if (data) return !data.mobile && (data.brands ?? []).some(item => /Chromium|Google Chrome|Microsoft Edge/.test(item.brand));
    return /Chrome\/|Edg\//.test(navigator.userAgent) && !/Mobile|Android|iPhone|iPad/.test(navigator.userAgent);
  }

  get connected(): boolean {
    return this.stream !== null && this.stream.getAudioTracks().some(track => track.readyState === 'live');
  }

  async connect(): Promise<void> {
    this.close();
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      // The picture isn't used: as small and slow as possible so it costs the video nothing.
      video: { displaySurface: 'browser', frameRate: { max: 1 }, width: { max: 320 }, height: { max: 240 } },
      ...({ preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'exclude', surfaceSwitching: 'exclude' } as object)
    } as DisplayMediaStreamOptions);
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stream.getTracks().forEach(item => item.stop());
      throw new Error('That share had no sound: “Also share tab audio” was off, or a window or screen was picked instead of this tab.');
    }
    const ctx = new AudioContext();
    await ctx.resume();
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    const moduleUrl = URL.createObjectURL(new Blob([COLLECTOR], { type: 'text/javascript' }));
    try { await ctx.audioWorklet.addModule(moduleUrl); } finally { URL.revokeObjectURL(moduleUrl); }
    this.collector = new AudioWorkletNode(ctx, 'collect');
    this.collector.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (!this.recording || this.hold) return;
      const mono = event.data;
      let energy = 0;
      for (let i = 0; i < mono.length; i += 1) energy += mono[i] * mono[i];
      this.peak = Math.max(this.peak, Math.min(1, Math.sqrt(energy / mono.length) * 6));
      this.chunks.push(mono);
      this.seconds += mono.length / ctx.sampleRate;
    };
    const silent = ctx.createGain();
    silent.gain.value = 0; // the page already plays the song; nothing is played twice
    source.connect(this.analyser);
    source.connect(this.collector).connect(silent).connect(ctx.destination);
    // If the share is ended from Chrome's "Stop sharing" bar, the next Record asks again.
    track.addEventListener('ended', () => { if (this.stream === stream) this.close(); });
    this.ctx = ctx;
    this.stream = stream;
  }

  /**
   * True while the video is buffering or paused: nothing is captured (see the class comment). The
   * silence recorded just before the player reported the stall (up to 1 s) is dropped too.
   */
  get hold(): boolean { return this.held; }
  set hold(value: boolean) {
    if (value && !this.held && this.recording) {
      const rate = this.ctx?.sampleRate ?? 48000;
      let dropped = 0;
      while (this.chunks.length && dropped < rate) {
        const last = this.chunks[this.chunks.length - 1];
        let loudest = 0;
        for (let i = 0; i < last.length; i += 16) loudest = Math.max(loudest, Math.abs(last[i]));
        if (loudest > 0.01) break;
        this.chunks.pop();
        dropped += last.length;
      }
      this.seconds -= dropped / rate;
    }
    this.held = value;
  }

  /** Current level 0..1 (a silent meter). */
  level(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.meterBuffer);
    let energy = 0;
    for (let i = 0; i < this.meterBuffer.length; i += 1) energy += this.meterBuffer[i] * this.meterBuffer[i];
    return Math.min(1, Math.sqrt(energy / this.meterBuffer.length) * 6);
  }

  start(): void {
    this.reset();
    this.held = false;
    this.recording = true;
  }

  /** Throws away what was captured so far and keeps recording. */
  reset(): void {
    this.chunks = [];
    this.seconds = 0;
    this.peak = 0;
  }

  /**
   * Stops recording (the share stays open) and returns the audio, or null if nothing audible, plus a
   * suggested trim that cuts silence at both ends.
   */
  stop(): Recording | null {
    this.recording = false;
    const rate = this.ctx?.sampleRate ?? 48000;
    const length = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (length < rate) { this.chunks = []; return null; }
    const samples = new Float32Array(length);
    let offset = 0;
    let peak = 0;
    for (const chunk of this.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
      for (let i = 0; i < chunk.length; i += 64) peak = Math.max(peak, Math.abs(chunk[i]));
    }
    this.chunks = [];
    if (peak < 0.002) return null;
    const threshold = 0.01;
    let start = 0, end = samples.length;
    while (start < end && Math.abs(samples[start]) < threshold) start += 1;
    while (end > start && Math.abs(samples[end - 1]) < threshold) end -= 1;
    start = Math.max(0, start - Math.round(rate * 0.25));
    end = Math.min(samples.length, end + Math.round(rate * 0.5));
    return { samples, sampleRate: rate, suggestedStart: start / rate, suggestedEnd: end / rate };
  }

  /** Ends the share and releases the audio engine. */
  close(): void {
    this.recording = false;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    if (this.collector) this.collector.port.onmessage = null;
    this.collector?.disconnect();
    this.collector = null;
    this.analyser = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.chunks = [];
  }
}

/** Plain-words reason a share failed. */
export function shareErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError') return 'Sharing was cancelled. Press Record again and choose “This tab” with “Share tab audio” on.';
  if (name === 'NotSupportedError' || name === 'TypeError') return 'This browser can’t record here. Use Chrome or Edge on a computer — or download the song and upload the file.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The browser couldn’t start sharing. Close other screen-sharing apps and try again.';
  return error instanceof Error ? error.message : 'Couldn’t start recording.';
}

export interface Recording { samples: Float32Array<ArrayBuffer>; sampleRate: number; suggestedStart: number; suggestedEnd: number }

/** WAV file of just the kept part of a recording. */
export function trimmedWav(recording: Recording, start: number, end: number): Blob {
  const from = Math.max(0, Math.floor(start * recording.sampleRate));
  const to = Math.min(recording.samples.length, Math.ceil(end * recording.sampleRate));
  return encodeWav([recording.samples.subarray(from, Math.max(from + 1, to))], recording.sampleRate);
}
