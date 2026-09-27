import { encodeWav } from './audio';

/**
 * Records THIS page's own sound — the song playing in the built-in YouTube player. Chrome asks once to
 * "share this tab"; the share stays open between takes so recording again never asks twice.
 */
export class PageRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private meterBuffer = new Float32Array(2048);
  recording = false;
  seconds = 0;
  /** Loudest level of the current take (stays ~0 if nothing audible is being recorded). */
  peak = 0;

  static supported(): boolean {
    return Boolean(navigator.mediaDevices?.getDisplayMedia) && 'AudioContext' in window;
  }

  get connected(): boolean {
    return this.stream !== null && this.stream.getAudioTracks().some(track => track.readyState === 'live');
  }

  async connect(): Promise<void> {
    this.close();
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: { displaySurface: 'browser' },
      ...({ preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'exclude', surfaceSwitching: 'exclude' } as object)
    } as DisplayMediaStreamOptions);
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stream.getTracks().forEach(item => item.stop());
      throw new Error('No audio was shared. Choose “This tab” and keep “Share tab audio” switched on.');
    }
    const ctx = new AudioContext();
    await ctx.resume();
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.processor = ctx.createScriptProcessor(4096, 2, 1);
    this.processor.onaudioprocess = event => {
      if (!this.recording) return;
      const input = event.inputBuffer;
      const mono = new Float32Array(input.length);
      for (let c = 0; c < input.numberOfChannels; c += 1) {
        const data = input.getChannelData(c);
        for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / input.numberOfChannels;
      }
      let energy = 0;
      for (let i = 0; i < mono.length; i += 1) energy += mono[i] * mono[i];
      this.peak = Math.max(this.peak, Math.min(1, Math.sqrt(energy / mono.length) * 6));
      this.chunks.push(mono);
      this.seconds += input.length / input.sampleRate;
    };
    const silent = ctx.createGain();
    silent.gain.value = 0; // the page already plays the song; nothing is played twice
    source.connect(this.analyser);
    source.connect(this.processor).connect(silent).connect(ctx.destination);
    // If the share is ended from Chrome's "Stop sharing" bar, the next Record asks again.
    track.addEventListener('ended', () => { if (this.stream === stream) this.close(); });
    this.ctx = ctx;
    this.stream = stream;
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
    if (this.processor) this.processor.onaudioprocess = null;
    this.processor = null;
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
