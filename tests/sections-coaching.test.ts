import { describe, expect, it } from 'vitest';
import { buildSections, type LyricLine, type NoteEvent, type PitchTrack, type Section, type Word } from '../src/lib/analysis';
import { scoreTake, sectionCoaching, type TakeScore } from '../src/lib/score';
import { Timeline } from '../src/lib/player';

let lineCounter = 0;
const resetLines = () => { lineCounter = 0; };

function word(text: string, start: number, end: number, extra: Partial<Word> = {}): Word {
  return { text, start, end, syllables: [], ...extra };
}

function line(start: number, text: string, wordSeconds = 0.5): LyricLine {
  const words = text.split(' ').map((part, i) => word(part, start + i * wordSeconds, start + (i + 1) * wordSeconds - 0.05));
  return { id: 'l' + (lineCounter++), start, end: words[words.length - 1].end, words };
}

function tagLine(start: number, tag: string): LyricLine {
  return { id: 'l' + (lineCounter++), start, end: start + 0.5, words: [word(tag, start, start + 0.5, { aside: true, tag: true })] };
}

const notesFor = (lines: LyricLine[]): NoteEvent[] =>
  lines.filter(item => item.words.some(part => !part.aside))
    .map(item => ({ start: item.start, end: item.end, midi: 60 }));

function voiceTrack(midi: number, seconds: number, hop = 0.02): PitchTrack {
  const n = Math.ceil(seconds / hop);
  return { midi: Float32Array.from({ length: n }, () => midi), energy: new Float32Array(n).fill(1), hopSeconds: hop };
}

const takeScore = (partial: Partial<TakeScore>): TakeScore => ({
  score: 70, onPitchWhenSinging: 70, coverage: 80, meanCents: 0, steadiness: 80,
  vibrato: {} as TakeScore['vibrato'], lines: [], words: [], trail: [], ...partial
});

const section = (id: string, label: string, start: number, end: number): Section =>
  ({ id, kind: 'verse', label, start, end });

describe('buildSections: consecutive same-kind merge', () => {
  it('folds unrepeated blocks into one section instead of Verse 1..Verse N', () => {
    resetLines();
    // Five identical blocks: they all cluster, all become choruses, and must merge into one.
    const lines = [10, 19, 28, 37, 46].map(start => line(start, Array(12).fill('na').join(' '), 0.5));
    const sections = buildSections(lines, notesFor(lines), 62, true);
    const choruses = sections.filter(item => item.kind === 'chorus');
    expect(choruses).toHaveLength(1);
    expect(choruses[0].start).toBeLessThanOrEqual(10);
    expect(choruses[0].end).toBeGreaterThanOrEqual(51);
    // Intro and outro handling is untouched.
    expect(sections[0].kind).toBe('intro');
    expect(sections[sections.length - 1].kind).toBe('outro');
  });

  it('never merges non-consecutive same-kind sections', () => {
    resetLines();
    // Alternating word sets: chorus, verse, chorus, verse, chorus.
    const texts = [0, 1, 2, 3, 4].map(i => Array(12).fill(i % 2 === 0 ? 'aaa' : 'ccc').join(' '));
    const lines = [10, 19, 28, 37, 46].map((start, i) => line(start, texts[i], 0.5));
    const sections = buildSections(lines, notesFor(lines), 62, true);
    const kinds = sections.filter(item => item.kind === 'verse' || item.kind === 'chorus').map(item => item.kind);
    expect(kinds).toEqual(['chorus', 'verse', 'chorus', 'verse', 'chorus']);
    const verses = sections.filter(item => item.kind === 'verse');
    expect(verses).toHaveLength(2);
    expect(verses[0].label).toBe('Verse 1');
    expect(verses[1].label).toBe('Verse 2');
  });

  it('merges consecutive same-kind sections from lyric tags', () => {
    resetLines();
    const verse1 = tagLine(0, '[Verse]');
    const sung1 = line(1, 'hello world song');
    const verse2 = tagLine(8, '[Verse]');
    const sung2 = line(9, 'second line here');
    const chorusTag = tagLine(16, '[Chorus]');
    const sung3 = line(17, 'loud chorus line');
    const lines = [verse1, sung1, verse2, sung2, chorusTag, sung3];
    const sections = buildSections(lines, notesFor(lines), 30, true);
    expect(sections.map(item => item.kind)).toEqual(['verse', 'chorus']);
    expect(sections[0].label).toBe('Verse');
    expect(sections[1].label).toBe('Chorus');
  });
});

