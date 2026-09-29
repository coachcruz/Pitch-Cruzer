import type { LyricLine } from './analysis';
import type { TakeScore } from './score';

/**
 * Song builder: you sing a song line by line (Echo style), keep the take you like for each line,
 * and your kept lines are joined into one recording of the whole song. This is the joining — no
 * browser APIs, so it's unit-tested:
 *  - each line is cut a little before and after its words, so breaths and word endings stay in;
 *  - where two lines meet, they cross-fade over a moment between them (no clicks, no gap, no doubling);
 *  - every line is brought to the same singing loudness, so no line jumps out or drops away.
 */

/** One kept line: its recorded voice and where it sits in the song. */
export interface KeptLine {
  /** The line's words, in song seconds. */
  start: number;
  end: number;
  samples: Float32Array;
  sampleRate: number;
  /** The song moment the first recorded sample belongs to. */
  songTimeAtStart: number;
}

const BEFORE = 0.25;   // s kept before a line's first word (the breath in)
const AFTER = 0.4;     // s kept after its last word (the word's tail)
const FADE = 0.08;     // s: fade in/out, and the cross-fade where two lines meet

/** How loud someone sings in this recording: a loud 50 ms stretch (80th percentile), not the average with the silences. */
export function singingLevel(samples: Float32Array, sampleRate: number): number {
  const frame = Math.max(1, Math.round(sampleRate * 0.05));
  const levels: number[] = [];
  for (let from = 0; from + frame <= samples.length; from += frame) {
    let sum = 0;
    for (let i = from; i < from + frame; i += 1) sum += samples[i] * samples[i];
    levels.push(Math.sqrt(sum / frame));
  }
  const heard = levels.filter(level => level > 0.005).sort((a, b) => a - b);
  return heard.length ? heard[Math.floor(heard.length * 0.8)] : 0;
}

/** Sample of `line` at song time `t` (linear interpolation; also converts sample rates). */
function sampleAt(line: KeptLine, t: number): number {
  const position = (t - line.songTimeAtStart) * line.sampleRate;
  const i = Math.floor(position);
  if (i < 0 || i + 1 >= line.samples.length) return 0;
  const frac = position - i;
  return line.samples[i] * (1 - frac) + line.samples[i + 1] * frac;
}

/** Raised-cosine ramp 0→1 over [a, b]. */
function ramp(t: number, a: number, b: number): number {
  if (t <= a) return 0;
  if (t >= b) return 1;
  return 0.5 - 0.5 * Math.cos((Math.PI * (t - a)) / (b - a));
}

/** Your kept lines joined into one vocal track for the whole song (`duration` s at `sampleRate`). */
export function stitchVocal(kept: KeptLine[], duration: number, sampleRate: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.ceil(duration * sampleRate));
  const lines = [...kept].sort((a, b) => a.start - b.start);
  const levels = lines.map(line => singingLevel(line.samples, line.sampleRate));
  const heard = levels.filter(level => level > 0).sort((a, b) => a - b);
  const target = heard.length ? heard[Math.floor(heard.length / 2)] : 0;

  lines.forEach((line, i) => {
    // Where this line starts and ends: a little around its words, but where it meets a neighbour,
    // halfway between them (the two cross-fade there).
    const previous = lines[i - 1], next = lines[i + 1];
    let from = line.start - BEFORE, to = line.end + AFTER;
    if (previous && previous.end + AFTER > from) from = Math.max((previous.end + line.start) / 2 - FADE / 2, previous.start);
    if (next && to > next.start - BEFORE) to = Math.min((line.end + next.start) / 2 + FADE / 2, next.end);
    // Never outside what was recorded.
    const recordedTo = line.songTimeAtStart + line.samples.length / line.sampleRate;
    from = Math.max(from, line.songTimeAtStart, 0);
    to = Math.min(to, recordedTo, duration);
    if (to - from < 2 * FADE) return;
    // Even loudness: at most twice as loud or half as loud as recorded.
    const gain = levels[i] > 0 && target > 0 ? Math.min(2, Math.max(0.5, target / levels[i])) : 1;
    const first = Math.max(0, Math.floor(from * sampleRate)), last = Math.min(out.length, Math.ceil(to * sampleRate));
    for (let n = first; n < last; n += 1) {
      const t = n / sampleRate;
      const envelope = Math.min(ramp(t, from, from + FADE), 1 - ramp(t, to - FADE, to));
      out[n] += sampleAt(line, t) * gain * envelope;
    }
  });
  return out;
}

