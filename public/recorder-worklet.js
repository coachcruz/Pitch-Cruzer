// Captures microphone samples with their exact audio-clock frame so takes line up with the music.
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.port.onmessage = event => { this.recording = event.data === 'start'; };
  }
  process(inputs) {
    const input = inputs[0];
    if (this.recording && input && input[0]) {
      this.port.postMessage({ frame: currentFrame, data: input[0].slice(0) });
    }
    return true;
  }
}
registerProcessor('recorder-processor', RecorderProcessor);
