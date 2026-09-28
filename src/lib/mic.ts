import { frequencyToMidi, MAX_HZ, MIN_HZ } from './music';
import { yin } from './yin';

/** A microphone to use, remembered by id — and by name, since ids can change between visits. */
export interface MicChoice { id: string; label: string }

/** The microphones the device offers (their names show once the mic has been allowed). */
export async function listMics(): Promise<MicChoice[]> {
  const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []) ?? [];
  return devices.filter(device => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default' && device.deviceId !== 'communications')
    .map((device, i) => ({ id: device.deviceId, label: device.label || 'Microphone ' + (i + 1) }));
}

/** A mic that sends through Bluetooth: phones drop to call quality for it, and it lags behind the music. */
export const isBluetoothMic = (label: string) => /airpods|bluetooth|hands-?free|headset|beats|buds|\bbt\b/i.test(label);

/**
 * Live microphone: real-time pitch, an input level, optional "hear myself" monitoring and
 * sample-accurate recording on the same audio clock as the Player.
 */
export class LiveMic {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private recorder: AudioWorkletNode | null = null;
  private monitor: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private firstFrame: number | null = null;
  private recent: number[] = [];
  private buffer = new Float32Array(4096);
  echoCancel = false;
  private choice: MicChoice | null = null;
  private raw = true;
  /** The chosen mic couldn't be opened, so the device's default was used. */
  fellBack = false;

  constructor(private ctx: AudioContext) {}

  get active(): boolean { return this.stream !== null; }

  /**
   * `choice`: the mic picked in the settings (null: whatever the device picks). `raw` (the default):
   * singing wants the plain voice, so ask for no call-style processing — noise suppression, automatic
   * volume, voice isolation — which squashes a sung voice and can duck the music. Off: allowed (a noisy room).
   */
  async start(echoCancel: boolean, choice: MicChoice | null = null, raw = true): Promise<void> {
    if (this.stream && echoCancel === this.echoCancel && choice?.id === this.choice?.id && raw === this.raw) return;
    this.stop();
    this.echoCancel = echoCancel;
    this.choice = choice;
    this.raw = raw;
    this.fellBack = false;
    const audio: MediaTrackConstraints & { voiceIsolation?: boolean } = raw
      ? { echoCancellation: echoCancel, noiseSuppression: false, autoGainControl: false, voiceIsolation: false, channelCount: 1 }
      : { echoCancellation: echoCancel, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    const id = choice ? (await listMics()).find(mic => mic.id === choice.id || mic.label === choice.label)?.id : undefined;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: id ? { ...audio, deviceId: { exact: id } } : audio, video: false });
    } catch (error) {
      if (!id || (error instanceof DOMException && error.name === 'NotAllowedError')) throw error;
      // The chosen mic is gone (unplugged, switched off): use the default one.
      this.stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      this.fellBack = true;
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 4096; // long enough for ~30 Hz subharmonics
    this.source.connect(this.analyser);
    this.monitor = this.ctx.createGain();
    this.monitor.gain.value = 0;
    this.source.connect(this.monitor).connect(this.ctx.destination);
    try {
      await this.ctx.audioWorklet.addModule(new URL('recorder-worklet.js', document.baseURI).href);
      this.recorder = new AudioWorkletNode(this.ctx, 'recorder-processor', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
      this.recorder.port.onmessage = (event: MessageEvent<{ frame: number; data: Float32Array }>) => {
        if (this.firstFrame === null) this.firstFrame = event.data.frame;
        this.chunks.push(event.data.data);
      };
      this.source.connect(this.recorder);
    } catch (error) {
      console.warn('Recording worklet unavailable', error);
      this.recorder = null;
    }
  }

  /** The name of the mic in use. */
  get inputLabel(): string { return this.stream?.getAudioTracks()[0]?.label ?? ''; }

  /**
   * Processing the device applies although it was asked not to — an iPhone with its Mic Mode on
   * Voice Isolation, or a phone in call mode, reports it here.
   */
  get filtering(): string[] {
    const settings = (this.stream?.getAudioTracks()[0]?.getSettings?.() ?? {}) as MediaTrackSettings & { voiceIsolation?: boolean };
    const on: string[] = [];
    if (!this.raw) return on; // filters were allowed
    if (settings.voiceIsolation) on.push('voice isolation');
    if (settings.noiseSuppression) on.push('noise suppression');
    if (settings.echoCancellation && !this.echoCancel) on.push('echo cancelling');
    if (settings.autoGainControl) on.push('automatic volume');
    return on;
  }

  setMonitor(level: number): void {
    this.monitor?.gain.setTargetAtTime(level, this.ctx.currentTime, 0.02);
  }

  get canRecord(): boolean { return this.recorder !== null; }

  startRecording(): void {
    this.chunks = [];
    this.firstFrame = null;
    this.recorder?.port.postMessage('start');
  }

  /** Returns the recorded samples and the audio-clock time (seconds) of the first sample. */
  stopRecording(): { samples: Float32Array<ArrayBuffer>; startTime: number; sampleRate: number } | null {
    this.recorder?.port.postMessage('stop');
    if (this.firstFrame === null || !this.chunks.length) return null;
    const length = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const samples = new Float32Array(length);
    let offset = 0;
    for (const chunk of this.chunks) { samples.set(chunk, offset); offset += chunk.length; }
    const result = { samples, startTime: this.firstFrame / this.ctx.sampleRate, sampleRate: this.ctx.sampleRate };
    this.chunks = [];
    this.firstFrame = null;
    return result;
  }

  /** Current sung pitch as a (smoothed) MIDI number, plus input level 0..1. */
  read(): { midi: number | null; level: number } {
    if (!this.analyser) return { midi: null, level: 0 };
    this.analyser.getFloatTimeDomainData(this.buffer);
    const factor = Math.max(1, Math.floor(this.ctx.sampleRate / 12000));
    const decimated = new Float32Array(Math.floor(this.buffer.length / factor));
    let energy = 0;
    for (let i = 0; i < decimated.length; i += 1) {
      let sum = 0;
      for (let k = 0; k < factor; k += 1) sum += this.buffer[i * factor + k];
      decimated[i] = sum / factor;
      energy += decimated[i] * decimated[i];
    }
    const level = Math.min(1, Math.sqrt(energy / decimated.length) * 8);
    if (level < 0.04) { this.recent = []; return { midi: null, level }; }
    const result = yin(decimated, this.ctx.sampleRate / factor, MIN_HZ, MAX_HZ, 0.18);
    if (!result || result.confidence < 0.7) { this.recent = []; return { midi: null, level }; }
    let midi = frequencyToMidi(result.frequency);
    const last = this.recent[this.recent.length - 1];
    if (last !== undefined && Math.abs(midi - last - 12) < 0.7) midi -= 12;  // octave-jump guard
    this.recent.push(midi);
    if (this.recent.length > 4) this.recent.shift();
    const sorted = [...this.recent].sort((a, b) => a - b);
    return { midi: sorted[Math.floor(sorted.length / 2)], level };
  }

  stop(): void {
    this.recorder?.disconnect();
    this.recorder = null;
    this.monitor?.disconnect();
    this.monitor = null;
    this.source?.disconnect();
    this.source = null;
    this.analyser = null;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.recent = [];
  }
}