/** What to say after a line: how it went, and one thing to try (or praise when it's earned). */
export function lineFeedback(score: TakeScore): { headline: string; note: string } {
  const s = score.score;
  const headline = s >= 85 ? '🌟 Beautiful!' : s >= 70 ? 'Great line!' : s >= 50 ? 'Nice — getting close' : s >= 30 ? 'Getting there' : 'Keep going';
  if (score.coverage < 40) return { headline, note: 'I could only hear you on some of the notes — sing out a bit more, or turn “Hear myself” on.' };
  if (s >= 85) {
    return { headline, note: score.steadiness !== null && score.steadiness >= 75 ? 'Right on the notes and nicely steady. That one’s a keeper.' : 'Right on the notes. That one’s a keeper.' };
  }
  if (score.meanCents !== null && score.meanCents < -25) return { headline, note: 'A little under the notes (flat). Think “up” and give the long notes a touch more breath.' };
  if (score.meanCents !== null && score.meanCents > 25) return { headline, note: 'A little over the notes (sharp). Relax and let each note settle instead of pushing.' };
  if (score.steadiness !== null && score.steadiness < 50) return { headline, note: 'You’re finding the notes — now hold them steadier, with a slow, even breath.' };
  if (s >= 70) return { headline, note: 'Solid. Keep it, or try once more for the finishing touch.' };
  return { headline, note: 'Listen to the line once more, then sing it again following the highlighted words.' };
}

/**
 * One turn at a line: what plays, from when to when. The cue is the end of the line before — its
 * last two words, sung by the artist — so you come in right where the song comes back to you, as in
 * the song itself (and never over a stretch where the artist is still singing). With no line close
 * before (the first line, or after a long instrumental) the music, or three beeps, count you in.
 */
export interface TurnPlan {
  /** Song time the turn starts playing from. */
  start: number;
  /** Your line: the artist is heard until here, then it's your turn. */
  lineStart: number;
  end: number;
  /** Where the artist's cue (the previous line's last words) starts, or null for a count-in. */
  cueFrom: number | null;
}

const CUE_WORDS = 2;
const MAX_CUE_WAIT = 5;    // s: a cue further back than this (an instrumental between) isn't a cue
const COUNT_IN = 2;        // s of count-in before a line with no cue
const AFTER_LINE = 0.6;    // s after the line, for its last word's tail

const sungWords = (line: LyricLine) => line.words.filter(word => !word.aside && word.text !== '♪');

export function turnPlan(lines: LyricLine[], line: LyricLine, duration: number): TurnPlan {
  const end = Math.min(duration, line.end + AFTER_LINE);
  const before = lines.filter(item => item !== line && item.start < line.start && sungWords(item).length)
    .sort((a, b) => a.start - b.start).pop();
  // Only words sung before your line starts: where lines overlap, the artist's words over yours aren't a cue.
  const words = before ? sungWords(before).filter(word => word.end <= line.start + 0.05) : [];
  const cueFrom = words.length ? words[Math.max(0, words.length - CUE_WORDS)].start : null;
  if (cueFrom !== null && cueFrom < line.start && line.start - cueFrom <= MAX_CUE_WAIT) {
    return { start: Math.max(0, cueFrom - 0.15), lineStart: line.start, end, cueFrom };
  }
  return { start: Math.max(0, line.start - COUNT_IN), lineStart: line.start, end, cueFrom: null };
}

/**
 * What "Put my song together" makes: the whole song (intro and outro too) once every line is kept;
 * before that, only the stretch you've sung — from a moment before your first kept line to a moment
 * after your last — faded in and out, rather than minutes of music with nobody singing.
 */
export function assembleSpan(kept: Array<{ start: number; end: number }>, lineCount: number, duration: number): { start: number; end: number; whole: boolean } {
  if (!kept.length) return { start: 0, end: 0, whole: false };
  if (kept.length >= lineCount) return { start: 0, end: duration, whole: true };
  const first = Math.min(...kept.map(line => line.start)), last = Math.max(...kept.map(line => line.end));
  return { start: Math.max(0, first - 2), end: Math.min(duration, last + 2.5), whole: false };
}
