import { describe, expect, it } from 'vitest';
import { pitchVerdict, snapToNoteOnset } from '../src/views/practice/karaoke';
import type { NoteEvent } from '../src/lib/analysis';

const notes = (starts: number[]): NoteEvent[] =>
  starts.map(start => ({ start, end: start + 0.4, midi: 60 }));

describe('pitchVerdict', () => {
  it('calls it perfect within a quarter tone', () => {
    expect(pitchVerdict(60.2, 60, 0.5)).toBe('perfect');
    expect(pitchVerdict(59.5, 60, 0.5)).toBe('perfect');
  });

  it('calls the right note in the wrong octave blue', () => {
    expect(pitchVerdict(72.1, 60, 0.5)).toBe('blue');
    expect(pitchVerdict(47.9, 60, 0.5)).toBe('blue');
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
