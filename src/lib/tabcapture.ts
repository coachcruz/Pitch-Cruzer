import { encodeWav } from './audio';

/**
 * Records the audio of another browser tab (YouTube, Spotify, Apple Music, …) while it plays.
 * Chrome/Edge show a picker; the user picks the tab and leaves "Share tab audio" on.
 */
export class TabRecorder {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  level = 0;
  seconds = 0;
  /** Loudest level heard so far — stays ~0 if the tab is silent or tab audio wasn't shared. */
  peak = 0;
  onEnded: (() => void) | null = null;

  static supported(): boolean {
    return Boolean(navigator.mediaDevices?.getDisplayMedia) && 'AudioContext' in window;
  }

  async start(): Promise<void> {
    const capture = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      // Chrome hints: prefer tabs, keep the page's own audio out of the capture.
      ...({ preferCurrentTab: false, selfBrowserSurface: 'exclude', systemAudio: 'include' } as object)
    } as DisplayMediaStreamOptions);
    const audio = capture.getAudioTracks()[0];
    if (!audio) {
      capture.getTracks().forEach(track => track.stop());
      throw new Error('No audio was shared. Pick a browser TAB and make sure “Share tab audio” is switched on.');
    }
    // Keep the (unused) video track running: in some Chrome versions stopping it ends the whole share.
    this.stream = capture;
    this.peak = 0;
    this.ctx = new AudioContext();
    await this.ctx.resume();
    const source = this.ctx.createMediaStreamSource(new MediaStream([audio]));
    this.processor = this.ctx.createScriptProcessor(4096, 2, 1);
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.chunks = [];
    this.processor.onaudioprocess = event => {
      const input = event.inputBuffer;
      const mono = new Float32Array(input.length);
      let energy = 0;
      for (let c = 0; c < input.numberOfChannels; c += 1) {
        const data = input.getChannelData(c);
        for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / input.numberOfChannels;
      }
      for (let i = 0; i < mono.length; i += 1) energy += mono[i] * mono[i];
      this.level = Math.min(1, Math.sqrt(energy / mono.length) * 6);
      this.peak = Math.max(this.peak, this.level);
      this.chunks.push(mono);
      this.seconds += input.length / input.sampleRate;
    };
    source.connect(this.processor).connect(sink).connect(this.ctx.destination);
    audio.addEventListener('ended', () => this.onEnded?.());
    capture.getVideoTracks()[0]?.addEventListener('ended', () => this.onEnded?.());
  }

  /** Stops and returns a WAV file of what was captured (null if nothing audible). */
  async stop(): Promise<Blob | null> {
    const rate = this.ctx?.sampleRate ?? 48000;
    if (this.processor) this.processor.onaudioprocess = null;
    this.stream?.getTracks().forEach(track => track.stop());
    await this.ctx?.close().catch(() => undefined);
    this.stream = null;
    this.ctx = null;
    this.processor = null;
    const length = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (length < rate) return null;
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
    // Trim silence at both ends (time spent switching tabs / pressing play).
    const threshold = 0.01;
    let start = 0, end = samples.length;
    while (start < end && Math.abs(samples[start]) < threshold) start += 1;
    while (end > start && Math.abs(samples[end - 1]) < threshold) end -= 1;
    start = Math.max(0, start - Math.round(rate * 0.25));
    end = Math.min(samples.length, end + Math.round(rate * 0.5));
    return encodeWav([samples.subarray(start, end)], rate);
  }
}
