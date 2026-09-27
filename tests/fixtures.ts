import { buildLines, syllabify, type NoteEvent, type SongAnalysis } from '../src/lib/analysis';

/**
 * A made-up song: every syllable is sung on its own note, lines are separated by breaths, and the
 * singing starts after an instrumental intro. Returns the notes (what pitch detection would find)
 * and the true time of every word, to check timing against.
 */
export function makeSong(lyrics: string[], { intro = 15, syllable = 0.32, gap = 0.06, breath = 1.2, betweenSections = 0 } = {}) {
  const notes: NoteEvent[] = [];
  const truth: Array<{ text: string; start: number; end: number; line: number }> = [];
  let t = intro;
  lyrics.forEach((line, lineIndex) => {
    if (!line.trim()) { t += betweenSections; return; }
    if (/^\[.*\]$/.test(line.trim())) return; // a section tag isn't sung
    for (const word of line.split(/\s+/)) {
      const start = t;
      const count = Math.max(1, syllabify(word).length);
      for (let k = 0; k < count; k += 1) {
        notes.push({ start: t, end: t + syllable, midi: 60 + ((lineIndex + k) % 5) });
        t += syllable + gap;
      }
      truth.push({ text: word, start, end: t - gap, line: lineIndex });
    }
    t += breath;
  });
  const duration = t + 10;
  const analysis: SongAnalysis = {
    duration, key: null, range: [60, 64], notes, lines: buildLines([], notes), sections: [],
    transcript: 'none', separated: true
  };
  return { notes, truth, analysis, text: lyrics.join('\n') };
}

export const SONG = [
  '[Verse 1]',
  'Walking down the empty road tonight',
  'Every window burning gold and bright',
  'I can hear the river calling me',
  'Carry me back home where I should be',
  '',
  '[Chorus]',
  'Amen amen sing it out loud',
  'Amen amen standing proud',
  'Kid Rock playing on the radio',
  'Amen amen let it go'
];
