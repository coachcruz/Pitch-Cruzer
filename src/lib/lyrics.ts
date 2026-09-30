import { alignSyncedLyrics, applyTypedLyrics, buildLines, buildSections, type NoteEvent, type SongAnalysis, type SyncedLine } from './analysis';
import { diag } from './diag';
import type { TimedWord } from './transcribe.worker';

/**
 * Writing a song's lyrics — the one place it happens (new songs, Redo lyrics). In order:
 *  1. Your own lyrics (pasted, the song's own like Suno's, or kept on Redo) always win.
 *  2. Otherwise the lyrics are looked up by the song's name. Timed lyrics that fit the singer are used
 *     straight away — nothing to listen to.
 *  3. The singer is listened to. That gives the timing, and the words when nothing else has them.
 *  4. Lyrics found by name must contain what was heard (a vague name can find another song).
 *  5. No lyrics yet: the song is recognised from what was heard, and its real lyrics are fetched
 *     (again, only used if they contain what was heard).
 *  6. The words are laid on the singer's timing; with nothing heard, on the melody alone.
 * If everything fails and the song already had lyrics, they're kept.
 */

export interface FoundLyrics { text: string; synced: SyncedLine[] | null; label: string }

/** The outside services the lyrics come from (replaced by fakes in tests). */
export interface LyricsServices {
  /**
   * Listens to the singer. Throws if it can't. `prompt` is the previous attempt's words (a
   * reattempt only): context so the second listen catches what the first missed, not a script —
   * the singer is still what's transcribed.
   */
  hear(prompt?: string): Promise<{ words: TimedWord[]; partial: boolean }>;
  /** Lyrics by song name/artist, or null. */
  lookup(query: string): Promise<FoundLyrics | null>;
  /** Names the song from rough heard words, or null if it isn't a song it knows. */
  identify(heard: string, hint?: string): Promise<{ title: string; artist: string | null } | null>;
}

export interface LyricsRequest {
  /** Lyrics the user gave (or the song's own): these words are used as they are. */
  own?: string;
  /** The song's name, to look its lyrics up by. */
  lookup?: string;
  /** Always listen to the singer first (Redo lyrics): lyrics found by name are used only if they match what's sung. */
  listen?: boolean;
  /**
   * This is a reattempt (Redo lyrics): the previous listen's words guide the new one, so it mainly
   * goes after what the first pass missed or got wrong instead of starting from nothing.
   */
  reattempt?: boolean;
}

export type LyricsSourceKind = 'own' | 'found' | 'recognized' | 'heard' | 'kept' | 'none';
export interface LyricsResult { source: LyricsSourceKind; label?: string; partial?: boolean }

type Progress = (fraction: number, detail?: string) => void;

/** One version of a song's lyrics from the lyrics database. */
export interface LyricsCandidate { title: string; artist: string; duration?: number; lyrics: string; synced?: string | null }

/**
 * Which version of the lyrics to use. The database often has several: the album track, the music
 * video's, a live or remixed one, with or without line timings. Preferred: the one whose length
 * matches the recording, and one with line timings (they line up with the singer directly) even if
 * a few seconds off; versions named as a video/live/remix/karaoke… only if that's what was asked for.
 */
export function pickLyrics(results: LyricsCandidate[], query: string, duration?: number): LyricsCandidate | null {
  const special = /\b(official|music video|video|live|remix|karaoke|instrumental|acapella|a cappella|cover|sped up|slowed|demo|acoustic)\b/i;
  const cost = (item: LyricsCandidate) =>
    (duration && item.duration ? Math.min(60, Math.abs(item.duration - duration)) : 0)
    - (item.synced ? 8 : 0)
    + (special.test(item.title) && !special.test(query) ? 15 : 0);
  return [...results].filter(item => item.lyrics?.trim()).sort((a, b) => cost(a) - cost(b))[0] ?? null;
}

/** Share of heard words (the distinctive ones) that are in these lyrics — "is this the song being sung?" */
export function heardMatch(lyrics: string, heard: Array<{ text: string }>): number {
  const clean = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}']/gu, '');
  const lyricWords = new Set(lyrics.split(/\s+/).map(clean));
  const distinct = [...new Set(heard.map(word => clean(word.text)).filter(word => word.length >= 4))];
  return distinct.filter(word => lyricWords.has(word)).length / Math.max(1, distinct.length);
}

/** Heard words in time order, once each (listening windows can overlap and repeat a word). */
export function inOrder(words: TimedWord[]): TimedWord[] {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const clean = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  return sorted.filter((word, i) => {
    const before = sorted[i - 1];
    return !before || clean(before.text) !== clean(word.text) || word.start - before.start > 0.3;
  });
}

const MATCH = 0.4;        // share of heard words that must be in fetched lyrics
const ENOUGH_HEARD = 15;  // fewer heard words than this can't check or recognise anything

const hasSungWords = (analysis: SongAnalysis) => analysis.lines.some(line => line.words.some(word => word.text !== '♪' && !word.aside));

/**
 * A reattempt builds on the first listen instead of replacing it. The fresh words are the primary
 * result (a clean second listen can clarify misheard words), but where the new pass heard nothing
 * and the first pass caught words over actual singing, those words are kept — the redo mainly goes
 * after what was missed the first time through, and never loses ground.
 */
export function mergeHeard(previous: TimedWord[], fresh: TimedWord[], notes: NoteEvent[]): TimedWord[] {
  if (!previous.length) return fresh;
  if (!fresh.length) return previous;
  const sungAt = (time: number) => notes.some(note => note.start <= time + 0.3 && note.end >= time - 0.3);
  const kept = previous.filter(word => {
    const covered = fresh.some(next => next.start < word.end + 0.2 && next.end > word.start - 0.2);
    return !covered && sungAt((word.start + word.end) / 2);
  });
  return inOrder([...fresh, ...kept]);
}

