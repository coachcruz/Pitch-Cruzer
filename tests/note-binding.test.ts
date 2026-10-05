import { describe, expect, it } from 'vitest';
import {
  alignToMelody, applyTypedLyrics, bindSyllables, buildLines, rebaseToNoteRuns,
  syllablesFromRun, type LyricLine, type NoteEvent, type SongAnalysis,
} from '../src/lib/analysis';
import { pitchVerdict } from '../src/views/practice/karaoke';

/** Line ids are random: strip them before comparing bindings for equality. */
const bindingOf = (lines: LyricLine[]) => lines.map(line => ({
  start: line.start, end: line.end,
  words: line.words.map(word => ({
    text: word.text, start: word.start, end: word.end,
    syllables: word.syllables.map(s => ({ text: s.text, start: s.start, end: s.end, midi: s.midi, notes: s.notes })),
  })),
}));

describe('timestamp-independence (the core invariant)', () => {
  const notes: NoteEvent[] = [
    { start: 1.0, end: 1.4, midi: 60 },
    { start: 1.4, end: 1.8, midi: 62 },
    { start: 1.8, end: 2.2, midi: 64 },
  ];

  it('buildLines with shifted guess times binds identically to correct times', () => {
    const correct = [
      { text: 'love', start: 1.0, end: 1.4 },
      { text: 'you', start: 1.4, end: 1.8 },
    ];
    const shifted = [
      { text: 'love', start: 1.25, end: 1.65 },   // 250 ms late, overlapping the D
      { text: 'you', start: 1.65, end: 2.05 },
    ];
    expect(bindingOf(buildLines(shifted, notes))).toEqual(bindingOf(buildLines(correct, notes)));
  });

  it('typed words inherit heard note runs, never heard timestamps', () => {
    const songNotes: NoteEvent[] = [
      { start: 10.0, end: 10.3, midi: 60 }, { start: 10.3, end: 10.6, midi: 62 },
      { start: 10.6, end: 10.9, midi: 64 },
      { start: 10.9, end: 11.2, midi: 65 }, { start: 11.2, end: 11.5, midi: 67 },
    ];
    // The hearing is absurdly wrong on timing (50 s off) — only the word order matters.
    const analysis: SongAnalysis = {
      duration: 60, key: null, range: null, notes: songNotes, lines: [], sections: [],
      transcript: 'ok', separated: true,
      heard: [
        { text: 'hello', start: 50.0, end: 50.4 },
        { text: 'world', start: 50.5, end: 50.8 },
        { text: 'today', start: 50.9, end: 51.3 },
      ],
    };
    const lines = applyTypedLyrics(analysis, 'hello world today');
    const words = lines.flatMap(line => line.words);
    expect(words.map(word => word.text)).toEqual(['hello', 'world', 'today']);
    expect(words[0].start).toBeCloseTo(10.0, 6);
    expect(words[0].end).toBeCloseTo(10.6, 6);
    expect(words[1].syllables[0].midi).toBe(64);
    expect(words[2].start).toBeCloseTo(10.9, 6);
  });
});

