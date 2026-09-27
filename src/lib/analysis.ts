import { estimateKey, median, type MusicalKey } from './music';
import type { TimedWord } from './transcribe.worker';

export interface PitchTrack { midi: Float32Array; energy: Float32Array; hopSeconds: number }

/** One sung note of the original vocal: a stable pitch held for a stretch of time. */
export interface NoteEvent { start: number; end: number; midi: number }

export interface Syllable { text: string; start: number; end: number; midi: number | null; notes: number[] }
export interface Word { text: string; start: number; end: number; syllables: Syllable[]; lang?: string }
export interface LyricLine { id: string; start: number; end: number; words: Word[] }

/** 'part' only appears in songs saved by older versions (they're relabeled when opened). */
export type SectionKind = 'intro' | 'verse' | 'pre' | 'chorus' | 'bridge' | 'instrumental' | 'outro' | 'part';
export interface Section { id: string; kind: SectionKind; label: string; start: number; end: number }

/** Bump when note detection changes, so saved songs re-check their notes when opened. */
export const NOTES_VERSION = 2;

export interface SongAnalysis {
  duration: number;
  notesVersion?: number;
  key: MusicalKey | null;
  range: [number, number] | null;
  notes: NoteEvent[];
  lines: LyricLine[];
  sections: Section[];
  transcript: 'ok' | 'none' | 'failed' | 'edited';
  /** Lyrics are still being written in the background (the song is already practicable). */
  lyricsPending?: boolean;
  separated: boolean;
  lyricsOptions?: LyricsOptions;
}

export interface LyricsOptions { languages: string[]; quality: 'fast' | 'best' }

/** Where to breathe: silences between sung notes long enough to take a breath. */
export interface BreathMark { time: number; length: number }

export function breathMarks(notes: NoteEvent[], minGap = 0.3): BreathMark[] {
  const marks: BreathMark[] = [];
  for (let i = 1; i < notes.length; i += 1) {
    const gap = notes[i].start - notes[i - 1].end;
    if (gap >= minGap && gap < 6) marks.push({ time: notes[i - 1].end, length: gap });
  }
  return marks;
}

export const SECTION_NAMES: Record<SectionKind, string> = {
  intro: 'Intro', verse: 'Verse', pre: 'Pre-Chorus', chorus: 'Chorus', bridge: 'Bridge',
  instrumental: 'Instrumental', outro: 'Outro', part: 'Part'
};

// ---------------------------------------------------------------- notes

function smoothTrack(midi: Float32Array): Float32Array {
  const out = new Float32Array(midi.length);
  const window: number[] = [];
  for (let i = 0; i < midi.length; i += 1) {
    if (Number.isNaN(midi[i])) { out[i] = NaN; continue; }
    window.length = 0;
    for (let j = i - 2; j <= i + 2; j += 1) {
      if (j >= 0 && j < midi.length && !Number.isNaN(midi[j])) window.push(midi[j]);
    }
    out[i] = median(window);
  }
  // Octave flips: pitch detectors sometimes read a moment of a held note exactly an octave off.
  // A real voice doesn't jump an octave for a fraction of a second and back, so any reading an
  // octave away from its surroundings (±0.25 s) is moved back into line.
  for (let pass = 0; pass < 2; pass += 1) {
    const snapshot = out.slice();
    for (let i = 0; i < out.length; i += 1) {
      if (Number.isNaN(snapshot[i])) continue;
      window.length = 0;
      for (let j = i - 12; j <= i + 12; j += 1) {
        if (j !== i && j >= 0 && j < out.length && !Number.isNaN(snapshot[j])) window.push(snapshot[j]);
      }
      if (window.length < 6) continue;
      const context = median(window);
      const offset = snapshot[i] - context;
      if (offset < -9.5 && offset > -14.5) out[i] = snapshot[i] + 12;
      else if (offset > 9.5 && offset < 14.5) out[i] = snapshot[i] - 12;
    }
  }
  return out;
}

/**
 * Note-level octave check: a short note sitting an octave below (or above) everything sung around it
 * (±3 s) is almost always a detection error. Long notes are kept as sung, so deliberate low drops
 * (e.g. a held subharmonic at the end of a phrase) are not "corrected".
 */
