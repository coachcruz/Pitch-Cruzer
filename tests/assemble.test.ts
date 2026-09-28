import { describe, expect, it } from 'vitest';
import { assembleSpan, lineFeedback, singingLevel, stitchVocal, turnPlan, type KeptLine } from '../src/lib/assemble';
import type { TakeScore } from '../src/lib/score';

const RATE = 8000;

/** A recording from `recordFrom` to `recordTo` (song seconds): a steady tone of `level` while the words are sung. */
function take(start: number, end: number, level: number, { recordFrom = start - 1.5, recordTo = end + 0.5, noise = 0 } = {}): KeptLine {
  const samples = new Float32Array(Math.round((recordTo - recordFrom) * RATE));
  for (let n = 0; n < samples.length; n += 1) {
    const t = recordFrom + n / RATE;
    samples[n] = (t >= start && t <= end ? level : noise) * Math.sin((2 * Math.PI * 220 * n) / RATE);
  }
  return { start, end, samples, sampleRate: RATE, songTimeAtStart: recordFrom };
}

/** Loudness of the stitched track around song time t. */
const levelAt = (out: Float32Array, t: number) => singingLevel(out.subarray(Math.round((t - 0.1) * RATE), Math.round((t + 0.1) * RATE)), RATE);

describe('song builder: joining kept lines', () => {
  it('puts every line at its own moment in the song, silent where nothing was kept', () => {
    const out = stitchVocal([take(2, 4, 0.5), take(10, 12, 0.5)], 15, RATE);
    expect(out.length).toBe(15 * RATE);
    expect(levelAt(out, 3)).toBeGreaterThan(0.3);
    expect(levelAt(out, 11)).toBeGreaterThan(0.3);
    expect(levelAt(out, 7)).toBe(0);
    expect(levelAt(out, 1)).toBe(0);
  });

  it('brings a quiet line and a loud line to the same loudness', () => {
    const out = stitchVocal([take(2, 4, 0.2), take(6, 8, 0.6), take(10, 12, 0.4)], 14, RATE);
    const levels = [3, 7, 11].map(t => levelAt(out, t));
    expect(Math.max(...levels) / Math.min(...levels)).toBeLessThan(1.3);
  });

  it('never makes a line more than twice (or less than half) as loud as it was sung', () => {
    const out = stitchVocal([take(2, 4, 0.05), take(6, 8, 0.6), take(10, 12, 0.6)], 14, RATE);
    expect(levelAt(out, 3) / (0.05 / Math.SQRT2)).toBeLessThanOrEqual(2.01);
  });

  it('joins lines that follow straight on without a gap, a jump or doubling', () => {
    // Line two starts 0.3 s after line one ends: the two recordings overlap and must cross-fade.
    const out = stitchVocal([take(2, 4, 0.5, { noise: 0.5 }), take(4.3, 6, 0.5, { noise: 0.5 })], 8, RATE);
    let peak = 0, dip = 1;
    for (let t = 3.5; t < 4.8; t += 0.02) { const level = levelAt(out, t); peak = Math.max(peak, level); dip = Math.min(dip, level); }
    expect(peak).toBeLessThan(0.5 / Math.SQRT2 * 1.1);   // no doubling where they overlap
    expect(dip).toBeGreaterThan(0.5 / Math.SQRT2 * 0.85); // no gap
  });

  it('leaves out what was recorded long before or after a line (a cough, the count-in)', () => {
    const cough = take(5, 6, 0.5, { recordFrom: 2, recordTo: 7, noise: 0.5 });
    const out = stitchVocal([cough], 8, RATE);
    expect(levelAt(out, 3)).toBe(0);
    expect(levelAt(out, 5.5)).toBeGreaterThan(0.3);
  });
});

describe('song builder: what it says after a line', () => {
  const score = (partial: Partial<TakeScore>): TakeScore => ({
    score: 60, onPitchWhenSinging: 60, coverage: 90, meanCents: 0, steadiness: 70,
    vibrato: {} as TakeScore['vibrato'], lines: [], trail: [], ...partial
  });

  it('praises a line that earns it', () => {
    expect(lineFeedback(score({ score: 92, steadiness: 85 }))).toEqual({ headline: '🌟 Beautiful!', note: 'Right on the notes and nicely steady. That one’s a keeper.' });
  });

  it('gives one thing to try otherwise', () => {
    expect(lineFeedback(score({ score: 55, meanCents: -40 })).note).toMatch(/flat/);
    expect(lineFeedback(score({ score: 55, meanCents: 40 })).note).toMatch(/sharp/);
    expect(lineFeedback(score({ score: 55, steadiness: 30 })).note).toMatch(/steadier/);
    expect(lineFeedback(score({ score: 80, coverage: 20 })).note).toMatch(/sing out/);
  });
});

describe('song builder: the cue into your line', () => {
  const word = (text: string, start: number) => ({ text, start, end: start + 0.4, syllables: [] });
  const line = (id: string, words: Array<[string, number]>) => {
    const list = words.map(([text, start]) => word(text, start));
    return { id, start: list[0].start, end: list[list.length - 1].end, words: list };
  };
  const one = line('a', [['walking', 2], ['down', 2.5], ['the', 3], ['road', 3.5]]);
  const two = line('b', [['every', 4.5], ['window', 5], ['burning', 5.5]]);
  const late = line('c', [['after', 20], ['the', 20.5], ['solo', 21]]);

  it('cues you in with the last two words of the line before', () => {
    expect(turnPlan([one, two], two, 30)).toEqual({ start: 2.85, lineStart: 4.5, end: 6.5, cueFrom: 3 });
  });

  it('counts in instead for the first line, or after a long instrumental', () => {
    expect(turnPlan([one, two, late], one, 30).cueFrom).toBeNull();
    expect(turnPlan([one, two, late], one, 30).start).toBe(0);
    expect(turnPlan([one, two, late], late, 30)).toEqual({ start: 18, lineStart: 20, end: 22, cueFrom: null });
  });

  it('cues from the words before yours when the lines overlap', () => {
    const overlapping = line('d', [['road', 3.4], ['again', 3.8]]);
    const plan = turnPlan([one, overlapping], overlapping, 30);
    expect(plan.cueFrom).toBe(2.5);          // "down the" — both before your line starts
    expect(plan.lineStart).toBe(3.4);
  });
});

describe('song builder: putting it together', () => {
  it('makes the whole song only when every line is kept', () => {
    expect(assembleSpan([{ start: 10, end: 14 }, { start: 15, end: 19 }], 2, 200)).toEqual({ start: 0, end: 200, whole: true });
  });

  it('makes just the stretch you have sung when the song isn’t finished', () => {
    expect(assembleSpan([{ start: 10, end: 14 }, { start: 15, end: 19 }], 30, 200)).toEqual({ start: 8, end: 21.5, whole: false });
  });

  it('makes nothing from nothing', () => {
    expect(assembleSpan([], 30, 200)).toEqual({ start: 0, end: 0, whole: false });
  });
});
