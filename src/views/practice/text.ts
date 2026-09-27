import type { LyricLine, Syllable } from '../../lib/analysis';
import { midiToFrequency, midiToNote } from '../../lib/music';
import type { TakeScore } from '../../lib/score';
import { escapeHtml } from '../../ui/dom';

/** Small text helpers shared by the practice screen's parts. */

function noteLabel(syllable: Syllable): string {
  if (!syllable.notes.length) return syllable.midi === null ? '·' : midiToNote(syllable.midi);
  return syllable.notes.map(midiToNote).join('→');
}

/** A lyric line as HTML: each syllable with its note above it and its timing in data attributes. */
export function syllablesHtml(line: LyricLine): string {
  return line.words.map(word => word.aside ? `<span class="word aside">${escapeHtml(word.text)}</span>` : '<span class="word">' + word.syllables.map((syllable, index) => {
    const hz = syllable.midi === null ? '' : ` title="${midiToNote(syllable.midi)} · ${midiToFrequency(Math.round(syllable.midi)).toFixed(0)} Hz"`;
    const joiner = index < word.syllables.length - 1 ? '<b class="hy">-</b>' : '';
    return `<span class="syl" data-s="${syllable.start.toFixed(3)}" data-e="${syllable.end.toFixed(3)}"${hz}><i>${escapeHtml(noteLabel(syllable))}</i><span class="t">${escapeHtml(syllable.text)}${joiner}</span></span>`;
  }).join('') + '</span>').join(' ');
}

export const lineText = (line: LyricLine) => line.words.map(word => word.text).join(' ');

/** The line you sang best (self-modelling: replaying yourself at your best builds confidence). */
export function bestLine(score: TakeScore) {
  const candidates = score.lines.filter(item => item.frames >= 10 && item.line.words.some(word => word.text !== '♪'));
  return candidates.sort((a, b) => b.percent - a.percent)[0] ?? null;
}

export function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'take';
}