function fixOctaveOutliers(notes: NoteEvent[]): NoteEvent[] {
  const fixed = notes.map(note => ({ ...note }));
  for (let i = 0; i < fixed.length; i += 1) {
    const note = fixed[i];
    const duration = note.end - note.start;
    const around: number[] = [];
    for (const other of notes) {
      if (other === notes[i] || other.end < note.start - 3 || other.start > note.end + 3) continue;
      const weight = Math.max(1, Math.round((other.end - other.start) / 0.1));
      for (let k = 0; k < weight; k += 1) around.push(other.midi);
    }
    if (around.length < 4) continue;
    const context = median(around);
    const offset = note.midi - context;
    if (offset <= -9.5 && duration < 1.0 && Math.abs(note.midi + 12 - context) <= 6) note.midi += 12;
    else if (offset >= 9.5 && duration < 0.6 && Math.abs(note.midi - 12 - context) <= 6) note.midi -= 12;
  }
  return fixed;
}

/** Splits a pitch track into held notes, tolerant of vibrato and brief dropouts. */
export function segmentNotes(track: PitchTrack): NoteEvent[] {
  const midi = smoothTrack(track.midi);
  const hop = track.hopSeconds;
  const notes: NoteEvent[] = [];
  let runStart = -1;
  let values: number[] = [];
  let pending: number[] = [];
  let unvoiced = 0;

  const close = (endIndex: number) => {
    if (runStart >= 0 && values.length) {
      const start = runStart * hop;
      const end = endIndex * hop;
      if (end - start >= 0.08) notes.push({ start, end, midi: median(values) });
    }
    runStart = -1;
    values = [];
    pending = [];
  };

  for (let i = 0; i < midi.length; i += 1) {
    const value = midi[i];
    if (Number.isNaN(value)) {
      unvoiced += 1;
      if (unvoiced >= 3) close(i - unvoiced + 1);
      continue;
    }
    unvoiced = 0;
    if (runStart < 0) { runStart = i; values = [value]; continue; }
    const recent = values.slice(-12);
    const center = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (Math.abs(value - center) > 0.8) {
      pending.push(value);
      if (pending.length >= 3) {
        const carry = pending;
        close(i - carry.length + 1);
        runStart = i - carry.length + 1;
        values = carry;
      }
    } else {
      values.push(...pending, value);
      pending = [];
    }
  }
  close(midi.length);

  // Merge repeated notes separated by a tiny gap (consonants).
  const merged: NoteEvent[] = [];
  for (const note of fixOctaveOutliers(notes)) {
    const last = merged[merged.length - 1];
    if (last && Math.round(last.midi) === Math.round(note.midi) && note.start - last.end < 0.09) {
      const total = (last.end - last.start) + (note.end - note.start);
      last.midi = (last.midi * (last.end - last.start) + note.midi * (note.end - note.start)) / total;
      last.end = note.end;
    } else merged.push({ ...note });
  }
  return merged;
}

export function keyAndRange(notes: NoteEvent[]): { key: MusicalKey | null; range: [number, number] | null } {
  if (!notes.length) return { key: null, range: null };
  const histogram = new Array<number>(12).fill(0);
  const weighted: Array<[number, number]> = [];
  for (const note of notes) {
    const duration = note.end - note.start;
    const rounded = Math.round(note.midi);
    histogram[((rounded % 12) + 12) % 12] += duration;
    weighted.push([rounded, duration]);
  }
  weighted.sort((a, b) => a[0] - b[0]);
  const total = weighted.reduce((sum, [, d]) => sum + d, 0);
  const percentile = (p: number) => {
    let acc = 0;
    for (const [value, duration] of weighted) {
      acc += duration;
      if (acc >= total * p) return value;
    }
    return weighted[weighted.length - 1][0];
  };
  return { key: estimateKey(histogram), range: [percentile(0.02), percentile(0.98)] };
}

// ---------------------------------------------------------------- syllables + lines

const VOWELS = 'aeiouyáéíóúüàèìòùâêîôûãõäëïöåæøœ';
const SYLLABLE = new RegExp(`[^${VOWELS}]*[${VOWELS}]+(?:[^${VOWELS}]*$|[^${VOWELS}](?=[^${VOWELS}]))?`, 'giu');

/**
 * Rough syllabification for English/Spanish/other Latin-script lyrics: vowel groups, with English
 * silent-e and -ed/-es endings merged back. Other scripts are kept as one unit.
 */