describe('syllablesFromRun', () => {
  it('binds surplus notes to the longest baseline note (Ten-nes-SEE)', () => {
    const run: NoteEvent[] = [
      { start: 0.0, end: 0.2, midi: 60 },
      { start: 0.2, end: 0.4, midi: 62 },
      { start: 0.4, end: 0.9, midi: 64 },   // longest: the stressed SEE
      { start: 0.9, end: 1.1, midi: 65 },
    ];
    const syllables = syllablesFromRun('Tennessee', run);
    expect(syllables.map(s => s.text)).toEqual(['Ten', 'nes', 'see']);
    expect(syllables[0].notes).toEqual([60]);
    expect(syllables[1].notes).toEqual([62]);
    expect(syllables[2].notes).toEqual([64, 65]);
    expect(syllables[2].start).toBeCloseTo(0.4, 6);
    expect(syllables[2].end).toBeCloseTo(1.1, 6);
    expect(syllables[2].midi).toBe(64);   // the longest note of its sub-run
  });

  it('breaks baseline-length ties toward the later syllable', () => {
    const run: NoteEvent[] = [0, 1, 2, 3].map(i => ({ start: i * 0.2, end: (i + 1) * 0.2, midi: 60 + i }));
    const syllables = syllablesFromRun('Tennessee', run);
    expect(syllables[2].notes).toEqual([62, 63]);
    expect(syllables[0].notes).toEqual([60]);
    expect(syllables[1].notes).toEqual([61]);
  });

  it('a melisma: one syllable spans its whole run, midi is the longest note', () => {
    const syllables = syllablesFromRun('Ah', [
      { start: 1.0, end: 1.3, midi: 60 },
      { start: 1.3, end: 1.5, midi: 62 },
      { start: 1.5, end: 2.0, midi: 64 },
    ]);
    expect(syllables).toHaveLength(1);
    expect(syllables[0].start).toBe(1.0);
    expect(syllables[0].end).toBe(2.0);
    expect(syllables[0].midi).toBe(64);
    expect(syllables[0].notes).toEqual([60, 62, 64]);
  });

  it('fewer notes than syllables: trailing parts are unvoiced, midi null', () => {
    const syllables = syllablesFromRun('banana', [
      { start: 0.0, end: 0.3, midi: 60 },
      { start: 0.3, end: 0.6, midi: 62 },
    ]);
    expect(syllables.map(s => s.text)).toEqual(['ba', 'na', 'na']);
    expect(syllables[0].midi).toBe(60);
    expect(syllables[1].midi).toBe(62);
    expect(syllables[2].midi).toBeNull();
    expect(syllables[2].notes).toEqual([]);
    expect(Number.isNaN(syllables[2].start)).toBe(true);
  });

  it('an empty run leaves every part unvoiced', () => {
    const syllables = syllablesFromRun('hello', []);
    expect(syllables.map(s => s.midi)).toEqual([null, null]);
  });
});

describe('bindSyllables', () => {
  it('never puts a long gap inside one syllable’s run', () => {
    const runs = bindSyllables([{ text: 'a' }, { text: 'b' }], [
      { start: 0.0, end: 0.4, midi: 60 },
      { start: 1.2, end: 1.6, midi: 62 },   // 0.8 s gap: not one run
    ]);
    expect(runs[0].map(n => n.midi)).toEqual([60]);
    expect(runs[1].map(n => n.midi)).toEqual([62]);
  });

  it('melisma ties go to the later syllable', () => {
    const notes: NoteEvent[] = [0, 1, 2].map(i => ({ start: i * 0.3, end: (i + 1) * 0.3, midi: 60 + i }));
    const runs = bindSyllables([{ text: 'Ten' }, { text: 'see' }], notes);
    // Two 1-note runs + a skip (0.3) loses to a 2-note run on the later syllable.
    expect(runs[1].length).toBe(2);
    expect(runs[0].length).toBe(1);
  });

  it('scarce notes go to the earlier syllables; the trailing ones stay unvoiced', () => {
    const runs = bindSyllables([{ text: 'ba' }, { text: 'na' }, { text: 'na' }], [
      { start: 0.0, end: 0.3, midi: 60 },
      { start: 0.3, end: 0.6, midi: 62 },
    ]);
    expect(runs[0].map(n => n.midi)).toEqual([60]);
    expect(runs[1].map(n => n.midi)).toEqual([62]);
    expect(runs[2]).toEqual([]);
  });

  it('is deterministic and handles empty inputs', () => {
    const notes: NoteEvent[] = [{ start: 0, end: 0.3, midi: 60 }];
    const a = bindSyllables([{ text: 'x' }], notes);
    const b = bindSyllables([{ text: 'x' }], notes);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(bindSyllables([], notes)).toEqual([]);
    expect(bindSyllables([{ text: 'x' }], [])).toEqual([[]]);
  });
});

