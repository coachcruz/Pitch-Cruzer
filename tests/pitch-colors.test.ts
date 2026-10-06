import { describe, expect, it } from 'vitest';
import { pitchVerdict, snapToNoteOnset } from '../src/views/practice/karaoke';
import { buildLines, noteAt, type NoteEvent } from '../src/lib/analysis';

const notes = (starts: number[]): NoteEvent[] =>
  starts.map(start => ({ start, end: start + 0.4, midi: 60 }));

describe('pitchVerdict', () => {
  it('calls it perfect within a quarter tone', () => {
    expect(pitchVerdict(60.2, 60, 0.5)).toBe('perfect');
    expect(pitchVerdict(59.5, 60, 0.5)).toBe('perfect');
  });

  it('calls the right note in the wrong octave red without forgiveness, graded with it', () => {
    // One comparison everywhere: without forgiveness a wrong octave is red, like the staff trail.
    expect(pitchVerdict(72.1, 60, 0.5)).toBe('red');
    expect(pitchVerdict(47.9, 60, 0.5)).toBe('red');
    // With forgiveness the octave folds first: 72.8 -> 60.8 (blue), 47.9 -> 59.9 (perfect).
    expect(pitchVerdict(72.8, 60, 0.5, true)).toBe('blue');
    expect(pitchVerdict(47.9, 60, 0.5, true)).toBe('perfect');
  });

  it('calls almost-on-pitch blue', () => {
    expect(pitchVerdict(60.8, 60, 0.5)).toBe('blue');
    expect(pitchVerdict(59.1, 60, 0.5)).toBe('blue');
  });

  it('calls a wrong note red', () => {
    expect(pitchVerdict(62, 60, 0.5)).toBe('red');
    expect(pitchVerdict(57.5, 60, 0.5)).toBe('red');
  });

  it('calls no voice over the word silent, after a short grace', () => {
    expect(pitchVerdict(null, 60, 0.05)).toBeNull();
    expect(pitchVerdict(null, 60, 0.15)).toBe('silent');
    expect(pitchVerdict(null, 60, 1.2)).toBe('silent');
  });
});

describe('snapToNoteOnset', () => {
  it('pulls the word start to a nearby note onset', () => {
    expect(snapToNoteOnset(1.1, 1.8, notes([1.02, 2.5]))).toBeCloseTo(1.02, 6);
  });

  it('leaves the start alone when no onset is close', () => {
    expect(snapToNoteOnset(1.1, 1.8, notes([2.5]))).toBe(1.1);
    expect(snapToNoteOnset(1.1, 1.8, [])).toBe(1.1);
  });

  it('never snaps past the word end', () => {
    expect(snapToNoteOnset(1.1, 1.15, notes([1.12]))).toBe(1.1);
  });

  it('picks the nearest onset', () => {
    expect(snapToNoteOnset(1.1, 2.0, notes([1.2, 0.95]))).toBeCloseTo(1.2, 6);
  });
});

describe('noteAt', () => {
  const two = [
    { start: 1.0, end: 1.4, midi: 60 },
    { start: 1.4, end: 1.8, midi: 62 },
  ];

  it('finds the note sounding at a time', () => {
    expect(noteAt(two, 1.2)?.midi).toBe(60);
    expect(noteAt(two, 1.6)?.midi).toBe(62);
  });

  it('is start-inclusive and end-exclusive', () => {
    expect(noteAt(two, 1.0)?.midi).toBe(60);
    expect(noteAt(two, 1.4)?.midi).toBe(62);
  });

  it('returns null in a rest or with no notes', () => {
    expect(noteAt(two, 0.5)).toBeNull();
    expect(noteAt(two, 2.5)).toBeNull();
    expect(noteAt([], 1.2)).toBeNull();
  });
});

describe('live verdict follows the sounding note, not the word window', () => {
  // The artist sings C (10-14) then D (14-18), each exactly 4 s. Transcription heard the C word
  // 2.5 s late, so the word's guessed time window overlaps mostly D.
  const notes: NoteEvent[] = [
    { start: 10, end: 14, midi: 60 },
    { start: 14, end: 18, midi: 62 },
  ];
  const lateHeard = [{ text: 'love', start: 12.5, end: 16.5 }];

  it('an offset word no longer attaches the neighbouring note', () => {
    // The guessed window [12.5, 16.5] overlaps D more than C — the old binding put a D here.
    // The note-run binding ignores the guess: the syllable binds the C's run instead.
    const word = buildLines(lateHeard, notes)[0].words[0];
    expect(word.syllables[0].midi).toBe(60);
    expect(word.syllables[0].start).toBeCloseTo(10, 6);
  });

  it('a shifted guess grades the same as a correct one', () => {
    const onTime = buildLines([{ text: 'love', start: 10, end: 14 }], notes)[0].words[0];
    const late = buildLines(lateHeard, notes)[0].words[0];
    expect(pitchVerdict(60.05, onTime.syllables[0].midi!, 0.5)).toBe('perfect');
    expect(pitchVerdict(60.05, late.syllables[0].midi!, 0.5)).toBe('perfect');
  });

  it('the verdict target is the note sounding now, whatever the word window says', () => {
    // At 11.3 s the artist sings C: a sung C is perfect even though the word claims D.
    expect(noteAt(notes, 11.3)?.midi).toBe(60);
    expect(pitchVerdict(60.05, noteAt(notes, 11.3)!.midi, 0.5)).toBe('perfect');
    // And at 15 s the artist sings D: a sung C is wrong, even for the C word.
    expect(noteAt(notes, 15)?.midi).toBe(62);
    expect(pitchVerdict(60.05, noteAt(notes, 15)!.midi, 0.5)).toBe('red');
  });
});