export function syllabify(word: string): string[] {
  const clean = word.replace(/[^\p{L}\p{M}']/gu, '');
  if ([...clean].length <= 3) return [clean || word];
  const parts = clean.match(SYLLABLE);
  if (!parts || parts.length < 2 || parts.join('') !== clean) return [clean];
  const last = parts[parts.length - 1];
  const previous = parts[parts.length - 2];
  const silentE = /^[^aeiouy]*e$/i.test(last) && !/[^aeiouy]le$/i.test(previous.slice(-1) + last);
  const quietEnding = /^[^aeiouy]*e[sd]$/i.test(last) && !/[td]$/i.test(previous) && !/^[td]/i.test(last);
  if (silentE || quietEnding) {
    parts.splice(parts.length - 2, 2, previous + last);
  }
  return parts;
}

function overlapping(notes: NoteEvent[], start: number, end: number): NoteEvent[] {
  return notes.filter(note => note.end > start && note.start < end);
}

function dominantMidi(notes: NoteEvent[], start: number, end: number): number | null {
  let best: NoteEvent | null = null;
  let bestOverlap = 0;
  for (const note of notes) {
    const overlap = Math.min(end, note.end) - Math.max(start, note.start);
    if (overlap > bestOverlap) { bestOverlap = overlap; best = note; }
  }
  return best ? best.midi : null;
}

function distinctRounded(notes: NoteEvent[]): number[] {
  const out: number[] = [];
  for (const note of notes) {
    const rounded = Math.round(note.midi);
    if (out[out.length - 1] !== rounded) out.push(rounded);
  }
  return out.slice(0, 6);
}

export function buildWord(text: string, start: number, end: number, notes: NoteEvent[], lang?: string): Word {
  const parts = syllabify(text);
  const inside = overlapping(notes, start, end);
  const syllables: Syllable[] = [];

  if (inside.length >= parts.length && parts.length > 1) {
    // Enough sung notes: give each syllable its own run of notes.
    parts.forEach((part, k) => {
      const from = Math.floor((k * inside.length) / parts.length);
      const to = Math.max(from + 1, Math.floor(((k + 1) * inside.length) / parts.length));
      const slice = inside.slice(from, to);
      const s = k === 0 ? start : Math.max(start, slice[0].start);
      const e = k === parts.length - 1 ? end : Math.min(end, slice[slice.length - 1].end);
      syllables.push({ text: part, start: s, end: Math.max(e, s + 0.02), midi: dominantMidi(slice, s, e), notes: distinctRounded(slice) });
    });
  } else {
    // Otherwise split the word's time by syllable length.
    const weights = parts.map(part => Math.max(1, part.length));
    const total = weights.reduce((a, b) => a + b, 0);
    let cursor = start;
    parts.forEach((part, k) => {
      const e = k === parts.length - 1 ? end : cursor + ((end - start) * weights[k]) / total;
      const slice = overlapping(inside, cursor, e);
      syllables.push({ text: part, start: cursor, end: e, midi: dominantMidi(slice, cursor, e), notes: distinctRounded(slice) });
      cursor = e;
    });
  }
  return { text, start, end, syllables, lang };
}

let lineCounter = 0;
const lineId = () => 'l' + (lineCounter += 1).toString(36) + Math.random().toString(36).slice(2, 6);

export function groupLines(words: Word[], hardBreaks: Set<number> = new Set()): LyricLine[] {
  const lines: LyricLine[] = [];
  let current: Word[] = [];
  const flush = () => {
    if (current.length) lines.push({ id: lineId(), start: current[0].start, end: current[current.length - 1].end, words: current });
    current = [];
  };
  words.forEach((word, index) => {
    const previous = current[current.length - 1];
    if (previous) {
      const gap = word.start - previous.end;
      const lineDuration = word.end - current[0].start;
      const punctuated = /[.,!?;:]$/.test(previous.text) && current.length >= 4;
      if (hardBreaks.has(index) || (hardBreaks.size === 0 && (
        gap >= 1.0 || (gap >= 0.45 && current.length >= 3) || lineDuration > 7 || current.length >= 12 || punctuated
      ))) flush();
    }
    current.push(word);
  });
  flush();
  return lines;
}

/** Without lyrics, turn sung phrases into lines of ♪ so notes are still shown in time. */
function linesFromNotes(notes: NoteEvent[]): LyricLine[] {
  const words: Word[] = notes.map(note => ({
    text: '♪', start: note.start, end: note.end,
    syllables: [{ text: '♪', start: note.start, end: note.end, midi: note.midi, notes: [Math.round(note.midi)] }]
  }));
  const lines: LyricLine[] = [];
  let current: Word[] = [];
  for (const word of words) {
    const previous = current[current.length - 1];
    if (previous && (word.start - previous.end > 0.5 || word.end - current[0].start > 7)) {
      lines.push({ id: lineId(), start: current[0].start, end: previous.end, words: current });
      current = [];
    }
    current.push(word);
  }
  if (current.length) lines.push({ id: lineId(), start: current[0].start, end: current[current.length - 1].end, words: current });
  return lines;
}

export function buildLines(timed: TimedWord[], notes: NoteEvent[]): LyricLine[] {
  if (!timed.length) return linesFromNotes(notes);
  const words = timed.map(word => buildWord(word.text, word.start, word.end, notes, word.lang));
  return groupLines(words);
}

const normalizeWord = (value: string) => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}']/gu, '');

/**
 * Times lyrics from the melody alone (no transcript): each syllable is sung on a note, and lines start
 * after breaths. Lines are matched to the sung phrases (runs of notes between breaths) by dynamic
 * programming — a line takes one or more phrases (or two short lines share one) so that its syllable
 * count fits the phrase's note count; stray phrases (ad-libs, humming) can be skipped. Within a line,
 * syllables are laid on its notes in order (a syllable held over several notes is fine).
 * Returns [start, end] for every word, in order.
 */
export function alignToMelody(lines: string[][], notes: NoteEvent[]): Array<[number, number]> {
  const phrases: NoteEvent[][] = [];
  for (const note of notes) {
    const last = phrases[phrases.length - 1];
    if (last && note.start - last[last.length - 1].end < 0.3) last.push(note);
    else phrases.push([note]);
  }
  const syllables = lines.map(words => words.map(word => Math.max(1, syllabify(word).length)));
  const lineSyllables = syllables.map(counts => counts.reduce((a, b) => a + b, 0));
  const noteCount = (from: number, to: number) => phrases.slice(from, to).reduce((sum, phrase) => sum + phrase.length, 0);
  // How badly `s` syllables fit `n` notes: extra notes (held/melismatic syllables) are cheaper than
  // too few (several syllables on one note).
  // A sung line rarely runs through a long silence: joining phrases across one costs extra.
  const silenceInside = (from: number, to: number) => {
    let penalty = 0;
    for (let x = from + 1; x < to; x += 1) penalty += 0.4 * Math.max(0, phrases[x][0].start - phrases[x - 1][phrases[x - 1].length - 1].end - 0.6);
    return penalty;
  };
  const misfit = (s: number, n: number) => { const r = Math.log((n + 0.5) / (s + 0.5)); return r > 0 ? 0.6 * r : -r; };

  const L = lines.length, P = phrases.length;
  const cost: number[][] = Array.from({ length: L + 1 }, () => new Array(P + 1).fill(Infinity));
  const step: Array<Array<{ i: number; j: number; kind: 'line' | 'pair' | 'skip' } | null>> = Array.from({ length: L + 1 }, () => new Array(P + 1).fill(null));
  cost[0][0] = 0;
  for (let i = 0; i <= L; i += 1) {
    for (let j = 0; j <= P; j += 1) {
      const here = cost[i][j];
      if (!Number.isFinite(here)) continue;
      const relax = (ni: number, nj: number, value: number, kind: 'line' | 'pair' | 'skip') => {
        if (value < cost[ni][nj]) { cost[ni][nj] = value; step[ni][nj] = { i, j, kind }; }
      };
      if (j < P) relax(i, j + 1, here + 0.25 + 0.6 * Math.min(1, phrases[j].length / 6), 'skip');
      if (i < L) {
        for (let k = 1; k <= 4 && j + k <= P; k += 1) relax(i + 1, j + k, here + misfit(lineSyllables[i], noteCount(j, j + k)) + 0.12 * (k - 1) + silenceInside(j, j + k), 'line');
        if (i + 1 < L && j < P) relax(i + 2, j + 1, here + misfit(lineSyllables[i] + lineSyllables[i + 1], noteCount(j, j + 1)) + 0.35, 'pair');
      }
    }
  }
  // Walk back: which phrases each line got.
  const assigned: Array<{ lines: number[]; phrases: [number, number] }> = [];
  let i = L, j = P;
  if (!Number.isFinite(cost[L][P])) return lines.flat().map(() => [0, 0.3]);
  while (i > 0 || j > 0) {
    const back = step[i][j]!;
    if (back.kind === 'line') assigned.unshift({ lines: [back.i], phrases: [back.j, j] });
    if (back.kind === 'pair') assigned.unshift({ lines: [back.i, back.i + 1], phrases: [back.j, j] });
    i = back.i; j = back.j;
  }

  const times: Array<[number, number]> = [];
  for (const group of assigned) {
    const groupNotes = phrases.slice(group.phrases[0], group.phrases[1]).flat();
    const counts = group.lines.flatMap(index => syllables[index]);
    const total = counts.reduce((a, b) => a + b, 0);
    // Syllable k of the group → [start, end] on the notes.
    const sylTime = (k: number): [number, number] => {
      const n = groupNotes.length;
      if (n >= total) {
        const a = Math.floor((k * n) / total), b = Math.max(a, Math.floor(((k + 1) * n) / total) - 1);
        return [groupNotes[a].start, groupNotes[b].end];
      }
      // More syllables than notes: share the sung time out evenly, note by note.
      const spans = groupNotes.map(note => note.end - note.start);
      const sung = spans.reduce((a, b) => a + b, 0);
      const at = (fraction: number) => {
        let left = fraction * sung;
        for (let x = 0; x < groupNotes.length; x += 1) {
          if (left <= spans[x] || x === groupNotes.length - 1) return groupNotes[x].start + Math.min(left, spans[x]);
          left -= spans[x];
        }
        return groupNotes[groupNotes.length - 1].end;
      };
      return [at(k / total), at((k + 1) / total)];
    };
    let k = 0;
    for (const count of counts) {
      const first = sylTime(k), last = sylTime(k + count - 1);
      times.push([first[0], Math.max(last[1], first[0] + 0.08)]);
      k += count;
    }
  }
  return times;
}

/**
 * Replaces the transcript with lyrics the singer typed/pasted. Words are matched to the
 * automatic transcript (edit-distance alignment) to keep timing; unmatched words are interpolated.
 */
export function applyTypedLyrics(analysis: SongAnalysis, text: string): LyricLine[] {
  const typedLines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const typed: string[] = [];
  const hardBreaks = new Set<number>();
  for (const line of typedLines) {
    hardBreaks.add(typed.length);
    typed.push(...line.split(/\s+/).filter(Boolean));
  }
  if (!typed.length) return analysis.lines;

  const old = analysis.lines.flatMap(line => line.words).filter(word => word.text !== '♪');
  const times: Array<[number, number] | null> = new Array(typed.length).fill(null);

  if (old.length) {
    const n = typed.length, m = old.length;
    const cost: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= n; i += 1) {
      for (let j = 1; j <= m; j += 1) {
        const same = normalizeWord(typed[i - 1]) === normalizeWord(old[j - 1].text) ? 0 : 1;
        cost[i][j] = Math.min(cost[i - 1][j - 1] + same, cost[i - 1][j] + 1, cost[i][j - 1] + 1);
      }
    }
    let i = n, j = m;
    while (i > 0 && j > 0) {
      const same = normalizeWord(typed[i - 1]) === normalizeWord(old[j - 1].text) ? 0 : 1;
      if (cost[i][j] === cost[i - 1][j - 1] + same) {
        times[i - 1] = [old[j - 1].start, old[j - 1].end];
        i -= 1; j -= 1;
      } else if (cost[i][j] === cost[i - 1][j] + 1) i -= 1;
      else j -= 1;
    }
  } else if (analysis.notes.length) {
    // No transcript to borrow timing from: match the lyrics to the melody itself.
    const lineStarts = [...hardBreaks].sort((x, y) => x - y);
    const lines = lineStarts.map((from, i) => typed.slice(from, i + 1 < lineStarts.length ? lineStarts[i + 1] : typed.length));
    alignToMelody(lines, analysis.notes).forEach((time, index) => { times[index] = time; });
  }

  // Interpolate words that did not match anything.
  const filled: Array<[number, number]> = [];
  for (let index = 0; index < typed.length; index += 1) {
    if (times[index]) { filled.push(times[index]!); continue; }
    let next = index + 1;
    while (next < typed.length && !times[next]) next += 1;
    const prevEnd = index > 0 ? filled[index - 1][1] : 0;
    const nextStart = next < typed.length ? times[next]![0] : Math.min(analysis.duration, prevEnd + 0.4 * (next - index));
    const slot = Math.max(0.1, (nextStart - prevEnd) / (next - index));
    filled.push([prevEnd, prevEnd + slot * 0.9]);
  }

  const words = typed.map((text, index) => buildWord(text, filled[index][0], Math.max(filled[index][1], filled[index][0] + 0.08), analysis.notes));
  return groupLines(words, hardBreaks);
}

