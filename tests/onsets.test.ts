import { describe, expect, it } from 'vitest';
import { alignVocalOnsets, vocalOnsets } from '../src/lib/onsets';
import { buildLines, type SongAnalysis } from '../src/lib/analysis';

const rate = 16000;
describe('vocal articulation evidence', () => {
  it('does not move a word onset past an existing short syllable boundary', () => {
    const notes = [{ start: 1, end: 2, midi: 60 }];
    const lines = buildLines([{ text: 'hello', start: 1, end: 2 }], notes);
    const word = lines[0].words[0];
    word.syllables = [
      { ...word.syllables[0], start: 1, end: 1.1 },
      { ...word.syllables[0], start: 1.1, end: 2 }
    ];
    const analysis: SongAnalysis = { duration: 3, notes, lines, sections: [], key: null, range: null, transcript: 'ok', separated: true };
    const samples = new Float32Array(rate * 3);
    for (let i = Math.round(1.17 * rate); i < 2 * rate; i++) samples[i] = 0.4 * Math.sin(2 * Math.PI * 220 * i / rate);
    alignVocalOnsets(analysis, samples, rate);
    expect(word.syllables.every(syllable => syllable.start <= syllable.end)).toBe(true);
    expect(word.start).toBe(1);
    expect(word.timing).toBe('estimated');
  });
  it('finds separate attacks on one pitch with short staccato breaks', () => {
    const samples = new Float32Array(rate * 2);
    for (const start of [0.2, 0.55, 0.9]) for (let i = Math.round(start * rate); i < (start + 0.25) * rate; i++) samples[i] = 0.4 * Math.sin(2 * Math.PI * 220 * i / rate);
    const onsets = vocalOnsets(samples, rate);
    expect(onsets).toHaveLength(3);
    onsets.forEach((at, i) => expect(Math.abs(at - [0.2, 0.55, 0.9][i])).toBeLessThan(0.025));
  });
  it('does not treat a continuous legato pitch change as a new word', () => {
    const samples = new Float32Array(rate * 2); let phase = 0;
    for (let i = Math.round(0.2 * rate); i < 1.8 * rate; i++) {
      phase += 2 * Math.PI * (i < rate ? 220 : 330) / rate;
      samples[i] = 0.4 * Math.sin(phase);
    }
    expect(vocalOnsets(samples, rate)).toHaveLength(1);
  });
  it('finds no articulations in silence', () => expect(vocalOnsets(new Float32Array(rate), rate)).toEqual([]));
});
