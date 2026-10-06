import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LyricsOptions, NoteEvent } from '../src/lib/analysis';
import { transcribeOnServer } from '../src/lib/serverTranscribe';

vi.mock('../src/lib/audio', () => ({
  resampleMono: async () => new Float32Array(10 * 16000),
}));

const options: LyricsOptions = { languages: ['en'], quality: 'fast' };
const notes: NoteEvent[] = [{ start: 0, end: 10, midi: 60 }];
const buffer = { duration: 10, sampleRate: 16000 } as unknown as AudioBuffer;
const serverBody = {
  language: 'english',
  words: [{ text: 'hello', start: 1, end: 1.5 }],
  segments: [{ start: 0, end: 10, noSpeech: 0, logProb: -0.1 }],
};

let lastUrl = '';
const fakeFetch = vi.fn(async (_url: string) =>
  new Response(JSON.stringify(serverBody), { status: 200, headers: { 'content-type': 'application/json' } }));
fakeFetch.mockImplementation(async (url: string) => {
  lastUrl = url;
  return new Response(JSON.stringify(serverBody), { status: 200, headers: { 'content-type': 'application/json' } });
});

afterEach(() => vi.unstubAllGlobals());

describe('server transcription: no prompt is ever sent', () => {
  it('never sends a ?prompt= — every listen is a fresh listen', async () => {
    vi.stubGlobal('fetch', fakeFetch);
    await transcribeOnServer(buffer, notes, options, () => undefined);
    expect(lastUrl).not.toContain('prompt=');
  });

  it('tags each word with its piece index, so repeats survive dedup', async () => {
    vi.stubGlobal('fetch', fakeFetch);
    const words = await transcribeOnServer(buffer, notes, options, () => undefined);
    expect(words.map(w => w.text)).toEqual(['hello']);
    for (const word of words) expect(typeof word.clip).toBe('number');
  });
});
