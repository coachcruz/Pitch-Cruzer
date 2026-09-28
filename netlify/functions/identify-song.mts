import type { Config } from '@netlify/functions';
import { env, json } from '../lib/http.mts';
import { groqFetch, isRateLimited, rateLimited } from '../lib/groq.mts';

/**
 * Names the song from the words heard in it, so its real lyrics can be fetched without the user
 * having to find them. Speech recognition on singing is only roughly right, but a language model
 * recognises a song from rough lines the way a person would. Uses the same GROQ_API_KEY as /api/transcribe.
 *
 * POST { heard: string, hint?: string }  ←  { title, artist, model } (title null: not recognised)
 * ?model=… asks only that one of MODELS (to compare them on real lyrics).
 * The caller double-checks the answer against what was heard before trusting it.
 */
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';
// Most song knowledge first (tested on real lyrics: the small Llama models name the wrong song even
// from exact lyrics). The next one is tried if a model is unavailable.
const MODELS = ['openai/gpt-oss-120b', 'moonshotai/kimi-k2-instruct', 'llama-3.3-70b-versatile'];

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const key = env('GROQ_API_KEY');
  if (!key) return json({ error: 'GROQ_API_KEY is not configured', code: 'missing_key' }, 503);
  const body = (await req.json().catch(() => ({}))) as { heard?: unknown; hint?: unknown };
  const heard = typeof body.heard === 'string' ? body.heard.slice(0, 2500).trim() : '';
  const hint = typeof body.hint === 'string' ? body.hint.slice(0, 200).trim() : '';
  if (heard.split(/\s+/).length < 8) return json({ error: 'Not enough words to recognise the song.' }, 400);

  // Models get retired now and then: try the next one if a model isn't available. Each model has its own
  // free-tier rate limit, so a model that's rate-limited (after a short wait) hands over to the next one too.
  // If every listed model is gone, ask Groq which models it has now and try those.
  const ask = (model: string) => groqFetch(() => fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      // Reasoning models think before they answer: room for that, kept short.
      max_tokens: 1500,
      ...(model.startsWith('openai/') ? { reasoning_effort: 'low' } : {}),
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You identify songs from their lyrics. The lyrics were written down by speech recognition from a sung vocal, so some words are misheard. '
            + 'Answer only with JSON: {"title": string | null, "artist": string | null}. Use the official title and main artist of the released song. '
            + 'If you do not clearly recognise a released song, answer {"title": null, "artist": null} — never guess.'
        },
        { role: 'user', content: (hint ? 'File or video name (may be meaningless): ' + hint + '\n\n' : '') + 'Heard lyrics:\n' + heard }
      ]
    })
  }), 2000);

  let response: Response | null = null;
  let limited: Response | null = null;
  let detail = '';
  const tried: string[] = [];
  const tryModels = async (models: string[]) => {
    for (const model of models) {
      response = await ask(model);
      tried.push(model + ' → ' + (response?.status ?? 'unreachable'));
      if (response && isRateLimited(response.status)) { limited ??= response; continue; }
      if (!response || (response.status !== 404 && response.status !== 400)) return true;
      detail = (await response.text().catch(() => '')).slice(0, 300);
    }
    return false;
  };
  const only = new URL(req.url).searchParams.get('model');
  if (only && MODELS.includes(only)) await tryModels([only]);
  else if (!(await tryModels(MODELS)) && !limited) await tryModels(await currentModels(key));
  const final = response as Response | null;
  // A model that was only busy beats one that's gone: the browser waits and asks again.
  if (limited && !final?.ok) return rateLimited(limited);
  if (!final) return json({ error: 'The recognition service could not be reached.', tried }, 502);
  if (!final.ok) {
    if (!detail) detail = (await final.text().catch(() => '')).slice(0, 300);
    return json({ error: 'Recognition service error ' + final.status, detail, tried }, 502);
  }
  const result = (await final.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
  let answer: { title?: unknown; artist?: unknown } = {};
  try { answer = JSON.parse(result?.choices?.[0]?.message?.content ?? '{}'); } catch { /* not JSON: treat as unknown */ }
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : null);
  return json({ title: text(answer.title), artist: text(answer.artist), model: tried[tried.length - 1]?.split(' → ')[0] ?? null });
};

/** Chat models Groq offers right now (not the listed ones, nor speech, safety or tiny models), biggest first. */
async function currentModels(key: string): Promise<string[]> {
  const response = await fetch(GROQ_MODELS_URL, { headers: { Authorization: 'Bearer ' + key } }).catch(() => null);
  const list = response?.ok ? ((await response.json().catch(() => null)) as { data?: Array<{ id?: unknown; active?: unknown }> } | null) : null;
  const size = (id: string) => Number(/(\d+)b\b/i.exec(id)?.[1] ?? 0);
  return (list?.data ?? [])
    .map(model => (model.active === false ? '' : typeof model.id === 'string' ? model.id : ''))
    .filter(id => id && !MODELS.includes(id) && !/whisper|tts|guard|playai|orpheus|compound|distil|embed/i.test(id) && (size(id) === 0 || size(id) >= 8))
    .sort((a, b) => size(b) - size(a))
    .slice(0, 3);
}

export const config: Config = { path: '/api/identify' };
