import { describe, expect, it, vi } from 'vitest';
import { writeLyrics, type FoundLyrics, type LyricsServices } from '../src/lib/lyrics';
import { makeSong, SONG } from './fixtures';

const WRONG_SONG = 'Baby shark doo doo doo\nMommy shark doo doo doo\nDaddy shark doo doo doo';

/** Fake services: what the listening hears, what each lookup finds, what recognition answers. */
function services(song: ReturnType<typeof makeSong>, options: {
  heard?: 'all' | 'none' | 'fail' | Array<{ text: string; start: number; end: number }>;
  lookups?: Record<string, FoundLyrics | null>;
  identify?: { title: string; artist: string | null } | null;
} = {}) {
  const heardWords = options.heard === 'all' || options.heard === undefined
    ? song.truth.map(w => ({ text: w.text.toLowerCase().replace(/rock/i, 'rook'), start: w.start, end: w.end }))
    : Array.isArray(options.heard) ? options.heard : [];
  const fake: LyricsServices = {
    hear: vi.fn(async () => {
      if (options.heard === 'fail') throw new Error('offline');
      return { words: heardWords, partial: false };
    }),
    lookup: vi.fn(async (query: string) => options.lookups?.[query.trim()] ?? null),
    identify: vi.fn(async () => options.identify ?? null)
  };
  return fake;
}

const sungText = (song: ReturnType<typeof makeSong>) =>
  song.analysis.lines.flatMap(line => line.words).filter(word => !word.aside).map(word => word.text).join(' ');

describe('writing the lyrics', () => {
  it('your own lyrics are used word for word — never replaced by what was heard', async () => {
    const song = makeSong(SONG);
    const fake = services(song);
    const result = await writeLyrics(song.analysis, { own: song.text, lookup: 'Some Song' }, fake);
    expect(result.source).toBe('own');
    expect(sungText(song)).toContain('Kid Rock playing');
    expect(fake.lookup).not.toHaveBeenCalled();
    expect(song.analysis.typed).toBe(song.text);
  });

  it('timed lyrics found by name that fit the singer are used without listening', async () => {
    const song = makeSong(SONG);
    const firstOfLine = song.truth.filter((w, i) => i === 0 || song.truth[i - 1].line !== w.line);
    const lines = SONG.filter(line => line.trim() && !/^\[/.test(line));
    const synced = lines.map((text, i) => ({ time: firstOfLine[i].start - 3, text }));   // the original has a 3 s shorter intro
    const fake = services(song, { lookups: { 'Amen Road': { text: lines.join('\n'), synced, label: 'Amen Road — Band' } } });
    const result = await writeLyrics(song.analysis, { lookup: 'Amen Road' }, fake);
    expect(result.source).toBe('found');
    expect(fake.hear).not.toHaveBeenCalled();
    const first = song.analysis.lines.flatMap(line => line.words).find(word => !word.aside)!;
    expect(Math.abs(first.start - song.truth[0].start)).toBeLessThan(0.3);
  });

  it('lyrics found by a vague name that aren’t what’s sung are thrown out, then the song is recognised', async () => {
    const song = makeSong(SONG);
    const fake = services(song, {
      lookups: {
        'IMG 1234': { text: WRONG_SONG, synced: null, label: 'Baby Shark — Pinkfong' },
        'Amen Road Band': { text: song.text, synced: null, label: 'Amen Road — Band' }
      },
      identify: { title: 'Amen Road', artist: 'Band' }
    });
    const result = await writeLyrics(song.analysis, { lookup: 'IMG 1234' }, fake);
    expect(result).toMatchObject({ source: 'recognized', label: 'Amen Road — Band' });
    expect(sungText(song)).toContain('Kid Rock playing');   // the real words, not the misheard "rook"
  });

  it('an original song nobody knows keeps the words as heard', async () => {
    const song = makeSong(SONG);
    const result = await writeLyrics(song.analysis, {}, services(song, { identify: null }));
    expect(result.source).toBe('heard');
    expect(sungText(song)).toContain('kid rook');
  });

  it('a recognised song whose lyrics don’t match what’s sung is not used', async () => {
    const song = makeSong(SONG);
    const fake = services(song, {
      identify: { title: 'Baby Shark', artist: 'Pinkfong' },
      lookups: { 'Baby Shark Pinkfong': { text: WRONG_SONG, synced: null, label: 'Baby Shark — Pinkfong' } }
    });
    const result = await writeLyrics(song.analysis, {}, fake);
    expect(result.source).toBe('heard');
  });

  it('a redo that can’t hear anything keeps the lyrics the song already has', async () => {
    const song = makeSong(SONG);
    await writeLyrics(song.analysis, { own: song.text }, services(song));
    const before = sungText(song);
    const result = await writeLyrics(song.analysis, {}, services(song, { heard: 'fail' }));
    expect(result.source).toBe('kept');
    expect(sungText(song)).toBe(before);
  });

  it('kept lyrics on a redo that fails to hear still re-time from the earlier hearing', async () => {
    const song = makeSong(SONG);
    await writeLyrics(song.analysis, { own: song.text }, services(song));
    const result = await writeLyrics(song.analysis, { own: song.text }, services(song, { heard: 'fail' }));
    expect(result.source).toBe('own');
    const first = song.analysis.lines.flatMap(line => line.words).find(word => !word.aside)!;
    expect(Math.abs(first.start - song.truth[0].start)).toBeLessThan(0.1);
  });

  it('with nothing at all, the notes still get ♪ lines and the song says so', async () => {
    const song = makeSong(SONG);
    const result = await writeLyrics(song.analysis, {}, services(song, { heard: 'none' }));
    expect(result.source).toBe('none');
    expect(song.analysis.lines.length).toBeGreaterThan(0);
    expect(song.analysis.lyricsPending).toBe(false);
  });

  it('sections come from the [tags] in the lyrics', async () => {
    const song = makeSong(SONG);
    await writeLyrics(song.analysis, { own: song.text }, services(song));
    expect(song.analysis.sections.map(section => section.kind)).toEqual(expect.arrayContaining(['verse', 'chorus']));
  });
});
