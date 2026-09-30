import { describe, expect, it } from 'vitest';
import { lyricBreaths, applyTypedLyrics } from '../src/lib/analysis';
import { countInCues, estimateBeat, beatNeedsEstimate, BEAT_VERSION } from '../src/lib/beat';
import { makeSong, SONG } from './fixtures';

/** A drum track: accented beats (and an optional off-beat hi-hat), as an AudioBuffer look-alike. */
function drums(bpm: number, meter: number, offset: number, { halfTimeAccent = false, seconds = 40, rate = 22050 } = {}) {
  const data = new Float32Array(rate * seconds);
  const period = 60 / bpm;
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0, t = offset; t < seconds - 0.2; k += 1, t += period) {
    const accent = halfTimeAccent ? (k % 2 === 0 ? 1 : 0.3) : k % meter === 0 ? 1 : 0.45;
    const at = Math.round(t * rate);
    for (let i = 0; i < rate * 0.08; i += 1) data[at + i] += accent * Math.exp(-i / (rate * 0.015)) * Math.sin(i * 0.3 + random());
    const hat = Math.round((t + period / 2) * rate);
    for (let i = 0; i < rate * 0.03 && hat + i < data.length; i += 1) data[hat + i] += 0.15 * (random() - 0.5);
  }
  return { sampleRate: rate, length: data.length, numberOfChannels: 1, getChannelData: () => data } as unknown as AudioBuffer;
}

describe('beat', () => {
  it.each([[100, 4, 0.3], [90, 3, 0.1], [128, 4, 0.05], [72, 3, 0.5], [70, 4, 0.2]])('finds %s BPM in %s', (bpm, meter, offset) => {
    const beat = estimateBeat(drums(bpm, meter, offset))!;
    expect(60 / beat.period).toBeCloseTo(bpm, 0);
    expect(beat.meter).toBe(meter);
    expect(Math.abs(beat.phase - offset)).toBeLessThan(0.03);
  });
  it('does not count a fast song at half speed (the dots would start far too early)', () => {
    const beat = estimateBeat(drums(136, 4, 0.2, { halfTimeAccent: true }))!;
    expect(60 / beat.period).toBeCloseTo(136, 0);
  });
  it('a beat once saved as "none found" is estimated again (the dots come back)', () => {
    expect(beatNeedsEstimate(undefined)).toBe(true);
    expect(beatNeedsEstimate(null)).toBe(true);   // detection failed before — retry it
    expect(beatNeedsEstimate({ period: 0.5, phase: 0, meter: 4, version: BEAT_VERSION - 1 })).toBe(true);
    expect(beatNeedsEstimate({ period: 0.5, phase: 0, meter: 4, version: BEAT_VERSION })).toBe(false);
  });
});

describe('count-in dots', () => {
  it('count toward when the singer actually starts, one beat apart', () => {
    const song = makeSong(SONG);
    song.analysis.lines = applyTypedLyrics(song.analysis, song.text);
    const beat = { period: 0.6, phase: 0.2, meter: 4 as const };
    const [first] = countInCues(song.analysis.lines, beat, song.notes);
    expect(first.dots).toHaveLength(4);
    const entry = song.notes[0].start;
    expect(Math.abs(first.dots[3] + beat.period - entry)).toBeLessThan(beat.period * 0.31);
    expect(first.dots[1] - first.dots[0]).toBeCloseTo(0.6, 5);
  });
});

describe('breaths', () => {
  it('one between lines, none between words of a line', () => {
    const song = makeSong(SONG);
    song.analysis.lines = applyTypedLyrics(song.analysis, song.text);
    const breaths = lyricBreaths(song.analysis.lines, song.notes);
    const sungLines = SONG.filter(line => line.trim() && !/^\[/.test(line)).length;
    expect(breaths).toHaveLength(sungLines - 1);
    // Every breath sits in a real silence between two lines.
    for (const breath of breaths) expect(breath.length).toBeGreaterThan(1);
  });
});