/** One line of timed lyrics (from LRCLIB's "[mm:ss.xx] text" format). */
export interface SyncedLine { time: number; text: string }

export function parseSyncedLyrics(lrc: string): SyncedLine[] {
  const lines: SyncedLine[] = [];
  for (const row of lrc.split(/\r?\n/)) {
    const match = row.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
    if (match) lines.push({ time: Number(match[1]) * 60 + Number(match[2]), text: match[3].trim() });
  }
  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Times the song from lyrics that already say when each line starts — no transcription needed.
 * The recording may start earlier or later than the original (a longer intro, a trimmed start), so
 * the lyrics are first slid (±40 s) until their line starts land on the singer's phrase starts. Each
 * line's words are then spread over the notes sung in that line. Returns null if the lyrics don't
 * fit this recording (another version, a live take…), so the caller can fall back.
 */
export function alignSyncedLyrics(analysis: SongAnalysis, synced: SyncedLine[]): { lines: LyricLine[]; offset: number; fit: number } | null {
  const notes = analysis.notes;
  const sung = synced.filter(line => line.text && !/^[♪\s]*$/.test(line.text));
  if (sung.length < 3 || notes.length < 8) return null;
  // Where the singer starts a phrase: the first note after a gap.
  const onsets = notes.filter((note, i) => i === 0 || note.start - notes[i - 1].end >= 0.25).map(note => note.start);
  const nearest = (time: number) => {
    let lo = 0, hi = onsets.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (onsets[mid] < time) lo = mid + 1; else hi = mid; }
    return Math.min(Math.abs(onsets[lo] - time), lo > 0 ? Math.abs(onsets[lo - 1] - time) : Infinity);
  };
  const fitAt = (offset: number) => sung.reduce((sum, line) => sum + Math.exp(-((nearest(line.time + offset) / 0.3) ** 2)), 0) / sung.length;
  let offset = 0, fit = -1;
  for (let candidate = -40; candidate <= 40; candidate += 0.05) {
    const value = fitAt(candidate);
    if (value > fit) { fit = value; offset = candidate; }
  }
  if (fit < 0.35) return null;

  const words: Word[] = [];
  const hardBreaks = new Set<number>();
  sung.forEach((line, index) => {
    const start = line.time + offset;
    const nextStart = index + 1 < sung.length ? sung[index + 1].time + offset : Math.min(analysis.duration, start + 12);
    const inLine = notes.filter(note => note.start >= start - 0.25 && note.start < nextStart - 0.1);
    const texts = line.text.split(/\s+/).filter(Boolean);
    const end = inLine.length ? inLine[inLine.length - 1].end : Math.min(nextStart, start + texts.length * 0.45);
    hardBreaks.add(words.length);
    texts.forEach((text, k) => {
      let from: number, to: number;
      if (inLine.length >= texts.length) {
        const a = Math.floor((k * inLine.length) / texts.length);
        const b = Math.max(a, Math.floor(((k + 1) * inLine.length) / texts.length) - 1);
        from = inLine[a].start; to = inLine[b].end;
      } else {
        const span = Math.max(0.2, end - start);
        from = start + (span * k) / texts.length; to = start + (span * (k + 1)) / texts.length;
      }
      words.push(buildWord(text, Math.max(0, from), Math.max(to, from + 0.08), notes));
    });
  });
  return { lines: groupLines(words, hardBreaks), offset, fit };
}

