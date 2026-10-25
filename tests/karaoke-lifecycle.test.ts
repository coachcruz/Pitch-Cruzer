import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { Karaoke, karaokePageAt } from '../src/views/practice/karaoke';
import { applyTypedLyrics, buildLines, rebaseToNoteRuns, type SongAnalysis } from '../src/lib/analysis';

function setup(partner = false) {
  const notes = [{ start: 1, end: 4, midi: 60 }];
  const analysis: SongAnalysis = { duration: 6, notes, lines: buildLines([{ text: 'hold', start: 1, end: 4 }], notes),
    sections: [], key: null, range: null, transcript: 'ok', separated: true };
  const { document } = parseHTML('<div id="lyrics"></div>');
  const list = document.querySelector('#lyrics')! as unknown as HTMLElement;
  const karaoke = new Karaoke(list, analysis, { tap() {}, toggleSinger() {} });
  karaoke.render({ inSelection: () => true, scores: null, singer: partner ? () => 'partner' : null, anchor: null, cues: new Map() });
  return { karaoke, list, analysis };
}

describe('karaoke performance lifecycle', () => {
  it('judges the whole held final word, not only its onset', () => {
    const { karaoke, list } = setup();
    karaoke.update(1, true, 60);
    karaoke.update(1.1, true, 60);
    expect(list.querySelector('.lv-perfect')).toBeNull();
    for (let t = 1.2; t < 4; t += 0.1) karaoke.update(t, true, 72);
    karaoke.update(4, true, 72);
    expect(list.querySelector('.lv-bad')).not.toBeNull();
  });
  it.each([true, false])('does not grade a partner or paused performance (%s)', partner => {
    const { karaoke, list } = setup(partner);
    for (let t = 1; t <= 4.1; t += 0.1) karaoke.update(t, partner, null);
    expect(list.querySelector('[class*="lv-"]')).toBeNull();
  });
  it('waits for a word spanning multiple notes and advances past unbound words', () => {
    const { analysis } = setup();
    const pages = [analysis.lines, [{ ...analysis.lines[0], id: 'next', start: 6, end: 8,
      words: [{ ...analysis.lines[0].words[0], start: 6, end: 8 }] }]];
    expect(karaokePageAt(pages, 2)).toBe(0);
    analysis.lines[0].words[0].syllables[0].noteIndex = null;
    expect(karaokePageAt(pages, 4)).toBe(1);
    expect(karaokePageAt(pages, 2)).toBe(0);
  });
  it('keeps an inserted word between its matched neighbours on a held note', () => {
    const { analysis } = setup();
    analysis.notes = [{ start: 5, end: 8, midi: 60 }, { start: 9, end: 11, midi: 62 }];
    analysis.heard = [{ text: 'hello', start: 5, end: 5.5 }, { text: 'beautiful', start: 6, end: 6.5 }, { text: 'world', start: 7, end: 7.5 }];
    const words = applyTypedLyrics(analysis, 'hello my beautiful world').flatMap(l => l.words);
    expect(words[1].start).toBeGreaterThanOrEqual(5.5);
    expect(words[1].end).toBeLessThanOrEqual(6);
    const lines = buildLines(analysis.heard, analysis.notes);
    const before = lines.map(l => l.words.map(w => [w.start, w.end]));
    rebaseToNoteRuns(lines, analysis.notes);
    expect(lines.map(l => l.words.map(w => [w.start, w.end]))).toEqual(before);
  });
});
