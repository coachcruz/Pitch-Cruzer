import { describe, expect, it, vi } from 'vitest';
import { writeLyrics, mergeHeard, type FoundLyrics, type LyricsServices } from '../src/lib/lyrics';
import { buildLines, joinWords } from '../src/lib/analysis';
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

describe('redoing the lyrics', () => {
  it('always listens first, even when timed lyrics are found by name', async () => {
    const song = makeSong(SONG);
    const firstOfLine = song.truth.filter((w, i) => i === 0 || song.truth[i - 1].line !== w.line);
    const lines = SONG.filter(line => line.trim() && !/^\[/.test(line));
    const synced = lines.map((text, i) => ({ time: firstOfLine[i].start, text }));
    const fake = services(song, { lookups: { 'Amen Road': { text: lines.join('\n'), synced, label: 'Amen Road — Band' } } });
    const result = await writeLyrics(song.analysis, { lookup: 'Amen Road', listen: true }, fake);
    expect(fake.hear).toHaveBeenCalled();
    expect(result.source).toBe('found');   // they match what's sung, so the real lyrics are used
  });

  it('writes down what was heard when the lyrics found by name are another song', async () => {
    const song = makeSong(SONG);
    const fake = services(song, { lookups: { 'IMG 1234': { text: WRONG_SONG, synced: [{ time: 1, text: 'Baby shark doo doo doo' }], label: 'Baby Shark — Pinkfong' } } });
    const result = await writeLyrics(song.analysis, { lookup: 'IMG 1234', listen: true }, fake);
    expect(result.source).toBe('heard');
    expect(sungText(song)).not.toMatch(/shark/i);
  });
});

describe('heard words into lines', () => {
  // Heard by Whisper (via /api/transcribe) in a CC-BY a cappella (ccMixter 13596, “StandingBehindYou” by
  // nickleus). Each word is stretched over the pause after it, so only the punctuation shows the phrases.
  const HEARD = [["Standing", 0.22, 0.82], ["behind", 0.82, 1.72], ["you,", 1.72, 3.04], ["looking", 3.04, 4.04], ["in", 4.04, 4.78], ["the", 4.78, 5.04], ["mirror,", 5.04, 7.22], ["my", 7.22, 7.58], ["hands", 7.58, 8.16], ["holding", 8.16, 9.08], ["the", 9.08, 10.06], ["one", 10.06, 10.56], ["I", 10.56, 11.04], ["hold", 11.04, 11.48], ["dear.", 11.48, 12.66], ["The", 12.26, 14], ["shapes", 14, 14.62], ["of", 14.62, 15.06], ["your", 15.06, 15.38], ["body", 15.38, 16.62], ["enticing", 16.62, 18.12], ["my", 18.12, 18.7], ["mind,", 18.7, 20.64], ["words", 20.64, 21.3], ["can't", 21.3, 21.78], ["define", 21.78, 22.52], ["how", 22.52, 23.7], ["you", 23.7, 24.08], ["seem", 24.08, 24.56], ["to", 24.56, 24.92], ["stop", 24.92, 25.46], ["times.", 25.46, 27.1], ["I", 28.26, 28.48], ["don't", 28.48, 29.1], ["wanna", 29.1, 29.38], ["go,", 29.38, 30.98], ["but", 30.98, 31.12], ["time", 31.12, 31.78], ["it", 31.78, 32.04], ["takes", 32.04, 32.5], ["on", 32.5, 33.38], ["And", 33.38, 34.7], ["draws", 34.7, 35.24], ["me", 35.24, 35.66], ["away,", 35.66, 37.42], ["oh", 37.42, 37.78], ["I", 37.78, 38.16], ["wish", 38.16, 38.68], ["I", 38.68, 39], ["could", 39, 39.36], ["stay", 39.36, 39.86]].map(([text, start, end]) => ({ text: text as string, start: start as number, end: end as number }));

  it('breaks lines where the singer ends a phrase, not in the middle of one', () => {
    const lines = buildLines(HEARD, []).map(line => joinWords(line.words));
    expect(lines).toContain('my hands holding the one I hold dear.');
    expect(lines).toContain('The shapes of your body enticing my mind,');
    expect(lines.some(line => /my$|The$|words$/.test(line))).toBe(false);
  });

  it('writes Chinese and Japanese without spaces, other words with them', () => {
    expect(joinWords([{ text: '私' }, { text: 'の' }, { text: '哀れな' }, { text: 'heart' }, { text: 'ok' }])).toBe('私の哀れな heart ok');
  });
});

describe('picking the version of the lyrics', () => {
  // What the lyrics database really returns for "picture kid rock" (lengths and timings as listed).
  const results = [
    { title: 'Kid Rock - Picture feat. Sheryl Crow', artist: 'Kid Rock', duration: 301, lyrics: 'a', synced: null },
    { title: 'Kid Rock - Picture feat. Sheryl Crow [Official Music Video]', artist: 'Kid Rock', duration: 301, lyrics: 'b', synced: null },
    { title: 'Picture', artist: 'Kid Rock', duration: 299, lyrics: 'c', synced: '[00:10.00] c' },
    { title: 'Picture', artist: 'Kid Rock', duration: 370, lyrics: 'd', synced: '[00:10.00] d' }
  ];
  it('prefers a version with line timings when its length is close', async () => {
    const { pickLyrics } = await import('../src/lib/lyrics');
    expect(pickLyrics(results, 'picture kid rock', 300)?.lyrics).toBe('c');
  });
  it('the long (video) version when the recording is that long', async () => {
    const { pickLyrics } = await import('../src/lib/lyrics');
    expect(pickLyrics(results, 'picture kid rock', 368)?.lyrics).toBe('d');
  });
  it('never a music-video/live version unless asked for', async () => {
    const { pickLyrics } = await import('../src/lib/lyrics');
    expect(pickLyrics(results.slice(0, 2), 'picture kid rock', 301)?.lyrics).toBe('a');
  });
});

describe('reattempting the lyrics (Redo listens with the first pass in mind)', () => {
  const notes = [
    { start: 10, end: 12, midi: 60 },
    { start: 13, end: 15, midi: 62 },
    { start: 30, end: 32, midi: 64 },   // singing with no fresh words — a missed word lives here
  ];

  it('mergeHeard: fresh words win where they overlap the first pass', () => {
    const previous = [{ text: 'rook', start: 10.1, end: 10.4 }];
    const fresh = [{ text: 'rock', start: 10.1, end: 10.4 }];
    const merged = mergeHeard(previous, fresh, notes);
    expect(merged.map(w => w.text)).toEqual(['rock']);
  });

  it('mergeHeard: first-pass words the fresh pass missed are kept over singing', () => {
    const previous = [
      { text: 'hello', start: 10.1, end: 10.4 },
      { text: 'missed', start: 30.1, end: 30.5 },
    ];
    const fresh = [{ text: 'hello', start: 10.1, end: 10.4 }];
    const merged = mergeHeard(previous, fresh, notes);
    expect(merged.map(w => w.text)).toEqual(['hello', 'missed']);
  });

  it('mergeHeard: first-pass words in silence are not resurrected', () => {
    const previous = [{ text: 'hallucination', start: 50.1, end: 50.5 }];  // no notes here
    const fresh = [{ text: 'hello', start: 10.1, end: 10.4 }];
    const merged = mergeHeard(previous, fresh, notes);
    expect(merged.map(w => w.text)).toEqual(['hello']);
  });

  it('mergeHeard: empty sides pass through', () => {
    const fresh = [{ text: 'hello', start: 10.1, end: 10.4 }];
    expect(mergeHeard([], fresh, notes)).toEqual(fresh);
    const previous = [{ text: 'hello', start: 10.1, end: 10.4 }];
    expect(mergeHeard(previous, [], notes)).toEqual(previous);
  });

  it('a reattempt passes the first listen’s words to the second listen as its prompt', async () => {
    const song = makeSong(SONG);
    song.analysis.heard = [
      { text: 'kid', start: 15.1, end: 15.3 },
      { text: 'rock', start: 15.4, end: 15.7 },
    ];
    const fake = services(song, { heard: [] });
    await writeLyrics(song.analysis, { listen: true, reattempt: true }, fake);
    expect(fake.hear).toHaveBeenCalledWith('kid rock');
  });

  it('without reattempt, the second listen gets no prompt', async () => {
    const song = makeSong(SONG);
    song.analysis.heard = [{ text: 'kid', start: 15.1, end: 15.3 }];
    const fake = services(song, { heard: [] });
    await writeLyrics(song.analysis, { listen: true }, fake);
    expect(fake.hear).toHaveBeenCalledWith(undefined);
  });

  it('a reattempt keeps first-pass words the fresh listen missed, over the singing', async () => {
    const song = makeSong(SONG);
    // The first pass caught the opening word; the fresh pass hears nothing at all.
    const firstWord = song.truth[0];
    song.analysis.heard = [{ text: firstWord.text, start: firstWord.start, end: firstWord.end }];
    const fake = services(song, { heard: [] });
    const result = await writeLyrics(song.analysis, { listen: true, reattempt: true }, fake);
    expect(result.source).toBe('heard');
    expect(sungText(song)).toContain(firstWord.text);
  });
});