// ---------------------------------------------------------------- sections

interface Block { units: LyricLine[]; start: number; end: number }

function makeBlock(units: LyricLine[]): Block {
  return { units, start: units[0].start, end: units[units.length - 1].end };
}

function splitLongBlock(block: Block): Block[] {
  const duration = block.end - block.start;
  if (duration <= 38 || block.units.length < 2) return [block];
  let bestIndex = -1;
  let bestScore = -1;
  for (let i = 1; i < block.units.length; i += 1) {
    const left = block.units[i - 1].end - block.start;
    const right = block.end - block.units[i].start;
    if (left < 8 || right < 8) continue;
    const gap = block.units[i].start - block.units[i - 1].end;
    const score = gap * (0.5 + Math.min(left, right) / duration);
    if (score > bestScore) { bestScore = score; bestIndex = i; }
  }
  if (bestIndex < 0) return [block];
  return [
    ...splitLongBlock(makeBlock(block.units.slice(0, bestIndex))),
    ...splitLongBlock(makeBlock(block.units.slice(bestIndex)))
  ];
}

function blockWords(block: Block): Set<string> {
  const words = new Set<string>();
  block.units.forEach(line => line.words.forEach(word => {
    const value = normalizeWord(word.text);
    if (value.length >= 2) words.add(value);
  }));
  return words;
}

