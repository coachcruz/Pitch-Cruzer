import { describe, expect, it } from 'vitest';
import { yin } from '../src/lib/yin';

/** A sung vowel: harmonics shaped by formants, vibrato, jitter and noise (like a separated vocal). */
function voice(f0: number, vowel: number[], sr = 11025, seconds = 0.6, noise = 0.05) {
  const out = new Float32Array(Math.round(sr * seconds));
  let phase = 0, seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let i = 0; i < out.length; i += 1) {
    const f = f0 * (1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * (i / sr))) * (1 + 0.002 * rand());
    phase += (2 * Math.PI * f) / sr;
    let s = 0;
    for (let h = 1; h * f0 < sr / 2 && h < 40; h += 1) {
      const hf = h * f0;
      s += (vowel.reduce((g, fm) => g + 1 / (1 + ((hf - fm) / (fm * 0.12)) ** 2), 0) / h ** 0.6) * Math.sin(h * phase);
    }
    out[i] = s * 0.1 + noise * rand();
  }
  return out;
}

/** Share of frames read an octave low / an octave high. */
function octaveErrors(f0: number) {
  const sr = 11025, hop = Math.round(0.02 * sr), frame = Math.round(0.08 * sr);
  let low = 0, high = 0, total = 0;
  for (const vowel of [[800, 1150, 2900], [270, 2300, 3000], [450, 800, 2830], [325, 700, 2530]]) {
    const x = voice(f0, vowel);
    for (let s = 0; s + frame <= x.length; s += hop) {
      const result = yin(x.subarray(s, s + frame), sr, 30, 1100, 0.2, true);
      if (!result) continue;
      const cents = 1200 * Math.log2(result.frequency / f0);
      total += 1;
      if (cents < -600) low += 1; else if (cents > 600) high += 1;
    }
  }
  return { low: low / total, high: high / total };
}

describe('pitch: the right octave on a sung voice', () => {
  it('doesn’t read women’s and tenors’ notes an octave low (they used to land in the bass half)', () => {
    for (const f0 of [220, 261.6, 440, 659]) expect(octaveErrors(f0).low).toBeLessThan(0.12);
  });

  it('doesn’t read low men’s voices an octave high either', () => {
    for (const f0 of [82.4, 110, 130.8]) expect(octaveErrors(f0).high).toBe(0);
  });
});

describe('staff range', () => {
  it('spans the notes the song really sings, not a stray note far above', async () => {
    const { singingRange } = await import('../src/ui/lane');
    const notes = Array.from({ length: 200 }, (_, i) => ({ start: i, end: i + 0.8, midi: 64 + (i % 8) }));
    notes.push({ start: 300, end: 300.2, midi: 88 });   // one squeak two octaves up
    expect(singingRange(notes)).toEqual([64, 71]);
  });
});
