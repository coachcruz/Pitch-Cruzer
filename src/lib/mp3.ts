import { Mp3Encoder } from '@breezystack/lamejs';
import { decodeAudio } from './audio';
import { diag } from './diag';

/**
 * Compresses uncompressed audio (tab recordings, WAV/AIFF/FLAC files) to MP3 before upload:
 * about 10× smaller, so it uploads in one or two pieces instead of many. LALAL separates MP3 fine.
 */
export async function encodeMp3(channels: Float32Array[], sampleRate: number, kbps: number): Promise<Blob> {
  const count = Math.min(2, channels.length);
  const encoder = new Mp3Encoder(count, sampleRate, kbps);
  const parts: Uint8Array[] = [];
  const block = 1152 * 20;
  const toInt16 = (data: Float32Array, from: number, to: number) => {
    const out = new Int16Array(to - from);
    for (let i = from; i < to; i += 1) {
      const v = Math.max(-1, Math.min(1, data[i]));
      out[i - from] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return out;
  };
  const length = channels[0].length;
  for (let from = 0; from < length; from += block) {
    const to = Math.min(length, from + block);
    const left = toInt16(channels[0], from, to);
    const chunk = count === 2 ? encoder.encodeBuffer(left, toInt16(channels[1], from, to)) : encoder.encodeBuffer(left);
    if (chunk.length) parts.push(new Uint8Array(chunk));
    // Yield now and then so the page stays responsive while encoding.
    if ((from / block) % 25 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  return new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
}

/** Returns an MP3 version of big uncompressed audio; anything else is returned unchanged. */
export async function compressForUpload(file: Blob, name: string): Promise<{ file: Blob; name: string }> {
  const uncompressed = /\.(wav|wave|aiff?|flac)$/i.test(name) || /wav|aiff|flac/i.test(file.type);
  if (!uncompressed || file.size < 4 * 1024 * 1024) return { file, name };
  try {
    const began = performance.now();
    const buffer = await decodeAudio(await file.arrayBuffer());
    const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c));
    const mp3 = await encodeMp3(channels, buffer.sampleRate, channels.length === 2 ? 192 : 160);
    diag('Compressed ' + (file.size / 1048576).toFixed(1) + ' MB → ' + (mp3.size / 1048576).toFixed(1) + ' MB MP3 in ' + ((performance.now() - began) / 1000).toFixed(1) + 's', 'ok');
    return { file: mp3, name: name.replace(/\.[a-z0-9]+$/i, '') + '.mp3' };
  } catch (error) {
    diag('Compression skipped (' + (error instanceof Error ? error.message : 'unknown') + ') — sending the original', 'warn');
    return { file, name };
  }
}