function blockIntervals(block: Block, notes: NoteEvent[]): Set<string> {
  const midis = overlapping(notes, block.start, block.end).map(note => Math.round(note.midi));
  const grams = new Set<string>();
  for (let i = 0; i + 3 < midis.length; i += 1) {
    grams.add([midis[i + 1] - midis[i], midis[i + 2] - midis[i + 1], midis[i + 3] - midis[i + 2]].join(','));
  }
  return grams;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach(value => { if (b.has(value)) shared += 1; });
  return shared / (a.size + b.size - shared);
}

function blockPitch(block: Block, notes: NoteEvent[]): number {
  const inside = overlapping(notes, block.start, block.end);
  return inside.length ? median(inside.map(note => note.midi)) : 0;
}

let sectionCounter = 0;
const sectionId = () => 's' + (sectionCounter += 1).toString(36) + Math.random().toString(36).slice(2, 6);

export function relabel(sections: Section[]): Section[] {
  const counts: Partial<Record<SectionKind, number>> = {};
  const totals: Partial<Record<SectionKind, number>> = {};
  sections.forEach(section => { totals[section.kind] = (totals[section.kind] ?? 0) + 1; });
  return sections.map(section => {
    counts[section.kind] = (counts[section.kind] ?? 0) + 1;
    const numbered = (totals[section.kind] ?? 0) > 1 && section.kind !== 'intro' && section.kind !== 'outro';
    return { ...section, label: SECTION_NAMES[section.kind] + (numbered ? ' ' + counts[section.kind] : '') };
  });
}

