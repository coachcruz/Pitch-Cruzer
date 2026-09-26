/**
 * Vibrato-aware pitch helpers.
 *
 * A held note with vibrato swings above and below its pitch several times a second. Judged instant by
 * instant it looks "sharp, flat, sharp, flat", so we judge the CENTER of the swing (a moving average over
 * about one vibrato cycle) and analyse the swing itself: rate, width and regularity.
 *
 * Healthy classical/pop vibrato is roughly 4.5–7 cycles per second, up to about ±100 cents wide, and
 * regular. Slow + wide reads as a "wobble"; fast + narrow is often tension ("bleat"/tremolo); irregular
 * rate/width is the usual acoustic sign of vibrato driven from the jaw or throat rather than arising
 * naturally. (Software can't see muscles — these are the same cues a voice teacher listens for.)
 */

export type VibratoKind = 'straight' | 'healthy' | 'slow-wide' | 'fast' | 'irregular' | 'too-wide';
export interface VibratoReading { rateHz: number; extentCents: number; regularity: number; kind: VibratoKind }

/** Moving average of a (NaN-gapped) pitch track over ±`halfWindow` frames, within voiced runs only. */
export function centerTrack(midi: ArrayLike<number>, halfWindow: number): Float32Array {
  const out = new Float32Array(midi.length);
  for (let i = 0; i < midi.length; i += 1) {
    if (Number.isNaN(midi[i])) { out[i] = NaN; continue; }
    let sum = 0, count = 0;
    for (let j = i - 1; j >= i - halfWindow && j >= 0 && !Number.isNaN(midi[j]); j -= 1) { sum += midi[j]; count += 1; }
    for (let j = i + 1; j <= i + halfWindow && j < midi.length && !Number.isNaN(midi[j]); j += 1) { sum += midi[j]; count += 1; }
    out[i] = (sum + midi[i]) / (count + 1);
  }
  return out;
}

/**
 * Analyses one continuous held note (pitch in semitones, one value per `hopSeconds`).
 * Returns null when it's too short to judge (under ~0.6 s).
 */
export function analyzeVibrato(pitch: number[], hopSeconds: number): VibratoReading | null {
  if (pitch.length * hopSeconds < 0.6) return null;
  // Remove slow drift (anything slower than ~2.5 Hz) so only the oscillation remains, in cents.
  const half = Math.max(2, Math.round(0.2 / hopSeconds));
  const cents = pitch.map((value, i) => {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(pitch.length - 1, i + half); j += 1) { sum += pitch[j]; count += 1; }
    return (value - sum / count) * 100;
  }).slice(half, pitch.length - half);
  if (cents.length < 12) return null;

  const rms = Math.sqrt(cents.reduce((sum, v) => sum + v * v, 0) / cents.length);
  const extentCents = rms * Math.SQRT2; // ≈ half the peak-to-peak swing for a sine-like vibrato
  if (extentCents < 15) return { rateHz: 0, extentCents, regularity: 0, kind: 'straight' };

  // Rate + regularity from autocorrelation over 3–10 Hz.
  const minLag = Math.max(2, Math.floor(1 / (10 * hopSeconds)));
  const maxLag = Math.min(cents.length - 4, Math.ceil(1 / (3 * hopSeconds)));
  const energy = cents.reduce((sum, v) => sum + v * v, 0);
  const corr = (lag: number) => {
    let sum = 0;
    for (let i = 0; i + lag < cents.length; i += 1) sum += cents[i] * cents[i + lag];
    return sum / (energy * (cents.length - lag) / cents.length + 1e-9);
  };
  let bestLag = -1, best = -Infinity;
  const values: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    values[lag] = corr(lag);
    if (values[lag] > best) { best = values[lag]; bestLag = lag; }
  }
  if (bestLag < 0) return { rateHz: 0, extentCents, regularity: 0, kind: 'irregular' };
  let refined = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const a = values[bestLag - 1], b = values[bestLag], c = values[bestLag + 1];
    const d = a - 2 * b + c;
    if (Math.abs(d) > 1e-9) refined = bestLag + 0.5 * (a - c) / d;
  }
  const rateHz = 1 / (refined * hopSeconds);
  const regularity = Math.max(0, Math.min(1, best));

  let kind: VibratoKind = 'healthy';
  if (regularity < 0.35) kind = 'irregular';
  else if (extentCents > 110) kind = 'too-wide';
  else if (rateHz < 4.5 && extentCents > 50) kind = 'slow-wide';
  else if (rateHz > 7.5) kind = 'fast';
  return { rateHz, extentCents, regularity, kind };
}

