export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const midiToFrequency = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
export const frequencyToMidi = (frequency: number) => 69 + 12 * Math.log2(frequency / 440);

export function midiToNote(midi: number): string {
  const rounded = Math.round(midi);
  return NOTE_NAMES[((rounded % 12) + 12) % 12] + String(Math.floor(rounded / 12) - 1);
}

export function noteToMidi(note: string): number | null {
  const match = note.trim().match(/^([A-Ga-g])([#b]?)(-?\d)$/);
  if (!match) return null;
  const natural: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = natural[match[1].toUpperCase()];
  if (match[2] === '#') pc += 1;
  if (match[2] === 'b') pc -= 1;
  return (Number(match[3]) + 1) * 12 + pc;
}

export function median(values: ArrayLike<number>): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Moves `midi` by whole octaves so it sits as close as possible to `target`. */
export function foldToOctave(midi: number, target: number): number {
  return midi + 12 * Math.round((target - midi) / 12);
}

export interface MusicalKey { tonic: number; mode: 'major' | 'minor'; confidence: number }

export const keyName = (key: MusicalKey) => NOTE_NAMES[key.tonic] + (key.mode === 'major' ? ' major' : ' minor');

export function scalePitchClasses(key: MusicalKey): number[] {
  const steps = key.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  return steps.map(step => (key.tonic + step) % 12);
}

/** Krumhansl–Schmuckler key estimate from a duration-weighted pitch-class histogram. */
export function estimateKey(histogram: number[]): MusicalKey | null {
  const total = histogram.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minor = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  let best: MusicalKey | null = null;
  for (let tonic = 0; tonic < 12; tonic += 1) {
    for (const mode of ['major', 'minor'] as const) {
      const profile = mode === 'major' ? major : minor;
      let dot = 0, aa = 0, bb = 0;
      for (let pc = 0; pc < 12; pc += 1) {
        const p = profile[(pc - tonic + 12) % 12];
        dot += histogram[pc] * p;
        aa += histogram[pc] * histogram[pc];
        bb += p * p;
      }
      const confidence = dot / (Math.sqrt(aa * bb) + 1e-9);
      if (!best || confidence > best.confidence) best = { tonic, mode, confidence };
    }
  }
  return best;
}

/** Lowest/highest pitch the app listens for: B0 (≈31 Hz, subharmonic bass) up to C6 (≈1 kHz). */
export const MIN_HZ = 30;
export const MAX_HZ = 1100;

export const octaveOf = (midi: number) => Math.floor(Math.round(midi) / 12) - 1;

/** Plain-words relation between what you sang and the target, including octave. */
export function octaveRelation(sung: number, target: number): string {
  const octaves = Math.round((sung - target) / 12);
  if (octaves === 0) return 'same octave';
  const n = Math.abs(octaves);
  return (n === 1 ? '1 octave ' : n + ' octaves ') + (octaves < 0 ? 'below' : 'above');
}

export function formatTime(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
}
