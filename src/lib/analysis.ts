import { estimateKey, median, type MusicalKey } from './music';
import type { Beat } from './beat';
import type { TimedWord } from './transcribe.worker';
import { segmentMergedWord } from './segment';

export interface PitchTrack { midi: Float32Array; energy: Float32Array; hopSeconds: number }

/** One sung note of the original vocal: a stable pitch held for a stretch of time. */
export interface NoteEvent { start: number; end: number; midi: number }

export interface Syllable {
  text: string; start: number; end: number; midi: number | null; notes: number[];
  /**
   * Structural binding: indices into the analysis' note array of the first and last note this
   * syllable is stapled to (a melisma spans several). Null when unbound. The karaoke view follows
   * these — never timestamps — to know what's being sung. `notes` (rounded MIDI values) stays for
   * the note-name labels.
   */
  noteIndex: number | null; noteEnd: number | null;
}
/**
 * `aside`: text inside [square brackets] — a direction like [Chorus] or [guitar solo], not sung. It's
 * shown differently, has no syllables or notes, and is left out of timing, the staff and scoring.
 * `tag`: the aside is a section tag ([Verse 2], [Chorus]…) — it names the section instead of being shown.
 */
export interface Word { text: string; start: number; end: number; syllables: Syllable[]; lang?: string; aside?: boolean; tag?: boolean }
export interface LyricLine { id: string; start: number; end: number; words: Word[] }

/** 'part' only appears in songs saved by older versions (they're relabeled when opened). */
export type SectionKind = 'intro' | 'verse' | 'pre' | 'chorus' | 'bridge' | 'instrumental' | 'outro' | 'part';
export interface Section { id: string; kind: SectionKind; label: string; start: number; end: number }

/** Bump when note detection changes, so saved songs re-check their notes when opened. */
export const NOTES_VERSION = 3;   // 3: fewer notes read an octave low (tenor, alto, soprano)

/**
 * Bump when the lyric↔pitch binding changes, so saved songs re-derive every syllable's time and
 * pitch from the measured notes when opened. Version 1 is the note-run rework: no lyric timestamp
 * is the authority for any word/syllable time or pitch — each syllable is bound to a run of the
 * artist's NoteEvents and its start/end/midi are derived from that run. Version 2 fixes the v1
 * rebind itself: v1 found each line's notes in a ±0.35 s window around its OLD times, so old
 * analyses whose line times were seconds off bound the first line to the wrong notes and left
 * the rest stale. V2 binds the whole syllable sequence to the note sequence by order alone —
 * no timestamp is trusted at all.
 */
export const BINDING_VERSION = 3;

export interface SongAnalysis {
  duration: number;
  notesVersion?: number;
  /** Which lyric↔pitch binding built these lines (see BINDING_VERSION). */
  bindingVersion?: number;
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
  /** Tempo, beat grid and meter (for the silent count-in dots); null = no clear beat. Found once, then saved. */
  beat?: Beat | null;
  /** Duet: which voice you sing (the lower or the higher), plus lines you reassigned by hand. */
  duet?: { mine: 'low' | 'high'; overrides: Record<string, 'me' | 'partner'>; names?: { me: string; partner: string } };
  /**
   * What speech recognition actually heard: raw word observations in sung order. The timestamps
   * are never used as timing — every word is bound to the measured notes structurally, and only
   * the text (and order) of what was heard matters.
   */
  heard?: TimedWord[];
  /** The lyrics as you pasted, typed or found them. Redo lyrics keeps these words and re-binds them to the notes. */
  typed?: string;
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

/**
 * Where to breathe, following the lyrics: once between each pair of lines (in the widest silence in
 * the singing there), and inside a line only at a real pause. Tiny gaps between words and notes are
 * not breaths. Songs without words fall back to the silences between notes.
 */
export function lyricBreaths(lines: LyricLine[], notes: NoteEvent[]): BreathMark[] {
  const sung = lines.map(line => line.words.filter(word => !word.aside && word.text !== '♪')).filter(words => words.length);
  if (!sung.length) return breathMarks(notes);
  const widestGap = (from: number, to: number): BreathMark | null => {
    let best: BreathMark | null = null;
    for (let i = 1; i < notes.length; i += 1) {
      const start = notes[i - 1].end, end = notes[i].start;
      if (end <= from || start >= to) continue;
      const a = Math.max(start, from), b = Math.min(end, to);
      if (b - a > (best?.length ?? 0)) best = { time: a, length: b - a };
    }
    return best;
  };
  const marks: BreathMark[] = [];
  sung.forEach((words, i) => {
    // Pauses inside the line.
    for (let k = 1; k < words.length; k += 1) {
      const gap = widestGap(words[k - 1].start + 0.05, words[k].start + 0.05);
      if (gap && gap.length >= 0.6) marks.push(gap);
    }
    // Between this line and the next.
    const next = sung[i + 1];
    if (!next) return;
    const last = words[words.length - 1];
    const gap = widestGap(last.start + 0.05, next[0].start + 0.1);
    if (gap && gap.length >= 0.12) marks.push(gap);
    else if (next[0].start - last.end >= 0.12) marks.push({ time: last.end, length: next[0].start - last.end });
  });
  return marks.filter(mark => mark.length < 6).sort((a, b) => a.time - b.time);
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

/**
 * The artist's note sounding at `time` (binary search; end-exclusive). The single source of
 * truth for "what should be sung now" — take scoring, the staff, and the live karaoke
 * verdicts all ask this, so an offset lyric timestamp can never change the expected pitch.
 */
export function noteAt(notes: NoteEvent[], time: number): NoteEvent | null {
  let lo = 0, hi = notes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (time < notes[mid].start) hi = mid - 1;
    else if (time >= notes[mid].end) lo = mid + 1;
    else return notes[mid];
  }
  return null;
}

/**
 * Index of the note sounding at `time`, or null in a rest. The karaoke view follows this —
 * note objects, never lyric timestamps — to know what's being sung.
 */
export function noteIndexAt(notes: NoteEvent[], time: number): number | null {
  let lo = 0, hi = notes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (time < notes[mid].start) hi = mid - 1;
    else if (time >= notes[mid].end) lo = mid + 1;
    else return mid;
  }
  return null;
}