export async function writeLyrics(analysis: SongAnalysis, request: LyricsRequest, services: LyricsServices, progress: Progress = () => undefined): Promise<LyricsResult> {
  const own = request.own?.trim() ?? '';
  const settle = (result: LyricsResult): LyricsResult => {
    analysis.lyricsPending = false;
    analysis.sections = buildSections(analysis.lines, analysis.notes, analysis.duration, hasSungWords(analysis));
    return result;
  };
  const useText = (text: string, lines = applyTypedLyrics(analysis, text)) => {
    analysis.lines = lines;
    analysis.typed = text;
    analysis.transcript = 'edited';
  };

  // 1–2. Lyrics we already have, or can look up by name.
  let found = !own && request.lookup ? await services.lookup(request.lookup) : null;
  if (found?.synced && !request.listen) {
    const aligned = alignSyncedLyrics(analysis, found.synced);
    if (aligned) {
      useText(found.text, aligned.lines);
      diag('Lyrics: timed lyrics from ' + found.label + ' (shifted ' + aligned.offset.toFixed(1) + ' s, fit ' + Math.round(aligned.fit * 100) + '%)', 'ok');
      return settle({ source: 'found', label: found.label });
    }
    diag('Lyrics: the timed lyrics from ' + found.label + ' don’t fit this recording — listening instead', 'warn');
  }

  // 3. Listen.
  progress(0.05, 'Listening to the singer…');
  let heard: TimedWord[] = [];
  let partial = false;
  let hearingFailed = false;
  // A reattempt listens with the first pass in mind: its words are the prompt, so the second
  // listen mainly goes after what was missed or misheard rather than starting from nothing.
  const previousHeard = request.reattempt ? analysis.heard ?? [] : [];
  const prompt = previousHeard.length ? previousHeard.map(word => word.text).join(' ') : undefined;
  try {
    const result = await services.hear(prompt);
    heard = inOrder(result.words);
    partial = result.partial;
    if (request.reattempt) heard = mergeHeard(previousHeard, heard, analysis.notes);
    diag('Lyrics: heard ' + heard.length + ' words' + (partial ? ' (partial)' : '') + (request.reattempt ? ' (reattempt)' : ''), heard.length ? 'ok' : 'warn');
  } catch (error) {
    hearingFailed = true;
    diag('Lyrics: listening failed — ' + (error instanceof Error ? error.message : String(error)), 'error');
  }
  // What was heard is kept for timing (a failed redo keeps the earlier hearing).
  if (heard.length) analysis.heard = heard;

  // 4. Lyrics found by name must be the song being sung.
  if (found && heard.length >= ENOUGH_HEARD) {
    const match = heardMatch(found.text, heard);
    if (match < MATCH) {
      diag('Lyrics: “' + found.label + '” doesn’t match what’s sung (' + Math.round(match * 100) + '%) — ignoring it', 'warn');
      found = null;
    }
  }

  // Redo: timed lyrics found by name, now checked against what was heard.
  if (found?.synced && request.listen && heard.length >= ENOUGH_HEARD) {
    const aligned = alignSyncedLyrics(analysis, found.synced);
    if (aligned) {
      useText(found.text, aligned.lines);
      diag('Lyrics: timed lyrics from ' + found.label + ' match what’s sung', 'ok');
      return settle({ source: 'found', label: found.label });
    }
  }

  let text = own || found?.text || '';
  let result: LyricsResult = own ? { source: 'own' } : found ? { source: 'found', label: found.label } : { source: 'heard' };

  // 5. Recognise the song from what was heard.
  if (!text && heard.length >= ENOUGH_HEARD) {
    progress(0.9, 'Recognising the song…');
    const named = await services.identify(heard.slice(0, 300).map(word => word.text).join(' '), request.lookup).catch(() => null);
    const recognised = named ? await services.lookup(named.title + ' ' + (named.artist ?? '')) : null;
    if (!named) diag('Lyrics: song not recognised — using the words as heard (an original song?)');
    else if (!recognised) diag('Lyrics: recognised “' + named.title + '” but found no lyrics for it', 'warn');
    else if (heardMatch(recognised.text, heard) < MATCH) diag('Lyrics: recognised as ' + recognised.label + ', but its lyrics don’t match what’s sung — using the words as heard', 'warn');
    else {
      const aligned = recognised.synced ? alignSyncedLyrics(analysis, recognised.synced) : null;
      diag('Lyrics: recognised ' + recognised.label + ' — using its real lyrics', 'ok');
      if (aligned) { useText(recognised.text, aligned.lines); return settle({ source: 'recognized', label: recognised.label }); }
      text = recognised.text;
      result = { source: 'recognized', label: recognised.label };
    }
  }

  // 6. Lay the words on the singer's timing.
  if (text) {
    useText(text);
    diag('Lyrics: ' + (result.source === 'own' ? 'your lyrics' : result.label) + ', timed to the singer', 'ok');
  }
  else if (heard.length) {
    analysis.lines = buildLines(heard, analysis.notes);
    analysis.typed = undefined;
    analysis.transcript = 'ok';
  } else if (hasSungWords(analysis)) {
    diag('Lyrics: nothing new heard — the current lyrics were kept', 'warn');
    return settle({ source: 'kept' });
  } else {
    analysis.lines = buildLines([], analysis.notes);
    analysis.transcript = hearingFailed ? 'failed' : 'none';
    result = { source: 'none' };
  }
  return settle({ ...result, partial });
}