export interface VibratoSummary {
  notes: number;
  withVibrato: number;
  rateHz: number | null;
  extentCents: number | null;
  kind: VibratoKind | null;
  verdict: string;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
};

/** Combines the readings of all long notes in a take into one verdict + tip. */
export function summarizeVibrato(readings: VibratoReading[]): VibratoSummary {
  const vib = readings.filter(reading => reading.kind !== 'straight');
  const base = { notes: readings.length, withVibrato: vib.length };
  if (readings.length < 2) return { ...base, rateHz: null, extentCents: null, kind: null, verdict: '' };
  if (vib.length < Math.max(1, readings.length * 0.25)) {
    return { ...base, rateHz: null, extentCents: null, kind: 'straight',
      verdict: 'Mostly straight tone — clean and fine for many styles. On long notes you can let a gentle vibrato bloom near the end.' };
  }
  const counts = new Map<VibratoKind, number>();
  vib.forEach(reading => counts.set(reading.kind, (counts.get(reading.kind) ?? 0) + 1));
  const kind = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const rateHz = median(vib.map(reading => reading.rateHz));
  const extentCents = median(vib.map(reading => reading.extentCents));
  const stats = rateHz.toFixed(1) + ' per second, ±' + Math.round(extentCents) + '¢ on ' + vib.length + ' of ' + readings.length + ' long notes';
  const verdicts: Record<VibratoKind, string> = {
    straight: '',
    healthy: 'Healthy vibrato (' + stats + ') — even and natural. Scoring follows the center of the wave, so it never costs you points.',
    'slow-wide': 'Slow, wide vibrato (' + stats + ') — can sound like a wobble. Lighten it: less push, steady breath, let it spin a little faster and narrower.',
    fast: 'Fast, tight vibrato (' + stats + ') — often a sign of tension. Relax the throat and jaw; think of the note floating on the breath.',
    irregular: 'Uneven vibrato (' + stats + ') — the waves vary in speed and size, which can mean it’s being pushed from the jaw or throat. Try holding the note straight, then let vibrato arrive on its own.',
    'too-wide': 'Very wide vibrato (' + stats + ') — the swing covers more than a semitone, which blurs the pitch. Aim for a narrower, lighter wave.'
  };
  return { ...base, rateHz, extentCents, kind, verdict: verdicts[kind] };
}

/** Live version for the mic: keeps ~1.5 s of readings; gives the swing's center and a vibrato reading. */
export class LiveVibrato {
  private points: Array<{ t: number; midi: number | null }> = [];

  push(t: number, midi: number | null): void {
    this.points.push({ t, midi });
    while (this.points.length && t - this.points[0].t > 1.5) this.points.shift();
  }

  /** Average pitch over the last ~0.22 s (about one vibrato cycle), or null if not singing. */
  center(): number | null {
    const last = this.points[this.points.length - 1];
    if (!last || last.midi === null) return null;
    const recent = this.points.filter(point => last.t - point.t <= 0.22 && point.midi !== null && Math.abs(point.midi - last.midi!) < 2);
    return recent.reduce((sum, point) => sum + point.midi!, 0) / recent.length;
  }

  /** Vibrato over the current held note (needs ~0.8 s of continuous singing). */
  reading(): VibratoReading | null {
    const last = this.points[this.points.length - 1];
    if (!last || last.midi === null) return null;
    let start = this.points.length - 1;
    while (start > 0 && this.points[start - 1].midi !== null && Math.abs(this.points[start - 1].midi! - last.midi) < 2.5) start -= 1;
    const run = this.points.slice(start);
    if (run.length < 2 || last.t - run[0].t < 0.8) return null;
    // Resample to 50 per second (the analyser's frame rate).
    const hop = 0.02;
    const samples: number[] = [];
    let j = 0;
    for (let t = run[0].t; t <= last.t; t += hop) {
      while (j < run.length - 1 && run[j + 1].t <= t) j += 1;
      samples.push(run[j].midi!);
    }
    return analyzeVibrato(samples, hop);
  }
}

export function vibratoLabel(reading: VibratoReading | null): string {
  if (!reading || reading.kind === 'straight') return '';
  const names: Record<VibratoKind, string> = {
    straight: '', healthy: 'healthy', 'slow-wide': 'slow & wide', fast: 'fast & tight', irregular: 'uneven', 'too-wide': 'very wide'
  };
  return '〰 vibrato ' + reading.rateHz.toFixed(1) + '/s ±' + Math.round(reading.extentCents) + '¢ · ' + names[reading.kind];
}