describe('unvoiced interpolation', () => {
  it('trailing unvoiced syllables clamp to the last voiced end', () => {
    const lines = buildLines([{ text: 'banana', start: 5, end: 6 }], [
      { start: 0.0, end: 0.3, midi: 60 },
      { start: 0.3, end: 0.6, midi: 62 },
    ]);
    const word = lines[0].words[0];
    expect(word.syllables[2].midi).toBeNull();
    expect(word.syllables[2].start).toBeCloseTo(0.6, 6);
    expect(word.syllables[2].end).toBeCloseTo(0.6, 6);
    expect(word.end).toBeCloseTo(0.6, 6);
    // …and the word no longer sits at the guessed time.
    expect(word.start).toBeCloseTo(0.0, 6);
  });
});

describe('rebaseToNoteRuns (old-song upgrade)', () => {
  it('re-derives a guess-shifted line from the notes, keeping ids and order', () => {
    // Integer times: the two notes are exactly the same length, so the longest-note tie
    // genuinely breaks toward the first.
    const notes: NoteEvent[] = [
      { start: 10, end: 14, midi: 60 },
      { start: 14, end: 18, midi: 62 },
    ];
    // Saved by the old binding: the guessed window overlapped D, so the syllable carries D.
    const lines: LyricLine[] = [{
      id: 'l1', start: 12.5, end: 16.5,
      words: [{
        text: 'love', start: 12.5, end: 16.5, lang: 'en',
        syllables: [{ text: 'love', start: 12.5, end: 16.5, midi: 62, notes: [62] }],
      }],
    }];
    rebaseToNoteRuns(lines, notes);
    expect(lines[0].id).toBe('l1');
    const syllable = lines[0].words[0].syllables[0];
    expect(syllable.start).toBeCloseTo(10, 6);
    expect(syllable.midi).toBe(60);   // from its own run, not the old window
    expect(syllable.notes).toEqual([60, 62]);
    expect(lines[0].start).toBeCloseTo(10, 6);
  });

  it('moves the monotonic cursor on: lines cannot steal each other’s notes', () => {
    const notes: NoteEvent[] = [
      { start: 1.0, end: 1.4, midi: 60 },
      { start: 5.0, end: 5.4, midi: 62 },
    ];
    const word = (start: number, end: number) => ({
      text: 'ah', start, end, syllables: [{ text: 'ah', start, end, midi: null as number | null, notes: [] as number[] }],
    });
    const lines: LyricLine[] = [
      { id: 'l1', start: 1.0, end: 1.4, words: [word(1.0, 1.4)] },
      { id: 'l2', start: 5.0, end: 5.4, words: [word(5.0, 5.4)] },
    ];
    rebaseToNoteRuns(lines, notes);
    expect(lines[0].words[0].syllables[0].midi).toBe(60);
    expect(lines[1].words[0].syllables[0].midi).toBe(62);
  });
});

describe('alignToMelody note runs', () => {
  it('returns each word’s run as indices into its notes argument', () => {
    const notes: NoteEvent[] = [
      { start: 0.0, end: 0.3, midi: 60 },
      { start: 0.3, end: 0.6, midi: 62 },
    ];
    const out = alignToMelody([['hello', 'world']], notes);
    expect(out).toHaveLength(2);
    // 'hello' (2 syllables) shares the two notes; 'world' takes the second.
    expect(out[0].from).toBe(0);
    expect(out[0].start).toBeCloseTo(notes[out[0].from].start, 6);
    expect(out[1].from).toBe(1);
    expect(out[1].to).toBe(1);
    expect(out[1].start).toBeCloseTo(0.4, 6);
  });
});

describe('pitchVerdict flexible octave', () => {
  it('an exact octave off is perfect when forgiving, blue when not', () => {
    expect(pitchVerdict(72, 60, 0.5, true)).toBe('perfect');
    expect(pitchVerdict(72, 60, 0.5, false)).toBe('blue');
    expect(pitchVerdict(48.2, 60, 0.5, true)).toBe('perfect');
    expect(pitchVerdict(48.2, 60, 0.5, false)).toBe('blue');
  });

  it('a wrong note class is never perfect, even when forgiving', () => {
    expect(pitchVerdict(62, 60, 0.5, true)).not.toBe('perfect');
    expect(pitchVerdict(60.2, 60, 0.5, true)).toBe('perfect');
  });
});
