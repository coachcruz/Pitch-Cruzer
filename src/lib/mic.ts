import { frequencyToMidi } from './music';
import { yin } from './yin';

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
  private buffer = new Float32Array(2048);
  echoCancel = false;

  constructor(private ctx: AudioContext) {}

  get active(): boolean { return this.stream !== null; }

  async start(echoCancel: boolean): Promise<void> {
    if (this.stream && echoCancel === this.echoCancel) return;
    this.stop();
    this.echoCancel = echoCancel;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: echoCancel, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      video: false
    });
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
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
    const result = yin(decimated, this.ctx.sampleRate / factor, 65, 1100, 0.18);
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
