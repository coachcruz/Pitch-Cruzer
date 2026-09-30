import { median } from './music';
import type { LyricLine, NoteEvent, SongAnalysis } from './analysis';
import type { Range } from './player';

/**
 * Duets (Kid Rock & Sheryl Crow, Sonny & Cher…): separation gives "the singers" as one track, so parts
 * are split by LINE instead — duet singers mostly take turns. Each line is guessed to be the lower or
 * the higher voice from how high it's sung; you pick which voice is yours and can switch any line by
 * hand. Your partner's lines keep the original singer at full volume; yours follow your Singer level
 * and are the only ones scored.
 */
export type Part = 'me' | 'partner';

function linePitch(line: LyricLine, notes: NoteEvent[]): number | null {
  const inside = notes.filter(note => note.end > line.start && note.start < line.end).map(note => note.midi);
  return inside.length ? median(inside) : null;
}

/** Splits the lines into a lower and a higher voice (two-group clustering of each line's pitch). */
export function lineVoices(lines: LyricLine[], notes: NoteEvent[]): Map<string, 'low' | 'high'> {
  const pitches = lines.map(line => linePitch(line, notes));
  const known = pitches.filter((pitch): pitch is number => pitch !== null).sort((a, b) => a - b);
  const voices = new Map<string, 'low' | 'high'>();
  if (!known.length) return voices;
  let low = known[Math.floor(known.length * 0.25)], high = known[Math.floor(known.length * 0.75)];
  for (let pass = 0; pass < 12; pass += 1) {
    const lows = known.filter(pitch => Math.abs(pitch - low) <= Math.abs(pitch - high));
    const highs = known.filter(pitch => Math.abs(pitch - low) > Math.abs(pitch - high));
    if (!lows.length || !highs.length) break;
    low = median(lows);
    high = median(highs);
  }
  lines.forEach((line, i) => {
    const pitch = pitches[i];
    voices.set(line.id, pitch === null || Math.abs(pitch - low) <= Math.abs(pitch - high) ? 'low' : 'high');
  });
  return voices;
}

/** The two singers' names for this song's duet (editable, saved per song). Defaults: Singer One (you), Singer Two (partner). */
export function duetNames(analysis: SongAnalysis): { me: string; partner: string } {
  const names = analysis.duet?.names;
  return {
    me: names?.me?.trim() || 'Singer One',
    partner: names?.partner?.trim() || 'Singer Two'
  };
}

/** Who sings each line in this song's duet, or null when it isn't set up as a duet. */
export function duetParts(analysis: SongAnalysis): Map<string, Part> | null {  const duet = analysis.duet;
  if (!duet) return null;
  const voices = lineVoices(analysis.lines, analysis.notes);
  const parts = new Map<string, Part>();
  analysis.lines.forEach(line => {
    parts.set(line.id, duet.overrides[line.id] ?? (voices.get(line.id) === duet.mine ? 'me' : 'partner'));
  });
  return parts;
}

/** Song-time stretches sung by your partner (the original singer stays at full volume there). */
export function partnerRanges(analysis: SongAnalysis, parts: Map<string, Part> | null): Range[] {
  if (!parts) return [];
  return analysis.lines
    .filter(line => parts.get(line.id) === 'partner')
    .map(line => ({ start: Math.max(0, line.start - 0.15), end: line.end + 0.25 }));
}