/** Finds intro / verse / pre-chorus / chorus / bridge / outro from lyric lines, gaps and repetition. */
export function buildSections(lines: LyricLine[], notes: NoteEvent[], duration: number, hasLyrics: boolean): Section[] {
  if (!lines.length) return [{ id: sectionId(), kind: 'verse', label: 'Whole song', start: 0, end: duration }];

  let blocks: Block[] = [];
  let current: LyricLine[] = [];
  for (const line of lines) {
    const previous = current[current.length - 1];
    if (previous && line.start - previous.end >= 2.2) { blocks.push(makeBlock(current)); current = []; }
    current.push(line);
  }
  if (current.length) blocks.push(makeBlock(current));
  blocks = blocks.flatMap(splitLongBlock);

  // Very short blocks (a stray ad-lib) join their nearest neighbour.
  for (let i = 0; i < blocks.length && blocks.length > 1; i += 1) {
    if (blocks[i].end - blocks[i].start >= 5) continue;
    const target = i === 0 ? 1 : i === blocks.length - 1 ? i - 1
      : (blocks[i].start - blocks[i - 1].end < blocks[i + 1].start - blocks[i].end ? i - 1 : i + 1);
    const mergedUnits = [...blocks[Math.min(i, target)].units, ...blocks[Math.max(i, target)].units];
    blocks.splice(Math.min(i, target), 2, makeBlock(mergedUnits));
    i = -1;
  }

  // Similarity between vocal blocks: repeated lyrics + repeated melody → same kind of section.
  const wordsOf = blocks.map(blockWords);
  const melodyOf = blocks.map(block => blockIntervals(block, notes));
  const similarity = (a: number, b: number) => {
    const melody = jaccard(melodyOf[a], melodyOf[b]);
    return hasLyrics ? 0.65 * jaccard(wordsOf[a], wordsOf[b]) + 0.35 * melody : melody;
  };
  const threshold = hasLyrics ? 0.42 : 0.3;
  const parent = blocks.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let a = 0; a < blocks.length; a += 1) {
    for (let b = a + 1; b < blocks.length; b += 1) {
      const da = blocks[a].end - blocks[a].start;
      const db = blocks[b].end - blocks[b].start;
      if (Math.min(da, db) / Math.max(da, db) > 0.45 && similarity(a, b) >= threshold) parent[find(b)] = find(a);
    }
  }
  const clusters = new Map<number, number[]>();
  blocks.forEach((_, i) => clusters.set(find(i), [...(clusters.get(find(i)) ?? []), i]));

  const songPitch = median(notes.map(note => note.midi)) || 0;
  let chorus: number[] = [];
  let chorusScore = -Infinity;
  clusters.forEach(members => {
    if (members.length < 2) return;
    const pitch = median(members.map(i => blockPitch(blocks[i], notes))) - songPitch;
    let simTotal = 0, pairs = 0;
    for (let x = 0; x < members.length; x += 1) for (let y = x + 1; y < members.length; y += 1) {
      simTotal += similarity(members[x], members[y]); pairs += 1;
    }
    const score = members.length + (pairs ? simTotal / pairs : 0) * 2 + pitch / 6;
    if (score > chorusScore) { chorusScore = score; chorus = members; }
  });
  // No clearly repeated section (short clip, or lyrics not written yet): the higher, more intense
  // blocks are the choruses — the usual pop shape — so sections still get real names, never "Part 3".
  if (!chorus.length && blocks.length > 1) {
    const pitches = blocks.map(block => blockPitch(block, notes));
    const middle = median(pitches);
    chorus = blocks.map((_, i) => i).filter(i => i > 0 && pitches[i] > middle + 0.4);
    if (!chorus.length) chorus = blocks.map((_, i) => i).filter(i => i % 2 === 1);
  }
  const chorusSet = new Set(chorus);
  const chorusDuration = chorus.length ? median(chorus.map(i => blocks[i].end - blocks[i].start)) : 0;

  const kinds: SectionKind[] = blocks.map((block, i) => {
    if (!chorus.length) return 'verse';
    if (chorusSet.has(i)) return 'chorus';
    const choruses = chorus.filter(c => c < i).length;
    if (chorusSet.has(i + 1) && i > 0 && !chorusSet.has(i - 1) && block.end - block.start < chorusDuration * 0.75) return 'pre';
    const unique = blocks.every((_, j) => j === i || similarity(i, j) < 0.25);
    if (choruses >= 2 && unique && i < blocks.length - 1) return 'bridge';
    return 'verse';
  });

  // Turn vocal blocks into contiguous time ranges, with a short musical lead-in before each one.
  const sections: Section[] = [];
  const firstStart = blocks[0].start;
  if (firstStart >= 4) sections.push({ id: sectionId(), kind: 'intro', label: '', start: 0, end: Math.max(0, firstStart - 2) });
  blocks.forEach((block, i) => {
    const previousEnd = sections.length ? sections[sections.length - 1].end : 0;
    const gap = block.start - (i > 0 ? blocks[i - 1].end : previousEnd);
    if (i > 0 && gap >= 8) {
      sections.push({ id: sectionId(), kind: 'instrumental', label: '', start: blocks[i - 1].end, end: block.start - 2 });
    }
    const start = i === 0 ? (sections.length ? sections[sections.length - 1].end : 0) : sections[sections.length - 1].end;
    const leadIn = i === 0 && !sections.length ? start : Math.max(start, block.start - 3);
    if (sections.length && leadIn > start) sections[sections.length - 1].end = leadIn;
    sections.push({ id: sectionId(), kind: kinds[i], label: '', start: leadIn, end: block.end });
  });
  const last = sections[sections.length - 1];
  if (duration - last.end >= 5) sections.push({ id: sectionId(), kind: 'outro', label: '', start: last.end, end: duration });
  else last.end = duration;

  return relabel(sections);
}
