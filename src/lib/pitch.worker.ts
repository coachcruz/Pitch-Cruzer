/// <reference lib="webworker" />
import { yin, rms } from './yin';
import { frequencyToMidi, MAX_HZ, MIN_HZ } from './music';

/**
 * Builds a pitch track for a whole (mono, low sample-rate) vocal stem off the main thread.
 * Output: one MIDI value per hop (NaN when unvoiced) plus the RMS energy per hop.
 */
export interface PitchJob { samples: Float32Array; sampleRate: number; hopSeconds: number; soloVoice: boolean }
export interface PitchJobResult { midi: Float32Array; energy: Float32Array; hopSeconds: number }

self.onmessage = (event: MessageEvent<PitchJob>) => {
  const { samples, sampleRate, hopSeconds, soloVoice } = event.data;
  const hop = Math.max(1, Math.round(sampleRate * hopSeconds));
  // 80 ms frames hold two periods of a ~30 Hz subharmonic bass note.
  const frameSize = Math.round(sampleRate * 0.08);
  const count = Math.max(0, Math.floor(samples.length / hop));
  const midi = new Float32Array(count);
  const energy = new Float32Array(count);
  const frame = new Float32Array(frameSize);

  for (let index = 0; index < count; index += 1) {
    // Center each frame on its timestamp so notes line up with the audio.
    const start = Math.min(Math.max(0, index * hop - (frameSize >> 1)), Math.max(0, samples.length - frameSize));
    frame.fill(0);
    frame.set(samples.subarray(start, start + frameSize));
    energy[index] = rms(frame);
    midi[index] = NaN;
    if (energy[index] < 0.004) continue;
    // A full mix of chords "repeats" at very low periods (phantom bass notes), so only an isolated
    // voice gets the full subharmonic range; the full mix stops at C2 like a normal voice.
    const result = yin(frame, sampleRate, soloVoice ? MIN_HZ : 65, MAX_HZ, 0.2, soloVoice);
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
