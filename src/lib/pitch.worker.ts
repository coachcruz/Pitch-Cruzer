/// <reference lib="webworker" />
import { yin, rms } from './yin';
import { frequencyToMidi } from './music';

/**
 * Builds a pitch track for a whole (mono, low sample-rate) vocal stem off the main thread.
 * Output: one MIDI value per hop (NaN when unvoiced) plus the RMS energy per hop.
 */
export interface PitchJob { samples: Float32Array; sampleRate: number; hopSeconds: number }
export interface PitchJobResult { midi: Float32Array; energy: Float32Array; hopSeconds: number }

self.onmessage = (event: MessageEvent<PitchJob>) => {
  const { samples, sampleRate, hopSeconds } = event.data;
  const hop = Math.max(1, Math.round(sampleRate * hopSeconds));
  const frameSize = Math.round(sampleRate * 0.05);
  const count = Math.max(0, Math.floor((samples.length - frameSize) / hop));
  const midi = new Float32Array(count);
  const energy = new Float32Array(count);
  const frame = new Float32Array(frameSize);

  for (let index = 0; index < count; index += 1) {
    frame.set(samples.subarray(index * hop, index * hop + frameSize));
    energy[index] = rms(frame);
    midi[index] = NaN;
    if (energy[index] < 0.004) continue;
    const result = yin(frame, sampleRate, 65, 1100, 0.2);
    if (result && result.confidence > 0.75) midi[index] = frequencyToMidi(result.frequency);
    if (index % 2000 === 0) self.postMessage({ progress: index / count });
  }

  // Energy gate relative to the song: very quiet frames are bleed, not singing.
  const voicedEnergy = Array.from(energy).filter((_, i) => !Number.isNaN(midi[i])).sort((a, b) => a - b);
  const loud = voicedEnergy[Math.floor(voicedEnergy.length * 0.9)] ?? 0;
  for (let index = 0; index < count; index += 1) {
    if (energy[index] < loud * 0.06) midi[index] = NaN;
  }

  const result: PitchJobResult = { midi, energy, hopSeconds: hop / sampleRate };
  (self as unknown as Worker).postMessage({ result }, [midi.buffer, energy.buffer]);
};
