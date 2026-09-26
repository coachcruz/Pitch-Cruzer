import { encodeWav } from './audio';

export type InputId = 'tab' | 'desktop' | 'mic';

export interface InputState {
  connected: boolean;
  /** Power button: when off the input is muted (not recorded), but its meter still shows the signal. */
  on: boolean;
  label: string;
  level: number;
}

interface Input {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
  on: boolean;
  label: string;
}

/**
 * A small input mixer for capturing a song, OBS-style:
 *  - "tab": audio of a browser tab (YouTube, Spotify, Apple Music…)
 *  - "desktop": system audio from sharing an entire screen (Windows / ChromeOS only)
 *  - "mic": a microphone (off by default — it would mix your voice into the song)
 * Each input has a silent level meter and a power (mute) switch. Inputs stay connected between
 * takes, so recording again or restarting never reopens the share picker.
 */
export class CaptureMixer {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private inputs = new Map<InputId, Input>();
  private chunks: Float32Array[] = [];
  private meterBuffer = new Float32Array(2048);
  recording = false;
  seconds = 0;
  /** Loudest recorded level of the current take (stays ~0 if nothing audible is being recorded). */
  peak = 0;
  onChange: (() => void) | null = null;

  static supported(): boolean {
    return Boolean(navigator.mediaDevices?.getDisplayMedia) && 'AudioContext' in window;
  }

  private async ensureGraph(): Promise<AudioContext> {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    await ctx.resume();
    this.bus = ctx.createGain();
    this.processor = ctx.createScriptProcessor(4096, 2, 1);
    const silent = ctx.createGain();
    silent.gain.value = 0; // monitors are visual only — nothing is played back
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
    this.bus.connect(this.processor).connect(silent).connect(ctx.destination);
    this.ctx = ctx;
    return ctx;
  }

  private async attach(id: InputId, stream: MediaStream, label: string): Promise<void> {
    const ctx = await this.ensureGraph();
    const track = stream.getAudioTracks()[0];
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    const gain = ctx.createGain();
    source.connect(analyser);
    source.connect(gain).connect(this.bus!);
    this.inputs.set(id, { stream, source, gain, analyser, on: true, label });
    const ended = () => { if (this.inputs.get(id)?.stream === stream) { this.disconnect(id); this.onChange?.(); } };
    stream.getTracks().forEach(t => t.addEventListener('ended', ended));
    this.onChange?.();
  }

  /** Opens the share picker for a tab ("tab") or a whole screen with system audio ("desktop"). */
  async connectShare(id: 'tab' | 'desktop'): Promise<void> {
    this.disconnect(id);
    const capture = await navigator.mediaDevices.getDisplayMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      ...({
        preferCurrentTab: false,
        selfBrowserSurface: 'exclude',
        systemAudio: 'include',
        surfaceSwitching: 'include'
      } as object),
      ...(id === 'desktop' ? { video: { displaySurface: 'monitor' } } : { video: { displaySurface: 'browser' } })
    } as DisplayMediaStreamOptions);
    const audio = capture.getAudioTracks()[0];
    if (!audio) {
      capture.getTracks().forEach(track => track.stop());
      throw new Error(id === 'tab'
        ? 'No audio was shared. Pick a Chrome TAB and keep “Share tab audio” switched on.'
        : 'No system audio was shared. Pick “Entire screen” and switch on “Share system audio” (Windows / ChromeOS only).');
    }
    // Keep the video track running: stopping it can end the whole share in some Chrome versions.
    const video = capture.getVideoTracks()[0];
    const surface = (video?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
    // Track labels for tab shares are internal IDs, so describe the source instead.
    const label = surface === 'browser' ? 'Browser tab' : surface === 'monitor' ? 'Entire screen (system audio)' : 'Window';
    await this.attach(id, capture, label);
  }

  async connectMic(): Promise<void> {
    this.disconnect('mic');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false
    });
    await this.attach('mic', stream, stream.getAudioTracks()[0]?.label || 'Microphone');
    this.setOn('mic', true);
  }

  disconnect(id: InputId): void {
    const input = this.inputs.get(id);
    if (!input) return;
    this.inputs.delete(id);
    try { input.source.disconnect(); input.gain.disconnect(); } catch { /* already disconnected */ }
    input.stream.getTracks().forEach(track => track.stop());
  }

  setOn(id: InputId, on: boolean): void {
    const input = this.inputs.get(id);
    if (!input || !this.ctx) return;
    input.on = on;
    input.gain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.01);
    this.onChange?.();
  }

  state(id: InputId): InputState {
    const input = this.inputs.get(id);
    if (!input) return { connected: false, on: false, label: '', level: 0 };
    input.analyser.getFloatTimeDomainData(this.meterBuffer);
    let energy = 0;
    for (let i = 0; i < this.meterBuffer.length; i += 1) energy += this.meterBuffer[i] * this.meterBuffer[i];
    return { connected: true, on: input.on, label: input.label, level: Math.min(1, Math.sqrt(energy / this.meterBuffer.length) * 6) };
  }

  /** At least one connected input is switched on. */
  get hasLiveInput(): boolean {
    return [...this.inputs.values()].some(input => input.on);
  }

  /** Live picture of the shared tab (or screen) for the preview / picture-in-picture window. */
  get videoStream(): MediaStream | null {
    const share = this.inputs.get('tab') ?? this.inputs.get('desktop');
    const track = share?.stream.getVideoTracks()[0];
    return track && track.readyState === 'live' ? new MediaStream([track]) : null;
  }

  startRecording(): void {
    this.chunks = [];
    this.seconds = 0;
    this.peak = 0;
    this.recording = true;
  }

  /** Throws away what was captured so far and keeps recording from the same inputs. */
  reset(): void {
    this.chunks = [];
    this.seconds = 0;
    this.peak = 0;
  }

  /**
   * Stops recording (inputs stay connected) and returns the audio, or null if nothing audible,
   * plus a suggested trim that cuts silence at both ends.
   */
  stopRecording(): Recording | null {
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

  /** Disconnects every input and releases the audio engine. */
  close(): void {
    this.recording = false;
    (['tab', 'desktop', 'mic'] as InputId[]).forEach(id => this.disconnect(id));
    if (this.processor) this.processor.onaudioprocess = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.bus = null;
    this.processor = null;
    this.chunks = [];
  }
}

export interface Recording { samples: Float32Array<ArrayBuffer>; sampleRate: number; suggestedStart: number; suggestedEnd: number }

/** WAV file of just the kept part of a recording. */
export function trimmedWav(recording: Recording, start: number, end: number): Blob {
  const from = Math.max(0, Math.floor(start * recording.sampleRate));
  const to = Math.min(recording.samples.length, Math.ceil(end * recording.sampleRate));
  return encodeWav([recording.samples.subarray(from, Math.max(from + 1, to))], recording.sampleRate);
}