/** Index of the first note starting at or after `time` — the coming phrase during a rest. */
export function nextNoteIndexAt(notes: NoteEvent[], time: number): number | null {
  let lo = 0, hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].start < time) lo = mid + 1;
    else hi = mid;
  }
  return lo < notes.length ? lo : null;
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
 * silent-e and -ed/-es endings merged back. Han, Hangul and kana scripts need no guessing: every
 * character is one sung syllable (dime, por-que — and likewise 你好, 사랑, さくら), so the words
 * split character by character instead of highlighting as one block per melisma.
 */
export function syllabify(word: string): string[] {
  const clean = word.replace(/[^\p{L}\p{M}']/gu, '');
  if (/^[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(clean)) return [...clean];
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

function distinctRounded(notes: NoteEvent[]): number[] {
  const out: number[] = [];
  for (const note of notes) {
    const rounded = Math.round(note.midi);
    if (out[out.length - 1] !== rounded) out.push(rounded);
  }
  return out.slice(0, 6);
}

// ---------------------------------------------------------------- note-run binding
//
// The foundation: no lyric timestamp is ever the authority for a word/syllable time or pitch.
// Transcription timestamps are guesses (off ~100–200 ms); the measured notes are not. So every
// syllable is bound to a run of the artist's NoteEvents, and its start/end/midi are derived from
// that run. The guess may supply the word sequence (what was heard, in what order) — never timing.

const MAX_RUN_NOTES = 12;   // longest melisma run one syllable may hold
const GAP_LIMIT = 0.5;      // a syllable's run may never span an inter-note gap this long

/**
 * Binds a flat syllable sequence to the note sequence, monotonic, by dynamic programming.
 * Returns one note run per syllable (a slice of `notes`; possibly empty). Deterministic.
 *
 * Costs: a syllable taking no notes costs 1.2 (worse than absorbing extra notes), with an
 * infinitesimal −1e-9 × index so the *later* syllables go unvoiced first when notes are scarce
 * (matching `syllablesFromRun`: the first parts get the notes); a skipped note (ad-lib, hum)
 * costs 0.3; a run of n > 1 notes costs (n−1) × 0.6 minus a stress bonus of 0.55 × (the run's
 * longest note / the input's longest note), so melisma runs prefer to sit on the longer —
 * usually stressed — notes. Exact ties go to the later syllable (−1e-9 × index): runs live on
 * stressed syllables (Ten-nes-SEE), which is what the tie-break encodes.
 */
export function bindSyllables(syllables: Array<{ text: string }>, notes: NoteEvent[]): NoteEvent[][] {
  const S = syllables.length, N = notes.length;
  const empty: NoteEvent[][] = Array.from({ length: S }, () => []);
  if (!S || !N) return empty;
  const dur = notes.map(note => Math.max(0, note.end - note.start));
  const longestInput = Math.max(0, ...dur);
  // gapBad[m] = 1 when the gap between note m and m+1 reaches GAP_LIMIT; prefix sums make the
  // "no run spans a long gap" check O(1).
  const gapPrefix = new Array(N + 1).fill(0);
  for (let m = 0; m + 1 < N; m += 1) gapPrefix[m + 1] = gapPrefix[m] + (notes[m + 1].start - notes[m].end >= GAP_LIMIT ? 1 : 0);
  gapPrefix[N] = gapPrefix[N - 1];
  const spanOk = (from: number, to: number) => gapPrefix[to - 1] - gapPrefix[from] === 0;  // run = notes[from..to)

  const cost: number[][] = Array.from({ length: S + 1 }, () => new Array(N + 1).fill(Infinity));
  const prev: Array<Array<{ pi: number; pj: number; from: number; to: number } | null>> =
    Array.from({ length: S + 1 }, () => new Array(N + 1).fill(null));
  const relax = (i: number, j: number, pi: number, pj: number, from: number, to: number, value: number) => {
    if (value < cost[i][j]) { cost[i][j] = value; prev[i][j] = { pi, pj, from, to }; }
  };
  cost[0][0] = 0;
  for (let i = 0; i <= S; i += 1) {
    for (let j = 0; j <= N; j += 1) {
      const here = cost[i][j];
      if (!Number.isFinite(here)) continue;
      // Skip note j: it belongs to no syllable.
      if (j < N) relax(i, j + 1, i, j, -1, -1, here + 0.3);
      if (i < S) {
        // Syllable i takes no notes (ties go to the later syllables: the first parts keep the notes).
        relax(i + 1, j, i, j, j, j, here + 1.2 - 1e-9 * i);
        // Syllable i takes a run of n notes (gaps only widen a violation, so stop at the first).
        // A single note costs nothing; the length penalty, stress bonus and tie-break only
        // shape multi-note (melisma) runs.
        for (let n = 1; n <= MAX_RUN_NOTES && j + n <= N; n += 1) {
          if (!spanOk(j, j + n)) break;
          let longest = 0;
          for (let m = j; m < j + n; m += 1) longest = Math.max(longest, dur[m]);
          const bonus = longestInput > 0 ? 0.55 * (longest / longestInput) : 0;
          const extra = n > 1 ? (n - 1) * 0.6 - bonus - 1e-9 * i : 0;
          relax(i + 1, j + n, i, j, j, j + n, here + extra);
        }
      }
    }
  }
  const ranges: Array<[number, number]> = new Array(S);
  let i = S, j = N;
  while (i > 0 || j > 0) {
    const p = prev[i][j]!;
    if (p.pi < i) ranges[p.pi] = [p.from, p.to];
    i = p.pi; j = p.pj;
  }
  return ranges.map(([from, to]) => notes.slice(from, to));
}

/**
 * Splits one word's note run across its syllables — the replacement for `buildWord`. Times and
 * pitch come from the run alone; the word's guessed time window plays no part.
 *
 * - run.length ≥ parts.length: one note per part, and ALL surplus notes join the part sung on
 *   the longest baseline note (tie → the later part) — the melisma sits on the stressed
 *   syllable (Ten-nes-SEE).
 * - run.length < parts.length (or empty): the first notes go to the first parts in order; the
 *   rest are unvoiced — start/end NaN (the caller interpolates them between voiced neighbors),
 *   midi null, notes [].
 * Each voiced syllable spans its sub-run; its midi is the sub-run's longest note (tie → first).
 */
export function syllablesFromRun(wordText: string, run: NoteEvent[], lang?: string, indexOf?: Map<NoteEvent, number>): Syllable[] {
  // `lang` is reserved: syllabification is language-agnostic today, but per-word language will
  // matter if that ever changes — kept in the signature so callers don't have to change later.
  void lang;
  // `indexOf` staples each syllable to its notes structurally (noteIndex/noteEnd). Without it
  // (tests, old callers) the syllables bind by time as before and the indices stay null.
  const at = (note: NoteEvent): number | null => indexOf?.get(note) ?? null;
  const parts = syllabify(wordText);
  const voiced = (text: string, sub: NoteEvent[]): Syllable => {
    let best = sub[0];
    for (const note of sub) if (note.end - note.start > best.end - best.start) best = note;
    return {
      text, start: sub[0].start, end: sub[sub.length - 1].end, midi: best.midi, notes: distinctRounded(sub),
      noteIndex: at(sub[0]), noteEnd: at(sub[sub.length - 1]),
    };
  };
  if (run.length >= parts.length) {
    let host = 0;
    for (let k = 1; k < parts.length; k += 1) {
      if (run[k].end - run[k].start >= run[host].end - run[host].start) host = k;
    }
    return parts.map((part, k) => voiced(part, k === host ? [run[k], ...run.slice(parts.length)] : [run[k]]));
  }
  return parts.map((part, k) => k < run.length
    ? voiced(part, [run[k]])
    : { text: part, start: NaN, end: NaN, midi: null, notes: [], noteIndex: null, noteEnd: null });
}

/**
 * Gives unvoiced syllables (NaN times from `syllablesFromRun`) their times. A syllable the
 * binding left without notes is still sung — on a neighbor's note (several syllables on one
 * note) — so edge groups split the neighboring voiced syllable's span proportionally by text
 * length and inherit its pitch: every sung syllable lights up in its turn instead of piling
 * up as a zero-width flash at the line's edge. A group between two voiced neighbors is a
 * breath-like gap: interpolated between them, pitchless.
 */
function fillSyllableTimes(syllables: Syllable[]): void {
  const weight = (s: Syllable) => Math.max(1, s.text.length);
  const share = (voiced: Syllable, sharers: Syllable[], fromFront: boolean) => {
    // Split the voiced span across [voiced, ...sharers] (or [...sharers, voiced]) in order.
    const group = fromFront ? [...sharers, voiced] : [voiced, ...sharers];
    const total = group.reduce((sum, s) => sum + weight(s), 0);
    const span = Math.max(0.01, voiced.end - voiced.start);
    let cursor = voiced.start;
    for (const s of group) {
      const w = (span * weight(s)) / total;
      s.start = cursor;
      s.end = cursor + w;
      cursor += w;
    }
    // Sharers ride the voiced syllable's note.
    for (const s of sharers) { s.midi = voiced.midi; s.notes = [...voiced.notes]; }
  };
  let pending: number[] = [];
  const flush = (before: Syllable | null, after: Syllable | null) => {
    if (!pending.length) return;
    const group = pending.map(index => syllables[index]);
    if (before && after) {
      const step = (after.start - before.end) / (pending.length + 1);
      group.forEach((s, k) => {
        s.start = before.end + step * (k + 1);
        s.end = Math.max(s.start, before.end + step * (k + 2) - 0.01);
      });
    } else if (after) {
      share(after, group, true);    // leading: split the following voiced span
    } else if (before) {
      share(before, group, false);  // trailing: split the preceding voiced span
    }
    pending = [];
  };
  let before: Syllable | null = null;
  syllables.forEach((s, index) => {
    if (Number.isNaN(s.start)) pending.push(index);
    else { flush(before, s); before = s; }
  });
  flush(before, null);
}

/** One Word from its note run (unvoiced syllables still need `fillSyllableTimes`). */
function wordFromRun(text: string, run: NoteEvent[], indexOf: Map<NoteEvent, number>, lang?: string): Word {
  return { text, start: NaN, end: NaN, syllables: syllablesFromRun(text, run, lang, indexOf), lang };
}

/** After `fillSyllableTimes`, each word's window is its syllables' span. */
function finishWordTimes(words: Word[]): void {
  for (const word of words) {
    if (!word.syllables.length) continue;
    word.start = word.syllables[0].start;
    word.end = word.syllables[word.syllables.length - 1].end;
  }
}

/**
 * One note run per word: the words' syllables are bound flat (see `bindSyllables`), then each
 * word's syllable runs are joined into the word's run (a slice of `notes`). The shared core of
 * the heard path and the typed path's heard-word binding.
 */
function bindWordRuns(texts: string[], notes: NoteEvent[]): NoteEvent[][] {
  const counts: number[] = [];
  const flat: Array<{ text: string }> = [];
  texts.forEach(text => {
    const parts = syllabify(text);
    counts.push(parts.length);
    parts.forEach(part => flat.push({ text: part }));
  });
  const runs = bindSyllables(flat, notes);
  const out: NoteEvent[][] = [];
  let k = 0;
  counts.forEach(count => {
    const wordRuns = runs.slice(k, k + count);
    k += count;
    const voicedRuns = wordRuns.filter(run => run.length);
    if (!voicedRuns.length) { out.push([]); return; }
    const first = voicedRuns[0][0], last = voicedRuns[voicedRuns.length - 1];
    out.push(notes.slice(notes.indexOf(first), notes.indexOf(last[last.length - 1]) + 1));
  });
  return out;
}

// Chinese and Japanese are written without spaces: two such words sit side by side.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]/u;

/** Words written out as a line: spaced, except between Chinese/Japanese words. `render` gives each word's text or HTML. */
export function joinWords<W extends { text: string }>(words: W[], render: (word: W) => string = word => word.text): string {
  return words.map((word, i) => (i && !(CJK.test(words[i - 1].text.slice(-1)) && CJK.test(word.text.charAt(0))) ? ' ' : '') + render(word)).join('');
}

let lineCounter = 0;
const lineId = () => 'l' + (lineCounter += 1).toString(36) + Math.random().toString(36).slice(2, 6);

/**
 * Splits sung words into lyric lines the way a singer phrases them:
 *  - typed lyrics keep their own lines (`hardBreaks` = the first word of each typed line);
 *  - otherwise lines break where the singer breathes (a gap of ½ s or more) and where the heard
 *    words end a phrase (a comma or full stop — the listening model stretches a word over the
 *    pause after it, so its punctuation is often the only sign). Tiny fragments (under 4 words)
 *    join the neighbour they're least separated from;
 *  - any line still longer than 14 words or 9 seconds is split where it's most separated, a rest
 *    in the melody (`notes`) counting too.
 */
export function groupLines(words: Word[], hardBreaks: Set<number> = new Set(), notes: NoteEvent[] = []): LyricLine[] {
  if (!words.length) return [];
  // How clearly a line could end between `before` and `after`: seconds of pause, plus the punctuation.
  const separation = (before: Word, after: Word) => {
    const punctuation = /[.?!…]["'”’)\]]*$/.test(before.text) ? 1 : /[,;:—–]["'”’)\]]*$/.test(before.text) ? 0.6 : 0;
    return after.start - before.end + punctuation;
  };
  const gapBefore = (chunk: Word[], index: number) => separation(chunk[index - 1], chunk[index])
    + (notes.length ? 0.5 * longestRest(notes, chunk[index - 1].start, chunk[index].start) : 0);
  let chunks: Word[][] = [];
  words.forEach((word, index) => {
    const breakHere = index === 0 || (hardBreaks.size ? hardBreaks.has(index) : separation(words[index - 1], word) >= 0.5);
    if (breakHere) chunks.push([word]); else chunks[chunks.length - 1].push(word);
  });
  if (!hardBreaks.size) {
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 0; i < chunks.length; i += 1) {
        if (chunks[i].length >= 4) continue;
        const gapLeft = i > 0 ? separation(chunks[i - 1][chunks[i - 1].length - 1], chunks[i][0]) : Infinity;
        const gapRight = i + 1 < chunks.length ? separation(chunks[i][chunks[i].length - 1], chunks[i + 1][0]) : Infinity;
        const target = gapLeft <= gapRight ? i - 1 : i + 1;
        const gap = Math.min(gapLeft, gapRight);
        if (gap > 1.5 || chunks[target].length + chunks[i].length > 12) continue;
        const [first, second] = target < i ? [target, i] : [i, target];
        chunks.splice(first, 2, [...chunks[first], ...chunks[second]]);
        changed = true;
        break;
      }
    }
  }
  const tooLong = (chunk: Word[]) => chunk.length > 14 || chunk[chunk.length - 1].end - chunk[0].start > 9;
  const split = (chunk: Word[]): Word[][] => {
    if (!tooLong(chunk) || chunk.length < 4) return [chunk];
    let at = Math.floor(chunk.length / 2), widest = -Infinity;
    for (let k = 2; k <= chunk.length - 2; k += 1) {
      // Prefer a long pause near the middle.
      const score = gapBefore(chunk, k) - 0.02 * Math.abs(k - chunk.length / 2);
      if (score > widest) { widest = score; at = k; }
    }
    return [...split(chunk.slice(0, at)), ...split(chunk.slice(at))];
  };
  chunks = chunks.flatMap(split);
  return chunks.map(chunk => ({ id: lineId(), start: chunk[0].start, end: chunk[chunk.length - 1].end, words: chunk }));
}

/** Without lyrics, turn sung phrases into lines of ♪ so notes are still shown in time. */
function linesFromNotes(notes: NoteEvent[]): LyricLine[] {
  const words: Word[] = notes.map((note, index) => ({
    text: '♪', start: note.start, end: note.end,
    syllables: [{ text: '♪', start: note.start, end: note.end, midi: note.midi, notes: [Math.round(note.midi)], noteIndex: index, noteEnd: index }]
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
  // Fast singing merges words into one transcription token ("sixfootsix"). Split those back
  // into real words before anything else, dividing the token's window by character length.
  // Only all-known-word splits happen; anything else is left exactly as heard.
  const words = timed.flatMap(word => {
    const parts = segmentMergedWord(word.text);
    if (!parts) return [word];
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    let start = word.start;
    return parts.map(part => {
      const end = start + ((word.end - word.start) * part.length) / total;
      const split = { ...word, text: part, start, end };
      start = end;
      return split;
    });
  });
  const timedWords = words;
  if (!timedWords.length) return linesFromNotes(notes);
  if (!notes.length) {
    // Degenerate: note detection found no vocal at all, so there is no measured structure to
    // bind to. The raw guess windows stand in — the only signal — so the words still have times.
    const built = timedWords.map(word => {
      const parts = syllabify(word.text);
      const span = Math.max(0.01, word.end - word.start) / parts.length;
      const syllables: Syllable[] = parts.map((part, k) => ({
        text: part, start: word.start + span * k, end: word.start + span * (k + 1), midi: null, notes: [], noteIndex: null, noteEnd: null
      }));
      return { text: word.text, start: word.start, end: word.end, syllables, lang: word.lang };
    });
    return groupLines(built, new Set(), notes);
  }
  // The guess's times are ignored entirely: each heard word is a raw observation — its text in
  // sung order. Syllables bind to runs of the measured notes (see `bindSyllables`), and every
  // time and pitch below is derived from those runs. Shifting the input times changes nothing.
  const runs = bindWordRuns(timedWords.map(word => word.text), notes);
  const builtWords: Word[] = [];
  const flat: Syllable[] = [];
  const indexOf = new Map<NoteEvent, number>(notes.map((note, i) => [note, i]));
  timedWords.forEach((word, i) => {
    const built = wordFromRun(word.text, runs[i], indexOf, word.lang);
    builtWords.push(built);
    flat.push(...built.syllables);
  });
  fillSyllableTimes(flat);
  finishWordTimes(builtWords);
  return groupLines(builtWords, new Set(), notes);
}

/** The longest stretch between `from` and `to` with no sung note (a rest in the melody). */
function longestRest(notes: NoteEvent[], from: number, to: number): number {
  let longest = 0, cursor = from;
  for (const note of notes) {
    if (note.end <= cursor) continue;
    if (note.start >= to) break;
    longest = Math.max(longest, note.start - cursor);
    cursor = Math.max(cursor, note.end);
  }
  return Math.max(longest, to - cursor);
}

const normalizeWord = (value: string) => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}']/gu, '');

/**
 * Times lyrics from the melody alone (no transcript): each syllable is sung on a note, and lines start
 * after breaths. Lines are matched to the sung phrases (runs of notes between breaths) by dynamic
 * programming — a line takes one or more phrases (or two short lines share one) so that its syllable
 * count fits the phrase's note count; stray phrases (ad-libs, humming) can be skipped. Within a line,
 * syllables are laid on its notes in order (a syllable held over several notes is fine).
 * Returns one entry per word, in order: its [start, end] (derived from its notes) plus
 * `from`/`to`, the word's note run as indices into `notes` (`to` is inclusive; `to < from` means
 * the word got no notes and stays unvoiced).
 */
export function alignToMelody(lines: string[][], notes: NoteEvent[]): Array<{ start: number; end: number; from: number; to: number }> {
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
  if (!Number.isFinite(cost[L][P])) {
    // Far more lines than sung phrases: share the sung stretch out evenly, word by word.
    // No notes back these words — they stay unvoiced (from > to) for the caller to interpolate.
    const words = lines.flat().length;
    const from = notes[0]?.start ?? 0, span = Math.max(0.1, (notes[notes.length - 1]?.end ?? 0.3) - from);
    return lines.flat().map((_, k) => ({ start: from + (span * k) / words, end: from + (span * (k + 0.9)) / words, from: 0, to: -1 }));
  }
  while (i > 0 || j > 0) {
    const back = step[i][j]!;
    if (back.kind === 'line') assigned.unshift({ lines: [back.i], phrases: [back.j, j] });
    if (back.kind === 'pair') assigned.unshift({ lines: [back.i, back.i + 1], phrases: [back.j, j] });
    i = back.i; j = back.j;
  }

  const placed: Array<{ start: number; end: number; from: number; to: number }> = [];
  for (const group of assigned) {
    const groupNotes = phrases.slice(group.phrases[0], group.phrases[1]).flat();
    const counts = group.lines.flatMap(index => syllables[index]);
    const total = counts.reduce((a, b) => a + b, 0);
    // `from`/`to` are indices into `notes`: the phrases partition the notes in order, so the
    // group's notes are one contiguous slice of them.
    const base = groupNotes.length ? notes.indexOf(groupNotes[0]) : 0;
    // Syllable k of the group → its time and its note run.
    const sylTime = (k: number): { start: number; end: number; from: number; to: number } => {
      const n = groupNotes.length;
      if (!n) return { start: 0, end: 0.08, from: 0, to: -1 };
      if (n >= total) {
        const a = Math.floor((k * n) / total), b = Math.max(a, Math.floor(((k + 1) * n) / total) - 1);
        return { start: groupNotes[a].start, end: groupNotes[b].end, from: base + a, to: base + b };
      }
      // More syllables than notes: share the sung time out evenly, note by note.
      const spans = groupNotes.map(note => note.end - note.start);
      const sung = spans.reduce((a, b) => a + b, 0);
      const at = (fraction: number): { time: number; index: number } => {
        let left = fraction * sung;
        for (let x = 0; x < groupNotes.length; x += 1) {
          if (left <= spans[x] || x === groupNotes.length - 1) return { time: groupNotes[x].start + Math.min(left, spans[x]), index: base + x };
          left -= spans[x];
        }
        return { time: groupNotes[groupNotes.length - 1].end, index: base + groupNotes.length - 1 };
      };
      const s0 = at(k / total), s1 = at((k + 1) / total);
      return { start: s0.time, end: s1.time, from: s0.index, to: s1.index };
    };
    let k = 0;
    for (const count of counts) {
      const first = sylTime(k), last = sylTime(k + count - 1);
      placed.push({ start: first.start, end: Math.max(last.end, first.start + 0.08), from: first.from, to: last.to });
      k += count;
    }
  }
  return placed;
}

/**
 * Splits typed lyrics into words, line by line, marking everything from a "[" to the next "]" as an
 * aside (not sung) — even when the brackets span several words or lines.
 */
export interface LyricToken { text: string; aside: boolean; tag: boolean }

export function lyricTokens(lines: string[]): LyricToken[][] {
  let inside = false;
  let span = -1;
  const spans: Array<{ text: string; tokens: LyricToken[] }> = [];
  const result = lines.map(line => {
    const tokens: LyricToken[] = [];
    for (const text of line.split(/\s+/).filter(Boolean)) {
      const open = text.lastIndexOf('['), close = text.lastIndexOf(']');
      const continuing = inside;
      if (!inside && open >= 0) { span = spans.length; spans.push({ text: '', tokens: [] }); }
      const aside = inside || open >= 0;
      if (open >= 0) inside = true;
      if (close > open) inside = false;
      if (aside) spans[span].text += ' ' + text;
      // A bracketed stretch on one line stays one piece: "[spoken: oh yeah]".
      const last = tokens[tokens.length - 1];
      if (continuing && last?.aside) last.text += ' ' + text;
      else {
        const token = { text, aside, tag: false };
        tokens.push(token);
        if (aside) spans[span].tokens.push(token);
      }
    }
    return tokens;
  });
  // A whole bracket (even over several lines) that names a section is a tag: "[Guitar solo … ]".
  for (const item of spans) if (sectionTag(item.text.trim()) !== null) item.tokens.forEach(token => { token.tag = true; });
  return result;
}

/** Section tags written into lyrics — [Intro], [Verse 2], [Pre-Chorus], [Chorus], [Bridge]… */
const SECTION_TAGS: Array<[RegExp, SectionKind]> = [
  [/^pre[- ]?chorus|^build/i, 'pre'],
  [/^(chorus|hook|refrain)/i, 'chorus'],
  [/^verse/i, 'verse'],
  [/^bridge/i, 'bridge'],
  [/^intro/i, 'intro'],
  [/^(outro|ending|end)\b/i, 'outro'],
  [/^(instrumental|interlude|break|(guitar |piano |sax |drum )?solo)/i, 'instrumental']
];
export function sectionTag(text: string): SectionKind | null {
  const inner = text.replace(/^\[|\]$/g, '').replace(/:.*$/, '').trim();
  for (const [pattern, kind] of SECTION_TAGS) if (pattern.test(inner)) return kind;
  return null;
}
/** A line that is nothing but a section tag (it names the section instead of being shown). */
export const isTagLine = (line: LyricLine) => line.words.length > 0 && line.words.every(word => word.tag);

/** An aside word: shown in place at `time` (or naming the section, for a tag), never sung. */
function asideWord(token: LyricToken, time: number): Word {
  return { text: token.text, start: time, end: time, syllables: [], aside: true, tag: token.tag || undefined };
}

/** Places asides between the sung words around them (at the start of the next sung word). */
function withAsides(tokens: LyricToken[], sung: Word[], fallback: number): Word[] {
  const words: Word[] = [];
  let next = 0;
  tokens.forEach(token => {
    if (!token.aside) { words.push(sung[next]); next += 1; return; }
    const time = sung[next]?.start ?? sung[next - 1]?.end ?? fallback;
    words.push(asideWord(token, time));
  });
  return words;
}

/**
 * Replaces the transcript with lyrics the singer typed/pasted. Words are matched to what was
 * heard (edit-distance alignment, text only) and inherit the heard word's *note run* — never its
 * timestamps. Unmatched words are laid on the singer's notes between their neighbours (see
 * `alignToMelody`); with no hearing at all, on the melody alone. [Bracketed] text is kept as
 * asides, untimed.
 */
export function applyTypedLyrics(analysis: SongAnalysis, text: string): LyricLine[] {
  const tokenLines = lyricTokens(text.split(/\n+/).map(line => line.trim()).filter(Boolean));
  const allTokens = tokenLines.flat();
  // Sung words, with the index of each typed line's first sung word (asides don't count).
  const typed: string[] = [];
  const hardBreaks = new Set<number>();
  for (const line of tokenLines) {
    const sungWords = line.filter(token => !token.aside).map(token => token.text);
    if (!sungWords.length) continue;
    hardBreaks.add(typed.length);
    typed.push(...sungWords);
  }
  if (!allTokens.length) return analysis.lines;
  const notes = analysis.notes;
  if (!notes.length) {
    // Degenerate: no vocal notes at all — words share the song out evenly, unvoiced.
    const slot = Math.max(0.1, analysis.duration / Math.max(1, typed.length));
    const words = typed.map((word, k) => ({
      text: word, start: slot * k, end: slot * (k + 0.9),
      syllables: syllabify(word).map(part => ({ text: part, start: slot * k, end: slot * (k + 0.9), midi: null, notes: [] as number[], noteIndex: null, noteEnd: null }))
    }));
    const withA = withAsides(allTokens, words, 0);
    const lineBreaks = new Set<number>();
    let count = 0;
    tokenLines.forEach(line => { if (line.length) lineBreaks.add(count); count += line.length; });
    return groupLines(withA, lineBreaks);
  }
  // Absolute placement from the melody alone: typed lines laid on the singer's note phrases
  // (see `alignToMelody`). No timestamps anywhere — heard or guessed.
  const typedLines: string[][] = [];
  for (let k = 0; k < typed.length; k += 1) {
    if (k === 0 || hardBreaks.has(k)) typedLines.push([]);
    typedLines[typedLines.length - 1].push(typed[k]);
  }
  const base = alignToMelody(typedLines, notes);
  let runs: NoteEvent[][] = base.map(placed => placed.to >= placed.from ? notes.slice(placed.from, placed.to + 1) : []);
  // If the phrase alignment left any word with no notes (more lines than phrases, or a line
  // the DP couldn't place), fall back to the structural binder for the whole sequence — every
  // syllable bound by order to the note sequence, no timestamps involved. A word with an empty
  // run would render with no note binding and its karaoke fill would never activate.
  if (runs.length !== typed.length || runs.some(run => !run.length)) {
    const flatSyls: Array<{ text: string }> = [];
    const counts: number[] = [];
    typed.forEach(word => {
      const parts = syllabify(word);
      counts.push(parts.length);
      parts.forEach(part => flatSyls.push({ text: part }));
    });
    const bound = bindSyllables(flatSyls, notes);
    runs = [];
    let k = 0;
    for (const count of counts) {
      const wordRun: NoteEvent[] = [];
      for (let s = 0; s < count; s += 1) wordRun.push(...bound[k + s]);
      // De-duplicate while preserving order (a note shared by two syllables of one word).
      runs.push([...new Set(wordRun)]);
      k += count;
    }
  }
  // The heard words are raw observations: their text and order, never their timestamps. A typed
  // word that really matches a heard word inherits that heard word's note run — anchored by the
  // structural placement above (a from-zero binding would let intro hallucinations shift every
  // run), then refined by the actually-sung syllable stream within the line's note span.
  // (Songs saved before `heard` existed fall back to their own words as the observation sequence.)
  const heardTexts: string[] = analysis.heard?.length
    ? analysis.heard.map(word => word.text)
    : analysis.transcript === 'ok'
      ? analysis.lines.flatMap(line => line.words).filter(word => word.text !== '♪' && !word.aside).map(word => word.text)
      : [];
  if (heardTexts.length) {
    const pairs = matchHeardWords(typed, heardTexts.map(text => ({ text })));
    // A handful of chance matches isn't a binding to trust.
    if (pairs.length >= Math.max(3, typed.length * 0.1)) {
      const typedToHeard = new Map<number, number>();
      pairs.forEach(([i, j]) => typedToHeard.set(i, j));
      let k = 0;
      typedLines.forEach(line => {
        const indices: number[] = [];
        line.forEach(() => { indices.push(k); k += 1; });
        const paired = indices.filter(i => typedToHeard.has(i));
        if (!paired.length) return;
        const jFirst = typedToHeard.get(paired[0])!;
        const jLast = typedToHeard.get(paired[paired.length - 1])!;
        const spanFrom = Math.min(...paired.map(i => base[i].from));
        const spanTo = Math.max(...paired.map(i => base[i].to));
        if (spanTo < spanFrom) return;
        const spanNotes = notes.slice(spanFrom, spanTo + 1);
        const heardRuns = bindWordRuns(heardTexts.slice(jFirst, jLast + 1), spanNotes);
        paired.forEach(i => {
          const run = heardRuns[typedToHeard.get(i)! - jFirst];
          if (run.length) runs[i] = run;
        });
      });
    }
  }
  const words: Word[] = [];
  const flat: Syllable[] = [];
  const indexOf = new Map<NoteEvent, number>(notes.map((note, i) => [note, i]));
  typed.forEach((word, i) => {
    const built = wordFromRun(word, runs[i], indexOf);
    words.push(built);
    flat.push(...built.syllables);
  });
  fillSyllableTimes(flat);
  finishWordTimes(words);
  const withA = withAsides(allTokens, words, 0);
  // Every typed line (including a line that is only an aside) stays its own line.
  const lineBreaks = new Set<number>();
  let count = 0;
  tokenLines.forEach(line => { if (line.length) lineBreaks.add(count); count += line.length; });
  return groupLines(withA, lineBreaks);
}

/** Levenshtein distance, stopping early once it's over `limit`. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...row) > limit) return limit + 1;
    previous = row;
  }
  return previous[b.length];
}

/** How surely a typed word is the heard word: 2 = the same, 1 = misheard by a letter ("rock"/"rook"), 0 = different. */
function wordMatch(typed: string, heard: string): number {
  const a = normalizeWord(typed), b = normalizeWord(heard);
  if (!a || !b) return 0;
  if (a === b) return 2;
  return a.length >= 4 && b.length >= 4 && editDistance(a, b, 1) <= 1 ? 1 : 0;
}

/**
 * Pairs typed words with the heard words that really are them (in order; a weighted longest common
 * subsequence). Only real matches pair up — never "whatever was heard at that point" — so words the
 * listening invented (in an intro, a solo) or missed can't pull the typed words to the wrong time.
 * A short word ("I", "the") only counts next to another match, since they're heard everywhere.
 */
export function matchHeardWords(typed: string[], heard: Array<{ text: string }>): Array<[number, number]> {
  const n = typed.length, m = heard.length;
  const score: Float32Array[] = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const match = wordMatch(typed[i - 1], heard[j - 1].text);
      score[i][j] = Math.max(score[i - 1][j], score[i][j - 1], match ? score[i - 1][j - 1] + match : -1);
    }
  }
  const pairs: Array<[number, number]> = [];
  for (let i = n, j = m; i > 0 && j > 0;) {
    const match = wordMatch(typed[i - 1], heard[j - 1].text);
    if (match && score[i][j] === score[i - 1][j - 1] + match) { pairs.unshift([i - 1, j - 1]); i -= 1; j -= 1; }
    else if (score[i][j] === score[i - 1][j]) i -= 1;
    else j -= 1;
  }
  const paired = new Set(pairs.map(([i]) => i));
  return pairs.filter(([i, j]) => normalizeWord(typed[i]).length > 3
    || (paired.has(i - 1) && pairs.some(([a, b]) => a === i - 1 && b === j - 1))
    || (paired.has(i + 1) && pairs.some(([a, b]) => a === i + 1 && b === j + 1)));
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
 * The recording may start a little earlier or later than the original (a longer intro, a trimmed
 * start), so the lyrics are first slid (±15 s) until their line starts land on the singer's phrase
 * starts — and only used when they clearly do (fit ≥ 0.7). Each line's words are then spread over
 * the notes sung in that line. Returns null if the lyrics don't fit this recording (another
 * version, a live take…), so the caller falls back to listening to the singer instead.
 */
export function alignSyncedLyrics(analysis: SongAnalysis, synced: SyncedLine[]): { lines: LyricLine[]; offset: number; fit: number } | null {
  const notes = analysis.notes;
  const withText = synced.filter(line => line.text && !/^[♪\s]*$/.test(line.text));
  const tokenLines = lyricTokens(withText.map(line => line.text));
  // Lines with something to sing (a line that's only a [direction] doesn't mark a sung phrase).
  const sung = withText.filter((_, i) => tokenLines[i].some(token => !token.aside));
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
  // ±15 s covers a longer intro or a trimmed start; anything further out is a different recording.
  for (let candidate = -15; candidate <= 15; candidate += 0.05) {
    const value = fitAt(candidate);
    if (value > fit) { fit = value; offset = candidate; }
  }
  // Strict: the timed lyrics are used only when their lines clearly land on the singer's phrases.
  // A loose fit used to shift the whole lyric track seconds off — anything doubtful falls back to
  // listening to the singer instead. No wiggle room.
  if (fit < 0.7) return null;

  const words: Word[] = [];
  const hardBreaks = new Set<number>();
  const indexOf = new Map<NoteEvent, number>(notes.map((note, i) => [note, i]));
  withText.forEach((line, index) => {
    const start = line.time + offset;
    const later = withText.slice(index + 1).find((_, k) => tokenLines[index + 1 + k].some(token => !token.aside));
    const nextStart = later ? later.time + offset : Math.min(analysis.duration, start + 12);
    const inLine = notes.filter(note => note.start >= start - 0.25 && note.start < nextStart - 0.1);
    const tokens = tokenLines[index];
    const texts = tokens.filter(token => !token.aside).map(token => token.text);
    const end = inLine.length ? inLine[inLine.length - 1].end : Math.min(nextStart, start + texts.length * 0.45);
    hardBreaks.add(words.length);
    const sungWords = texts.map((text, k): Word => {
      // Each word gets a run of the line's notes by count proportion — never a guessed time
      // window. With fewer notes than words, the run is the notes overlapping the word's
      // proportional span (possibly empty: the word stays unvoiced).
      let run: NoteEvent[];
      if (inLine.length >= texts.length) {
        const a = Math.floor((k * inLine.length) / texts.length);
        const b = Math.max(a, Math.floor(((k + 1) * inLine.length) / texts.length) - 1);
        run = inLine.slice(a, b + 1);
      } else {
        const span = Math.max(0.2, end - start);
        const from = start + (span * k) / texts.length, to = start + (span * (k + 1)) / texts.length;
        run = notes.filter(note => note.end > from && note.start < to);
      }
      return wordFromRun(text, run, indexOf);
    });
    const flat: Syllable[] = sungWords.flatMap(word => word.syllables);
    fillSyllableTimes(flat);
    finishWordTimes(sungWords);
    words.push(...withAsides(tokens, sungWords, Math.max(0, start)));
  });
  return { lines: groupLines(words, hardBreaks), offset, fit };
}

// ---------------------------------------------------------------- old-song upgrade

/**
 * Re-derives every syllable's time and pitch from the measured notes, trusting NO timestamp —
 * not even the old line windows. The v1 rebind found each line's notes in a ±0.35 s window
 * around its old times; when those were seconds off, line 1 grabbed the wrong notes and later
 * lines were left stale (karaoke lit the first line, then died). Here the whole sung syllable
 * sequence binds to the whole note sequence by order alone — the same dynamic program fresh
 * prepares use — so badly-off old analyses rebind correctly. Each syllable also records its
 * notes' indices (noteIndex/noteEnd): the karaoke view follows those structurally, so lyric
 * timestamps are never consulted at showtime. Line objects are mutated in place,
 * so line ids (and anything keyed by them) survive. Line ids, word order and text, asides and
 * ♪ words are preserved — only times, midis and note lists change.
 */
export function rebaseToNoteRuns(lines: LyricLine[], notes: NoteEvent[]): void {
  if (!notes.length) return;   // no measured singing: nothing to bind to, leave times as they were
  const flat: Syllable[] = [];
  for (const line of lines)
    for (const word of line.words) {
      if (word.aside || !word.syllables.length) continue;
      flat.push(...word.syllables);
    }
  if (!flat.length) return;
  const runs = bindSyllables(flat.map(syllable => ({ text: syllable.text })), notes);
  // Structural binding: each syllable staples to its notes by index, not by time. The karaoke
  // view follows these indices — lyric timestamps are never consulted at showtime.
  const indexOf = new Map<NoteEvent, number>();
  notes.forEach((note, i) => indexOf.set(note, i));
  flat.forEach((syllable, k) => {
    const run = runs[k];
    if (!run.length) {
      syllable.start = NaN; syllable.end = NaN; syllable.midi = null; syllable.notes = [];
      syllable.noteIndex = null; syllable.noteEnd = null;
    } else {
      let best = run[0];
      for (const note of run) if (note.end - note.start > best.end - best.start) best = note;
      syllable.start = run[0].start;
      syllable.end = run[run.length - 1].end;
      syllable.midi = best.midi;
      syllable.notes = distinctRounded(run);
      syllable.noteIndex = indexOf.get(run[0]) ?? null;
      syllable.noteEnd = indexOf.get(run[run.length - 1]) ?? null;
    }
  });
  fillSyllableTimes(flat);
  for (const line of lines) {
    for (const word of line.words) {
      if (word.aside || !word.syllables.length) continue;
      word.start = word.syllables[0].start;
      word.end = word.syllables[word.syllables.length - 1].end;
    }
    // Asides ride on the next sung word's new start (or keep their time when there is none).
    line.words.forEach((word, wi) => {
      if (!word.aside) return;
      const next = line.words.slice(wi + 1).find(candidate => !candidate.aside);
      if (next) { word.start = next.start; word.end = next.start; }
    });
    line.start = line.words[0].start;
    line.end = line.words[line.words.length - 1].end;
  }
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
    if (word.aside) return;
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

/**
 * Consecutive sections of the same kind are one musical idea the block detector split apart
 * (e.g. thirteen unrepeated blocks each labeled "verse"): fold them into the first section,
 * extending its end. Sections of the same kind separated by anything else
 * (Verse 1 … Chorus … Verse 2) are never merged.
 */
function mergeConsecutive(sections: Section[]): Section[] {
  const merged: Section[] = [];
  for (const section of sections) {
    const last = merged[merged.length - 1];
    if (last && last.kind === section.kind) last.end = Math.max(last.end, section.end);
    else merged.push({ ...section });
  }
  return merged;
}

/** Finds intro / verse / pre-chorus / chorus / bridge / outro from lyric lines, gaps and repetition. */
/**
 * Sections straight from the section tags in the lyrics. A tag like [Chorus] starts its section just
 * before the next sung line. An instrumental tag ([Guitar solo], [Interlude]) is the gap itself: it
 * runs from the end of the singing before it, and the singing after it (with no new tag) continues
 * the section it interrupted. Returns null when the lyrics have fewer than two tags.
 */
function sectionsFromTags(lines: LyricLine[], duration: number): Section[] | null {
  const starts: Array<{ kind: SectionKind; time: number }> = [];
  let pending: SectionKind | null = null;
  let current: SectionKind | null = null;
  let lastSungEnd = 0;
  let tags = 0;
  for (const line of lines) {
    const tag = line.words.map(word => (word.tag ? sectionTag(word.text) : null)).find(kind => kind !== null) ?? null;
    if (tag) {
      tags += 1;
      if (tag === 'instrumental' && lastSungEnd > 0) {
        starts.push({ kind: 'instrumental', time: lastSungEnd + 0.3 });
        pending = current;             // the next singing resumes the interrupted section
      } else pending = tag;
    }
    const sung = line.words.filter(word => !word.aside);
    if (!sung.length) continue;
    if (pending) {
      // Start a moment before the first sung word, but never before the previous singing ends.
      starts.push({ kind: pending, time: Math.max(lastSungEnd + 0.3, sung[0].start - 1.5) });
      current = pending;
      pending = null;
    }
    lastSungEnd = sung[sung.length - 1].end;
  }
  if (tags < 2 || !starts.length) return null;
  if (starts[0].time > 4) starts.unshift({ kind: 'intro', time: 0 });
  else starts[0].time = 0;
  const sections = starts.map((start, i) => ({
    id: sectionId(), kind: start.kind, label: '', start: start.time, end: i + 1 < starts.length ? starts[i + 1].time : duration
  })).filter(section => section.end - section.start > 0.5);
  return relabel(sections);
}

export function buildSections(lines: LyricLine[], notes: NoteEvent[], duration: number, hasLyrics: boolean): Section[] {
  // Lyrics that name their own sections ([Verse 1], [Chorus]…) are the best guide there is.
  const tagged = sectionsFromTags(lines, duration);
  if (tagged) return relabel(mergeConsecutive(tagged));
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

  return relabel(mergeConsecutive(sections));
}
