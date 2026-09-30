import { afterEach, describe, expect, it, vi } from 'vitest';

// The function reads its key through Netlify's global.
(globalThis as unknown as { Netlify: unknown }).Netlify = { env: { get: () => 'test-key' } };
const { default: identify, MODELS } = await import('../netlify/functions/identify-song.mts');

const HEARD = 'one two three four five six seven eight nine ten';
const request = () => new Request('https://site/api/identify', {
  method: 'POST',
  headers: { 'x-app-key': 'test-key' }, // must match the mocked PITCH_CRUZER_APP_KEY
  body: JSON.stringify({ heard: HEARD }),
});
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const song = (title: string) => reply(200, { choices: [{ message: { content: JSON.stringify({ title, artist: 'Someone' }) } }] });
const gone = () => reply(404, { error: { message: 'The model has been decommissioned' } });

/** A fake Groq: `models` is what it lists, `answer` what it says to a chat call with a given model. */
function groq(models: string[], answer: (model: string) => Response) {
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url.endsWith('/models')) return reply(200, { data: models.map(id => ({ id, active: true })) });
    const model = JSON.parse(String(init?.body)).model as string;
    asked.push(model);
    return answer(model);
  });
  return asked;
}

afterEach(() => vi.unstubAllGlobals());

describe('/api/identify', () => {
  it('uses the first listed model that works', async () => {
    const asked = groq([], model => (model === MODELS[1] ? song('Hello') : gone()));
    expect(await (await identify(request())).json()).toEqual({ title: 'Hello', artist: 'Someone', model: MODELS[1] });
    expect(asked).toEqual(MODELS.slice(0, 2));
  });

  it('when every listed model is retired, tries the chat models Groq has now, biggest first', async () => {
    const asked = groq(['whisper-large-v3', 'llama-guard-4-12b', 'tiny-1b', 'new-chat-70b', 'other-chat-32b'],
      model => (model === 'other-chat-32b' ? song('Hello') : gone()));
    expect(await (await identify(request())).json()).toEqual({ title: 'Hello', artist: 'Someone', model: 'other-chat-32b' });
    expect(asked.slice(MODELS.length)).toEqual(['new-chat-70b', 'other-chat-32b']);
  });

  it('passes on a rate limit even when the models after it are gone', async () => {
    const asked = groq(['new-chat-70b'], model => (model === MODELS[0]
      ? new Response('{}', { status: 429, headers: { 'retry-after': '30' } }) : gone()));
    const response = await identify(request());
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(asked).toEqual(MODELS);
  });

  it('?model= asks only that model (to compare them)', async () => {
    const asked = groq([], () => song('Hello'));
    const one = new Request('https://site/api/identify?model=llama-3.3-70b-versatile', {
      method: 'POST',
      headers: { 'x-app-key': 'test-key' },
      body: JSON.stringify({ heard: HEARD }),
    });
    expect((await (await identify(one)).json()).model).toBe('llama-3.3-70b-versatile');
    expect(asked).toEqual(['llama-3.3-70b-versatile']);
  });

  it('picks the answer out of text (web-searching models answer in words)', async () => {
    groq([], () => reply(200, { choices: [{ message: { content: 'I searched the web.\n```json\n{"title": "Picture", "artist": "Kid Rock"}\n```' } }] }));
    expect(await (await identify(request())).json()).toMatchObject({ title: 'Picture', artist: 'Kid Rock' });
  });

  it('says what Groq answered when nothing works', async () => {
    groq([], () => gone());
    const response = await identify(request());
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe('Recognition service error 404');
    expect(body.detail).toContain('decommissioned');
    expect(body.tried).toEqual(MODELS.map(model => model + ' → 404'));
  });
});
