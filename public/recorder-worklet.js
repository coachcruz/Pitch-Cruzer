// Captures microphone samples with their exact audio-clock frame so takes line up with the music.
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.id = 0;
    this.port.onmessage = event => {
      const { command, id } = event.data;
      if (command === 'start') { this.id = id; this.recording = true; }
      else if (command === 'stop' && id === this.id) {
        this.recording = false;
        this.port.postMessage({ stopped: id });
      }
    };
  }
  process(inputs) {
    const input = inputs[0];
    if (this.recording && input && input[0]) {
      this.port.postMessage({ id: this.id, frame: currentFrame, data: input[0].slice(0) });
    }
    return true;
  }
}
registerProcessor('recorder-processor', RecorderProcessor);