describe('scoreTake: per-word pitch errors', () => {
  it('records signed mean cents per word', () => {
    resetLines();
    const ln = line(0, 'hey you', 1);
    const notes = [{ start: 0, end: 2, midi: 60 }];
    const timeline = new Timeline([{ start: 0, end: 2 }], 1);
    const flat = scoreTake(voiceTrack(59.5, 2), 0, timeline, notes, [ln], false);
    expect(flat.words).toHaveLength(2);
    expect(flat.words[0]).toMatchObject({ lineId: ln.id, text: 'hey' });
    expect(flat.words[0].meanCents).toBeCloseTo(-50, 0);
    const sharp = scoreTake(voiceTrack(60.5, 2), 0, timeline, notes, [ln], false);
    expect(sharp.words[0].meanCents).toBeCloseTo(50, 0);
  });

  it('skips words with barely any voice and aside words', () => {
    resetLines();
    const ln: LyricLine = {
      id: 'l0', start: 0, end: 2,
      words: [word('hey', 0, 1.9), word('[laughs]', 1.9, 2, { aside: true })]
    };
    const notes = [{ start: 0, end: 2, midi: 60 }];
    const timeline = new Timeline([{ start: 0, end: 2 }], 1);
    // Voice only over the first 0.04 s: too few voiced frames to count.
    const track = voiceTrack(NaN, 2);
    track.midi[0] = 60; track.midi[1] = 60;
    const take = scoreTake(track, 0, timeline, notes, [ln], false);
    expect(take.words).toHaveLength(0);
  });

  it('folds octaves when forgiving, like the line scoring', () => {
    resetLines();
    const ln = line(0, 'hey', 2);
    const notes = [{ start: 0, end: 2, midi: 60 }];
    const timeline = new Timeline([{ start: 0, end: 2 }], 1);
    const take = scoreTake(voiceTrack(71.5, 2), 0, timeline, notes, [ln], true);
    expect(take.words[0].meanCents).toBeCloseTo(-50, 0);
  });
});

describe('sectionCoaching', () => {
  const lines = (): LyricLine[] => {
    resetLines();
    return [line(1, 'alpha beta gamma delta'), line(5, 'epsilon zeta eta theta'), line(12, 'iota kappa lambda mu')];
  };

  it('aggregates frame-weighted scores per section and nulls empty sections', () => {
    const ls = lines();
    const take = takeScore({
      lines: [
        { line: ls[0], percent: 80, meanCents: 0, frames: 100 },
        { line: ls[1], percent: 60, meanCents: 0, frames: 100 },
        { line: ls[2], percent: 40, meanCents: -30, frames: 50 }
      ],
      words: []
    });
    const out = sectionCoaching(take, [section('s1', 'Verse', 0, 10), section('s2', 'Chorus', 10, 20), section('s3', 'Bridge', 20, 30)], ls);
    expect(out[0].score).toBe(70);   // (80*100 + 60*100) / 200
    expect(out[1].score).toBe(40);
    expect(out[2].score).toBeNull();
    expect(out[2].coverage).toBeNull();
    expect(out[2].strengths).toEqual([]);
    expect(out[2].weaknesses).toEqual([]);
    expect(out[2].wordNotes).toEqual([]);
    expect(out[0].sectionId).toBe('s1');
    expect(out[0].label).toBe('Verse');
  });

  it('requires strengths when the score is good and weaknesses when it is not', () => {
    const ls = lines();
    const good = takeScore({ lines: [{ line: ls[0], percent: 90, meanCents: 5, frames: 100 }], words: [] });
    const bad = takeScore({ lines: [{ line: ls[2], percent: 40, meanCents: -35, frames: 100 }], words: [] });
    const sections = [section('s1', 'Verse', 0, 10), section('s2', 'Chorus', 10, 20)];
    const [goodOut] = sectionCoaching(good, sections, ls);
    const [, badOut] = sectionCoaching(bad, sections, ls);
    expect(goodOut.strengths.length).toBeGreaterThan(0);
    expect(goodOut.strengths.every(text => text.length < 90 && !/[\u{1F300}-\u{1FAFF}]/u.test(text))).toBe(true);
    expect(badOut.weaknesses.length).toBeGreaterThan(0);
    expect(badOut.weaknesses.some(text => /flat/.test(text))).toBe(true);
    expect(goodOut.strengths.length).toBeLessThanOrEqual(3);
    expect(badOut.weaknesses.length).toBeLessThanOrEqual(3);
  });

  it('caps word notes at three, filters small drift, and points the right direction', () => {
    const ls = lines();
    const take = takeScore({
      lines: [{ line: ls[0], percent: 70, meanCents: 0, frames: 100 }],
      words: [
        { lineId: ls[0].id, text: 'alpha', meanCents: -45 },
        { lineId: ls[0].id, text: 'beta', meanCents: 30 },
        { lineId: ls[0].id, text: 'gamma', meanCents: 10 },   // too small to mention
        { lineId: ls[0].id, text: 'delta', meanCents: -60 }
      ]
    });
    const [out] = sectionCoaching(take, [section('s1', 'Verse', 0, 10)], ls);
    expect(out.wordNotes.map(note => note.word)).toEqual(['delta', 'alpha', 'beta']);
    expect(out.wordNotes[0]).toMatchObject({ direction: 'flat', cents: -60, lineText: 'alpha beta gamma delta' });
    expect(out.wordNotes[2].direction).toBe('sharp');
    for (const note of out.wordNotes) expect(note.tip).toMatch(/^Try /);
  });

  it('approximates coverage from the share of words with voice', () => {
    const ls = lines();
    const take = takeScore({
      lines: [{ line: ls[0], percent: 70, meanCents: 0, frames: 100 }],
      words: [
        { lineId: ls[0].id, text: 'alpha', meanCents: -25 },
        { lineId: ls[0].id, text: 'beta', meanCents: 25 }
      ]
    });
    const [out] = sectionCoaching(take, [section('s1', 'Verse', 0, 10)], ls);
    expect(out.coverage).toBe(50);   // 2 of 4 words carried voice
  });
});
