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
const fakeFetch = vi.fn(async (url: string) =>
  new Response(JSON.stringify(serverBody), { status: 200, headers: { 'content-type': 'application/json' } }));
fakeFetch.mockImplementation(async (url: string) => {
  lastUrl = url;
  return new Response(JSON.stringify(serverBody), { status: 200, headers: { 'content-type': 'application/json' } });
});

afterEach(() => vi.unstubAllGlobals());

describe('server transcription: the reattempt prompt reaches the server', () => {
  it('sends the previous listen’s words as ?prompt=', async () => {
    vi.stubGlobal('fetch', fakeFetch);
    const words = await transcribeOnServer(buffer, notes, options, () => undefined, 'kid rock');
    expect(lastUrl).toContain('prompt=kid+rock');
    expect(words.map(w => w.text)).toEqual(['hello']);
  });

  it('sends no prompt when there is no previous listen', async () => {
    vi.stubGlobal('fetch', fakeFetch);
    await transcribeOnServer(buffer, notes, options, () => undefined);
    expect(lastUrl).not.toContain('prompt=');
  });

  it('trims a very long prompt to the API’s budget', async () => {
    vi.stubGlobal('fetch', fakeFetch);
    await transcribeOnServer(buffer, notes, options, () => undefined, 'word '.repeat(500));
    const prompt = new URL(lastUrl, 'https://x.test').searchParams.get('prompt') ?? '';
    expect(prompt.length).toBeLessThanOrEqual(800);
  });
});
