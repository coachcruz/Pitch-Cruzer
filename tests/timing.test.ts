import { describe, expect, it } from 'vitest';
import { applyTypedLyrics, matchHeardWords } from '../src/lib/analysis';
import { makeSong, SONG } from './fixtures';

/** Sung words of the result, in order, with their times. */
const sungWords = (lines: ReturnType<typeof applyTypedLyrics>) => lines.flatMap(line => line.words).filter(word => !word.aside);

/** How far (s) each line's first word is from where it's really sung. */
function lineStartErrors(result: ReturnType<typeof applyTypedLyrics>, truth: ReturnType<typeof makeSong>['truth']) {
  const words = sungWords(result);
  expect(words.map(w => w.text)).toEqual(truth.map(w => w.text));
  const errors: number[] = [];
  truth.forEach((word, i) => { if (i === 0 || truth[i - 1].line !== word.line) errors.push(Math.abs(words[i].start - word.start)); });
  return errors;
}

describe('typed lyrics timing', () => {
  it('uses the heard timing when everything was heard', () => {
    const song = makeSong(SONG);
    song.analysis.heard = song.truth.map(w => ({ text: w.text, start: w.start, end: w.end }));
    const errors = lineStartErrors(applyTypedLyrics(song.analysis, song.text), song.truth);
    expect(Math.max(...errors)).toBeLessThan(0.05);
  });

  it('places the lyrics on the melody when nothing was heard', () => {
    const song = makeSong(SONG);
    const errors = lineStartErrors(applyTypedLyrics(song.analysis, song.text), song.truth);
    expect(Math.max(...errors)).toBeLessThan(0.5);
  });

  it('ignores words invented in the intro and places a missed verse on its own notes', () => {
    // The listening "heard" words during the instrumental intro, missed the whole verse, and heard the chorus.
    const song = makeSong(SONG);
    const chorus = song.truth.filter(w => w.line >= 7);
    song.analysis.heard = [
      { text: 'Kid', start: 2, end: 2.4 }, { text: 'Rook', start: 2.5, end: 3 },
      ...chorus.map(w => ({ text: w.text, start: w.start, end: w.end }))
    ];
    const result = applyTypedLyrics(song.analysis, song.text);
    const words = sungWords(result);
    // The first sung word is where the singing starts, not in the intro.
    expect(words[0].start).toBeGreaterThan(14.5);
    const errors = lineStartErrors(result, song.truth);
    expect(Math.max(...errors)).toBeLessThan(0.5);
  });

  it('keeps a word misheard by one letter as timing ("Rook" for "Rock")', () => {
    const pairs = matchHeardWords(['kid', 'rock', 'playing', 'on', 'the', 'radio'],
      [{ text: 'kid' }, { text: 'rook' }, { text: 'playing' }, { text: 'on' }, { text: 'the' }, { text: 'radio' }]);
    expect(pairs.map(([i]) => i)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('never pins a lone short word to a stray heard word', () => {
    const pairs = matchHeardWords(['walking', 'down', 'the', 'road'], [{ text: 'the' }]);
    expect(pairs).toEqual([]);
  });

  it('keeps [asides] and section tags out of the sung words', () => {
    const song = makeSong(SONG);
    const lines = applyTypedLyrics(song.analysis, song.text);
    const tags = lines.flatMap(line => line.words).filter(word => word.tag).map(word => word.text);
    expect(tags).toEqual(['[Verse 1]', '[Chorus]']);
  });
});
