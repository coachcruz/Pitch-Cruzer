import { afterEach, describe, expect, it, vi } from 'vitest';

// The function reads its key through Netlify's global.
(globalThis as unknown as { Netlify: unknown }).Netlify = { env: { get: () => 'test-key' } };
const { default: identify } = await import('../netlify/functions/identify-song.mts');

const HEARD = 'one two three four five six seven eight nine ten';
const request = () => new Request('https://site/api/identify', { method: 'POST', body: JSON.stringify({ heard: HEARD }) });
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
    const asked = groq([], model => (model === 'llama-3.3-70b-versatile' ? song('Hello') : gone()));
    expect(await (await identify(request())).json()).toEqual({ title: 'Hello', artist: 'Someone' });
    expect(asked).toEqual(['llama-3.3-70b-versatile']);
  });

  it('when every listed model is retired, tries the chat models Groq has now, biggest first', async () => {
    const asked = groq(['whisper-large-v3', 'llama-guard-4-12b', 'tiny-1b', 'new-chat-70b', 'other-chat-32b'],
      model => (model === 'other-chat-32b' ? song('Hello') : gone()));
    expect(await (await identify(request())).json()).toEqual({ title: 'Hello', artist: 'Someone' });
    expect(asked.slice(3)).toEqual(['new-chat-70b', 'other-chat-32b']);
  });

  it('says what Groq answered when nothing works', async () => {
    groq([], () => gone());
    const response = await identify(request());
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe('Recognition service error 404');
    expect(body.detail).toContain('decommissioned');
    expect(body.tried).toEqual(['llama-3.3-70b-versatile → 404', 'openai/gpt-oss-120b → 404', 'llama-3.1-8b-instant → 404']);
  });
});
