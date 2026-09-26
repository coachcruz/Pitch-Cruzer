let sharedDecodeContext: AudioContext | null = null;

export async function decodeAudio(bytes: ArrayBuffer): Promise<AudioBuffer> {
  sharedDecodeContext ??= new AudioContext();
  return sharedDecodeContext.decodeAudioData(bytes.slice(0));
}

/** Mono, resampled copy of a buffer (used for pitch analysis and transcription). */
export async function resampleMono(buffer: AudioBuffer, sampleRate: number): Promise<Float32Array> {
  const frames = Math.max(1, Math.ceil(buffer.duration * sampleRate));
  const offline = new OfflineAudioContext(1, frames, sampleRate);
  const node = offline.createBufferSource();
  node.buffer = buffer;
  node.connect(offline.destination);
  node.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const count = channels.length;
  const length = channels[0]?.length ?? 0;
  const dataBytes = length * count * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let i = 0; i < length; i += 1) {
    for (let c = 0; c < count; c += 1) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
