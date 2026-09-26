export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const midiToFrequency = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
export const frequencyToMidi = (frequency: number) => 69 + 12 * Math.log2(frequency / 440);

export function midiToNote(midi: number): string {
  const rounded = Math.round(midi);
  return NOTE_NAMES[((rounded % 12) + 12) % 12] + String(Math.floor(rounded / 12) - 1);
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

/**
 * Typical classical / choral voice ranges (MIDI). Ranges overlap — a note can sit in several.
 * "Sub-bass" marks the subharmonic / oktavist territory below a normal bass.
 */
export interface VoiceType { id: string; name: string; short: string; low: number; high: number; color: string }
export const VOICE_TYPES: VoiceType[] = [
  { id: 'sub', name: 'Sub-bass (subharmonic)', short: 'Sub', low: 24, high: 40, color: '#64748b' },
  { id: 'bass', name: 'Bass', short: 'Bass', low: 40, high: 64, color: '#3b82f6' },
  { id: 'baritone', name: 'Baritone', short: 'Bar', low: 45, high: 69, color: '#06b6d4' },
  { id: 'tenor', name: 'Tenor', short: 'Ten', low: 48, high: 72, color: '#10b981' },
  { id: 'alto', name: 'Alto', short: 'Alto', low: 53, high: 77, color: '#eab308' },
  { id: 'mezzo', name: 'Mezzo-soprano', short: 'Mez', low: 57, high: 81, color: '#f97316' },
  { id: 'soprano', name: 'Soprano', short: 'Sop', low: 60, high: 84, color: '#ec4899' }
];

/** Voice types a range fits inside; if none contain it fully, the one(s) overlapping it most. */
export function voiceTypesFor(low: number, high: number): VoiceType[] {
  const inside = VOICE_TYPES.filter(type => low >= type.low && high <= type.high);
  if (inside.length) return inside;
  const overlap = (type: VoiceType) => Math.max(0, Math.min(high, type.high) - Math.max(low, type.low));
  const best = Math.max(...VOICE_TYPES.map(overlap));
  return best > 0 ? VOICE_TYPES.filter(type => overlap(type) >= best - 1) : [];
}

export const voiceTypeNames = (types: VoiceType[]) => types.map(type => type.name).join(' · ');
