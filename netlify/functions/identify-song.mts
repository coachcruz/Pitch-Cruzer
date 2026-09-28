import type { Config } from '@netlify/functions';
import { env, json } from '../lib/http.mts';
import { groqFetch, isRateLimited, rateLimited } from '../lib/groq.mts';

/**
 * Names the song from the words heard in it, so its real lyrics can be fetched without the user
 * having to find them. Speech recognition on singing is only roughly right, but a language model
 * recognises a song from rough lines the way a person would. Uses the same GROQ_API_KEY as /api/transcribe.
 *
 * POST { heard: string, hint?: string }  ←  { title, artist, model } (title null: not recognised)
 * ?model=… asks only that model (one of MODELS or COMPARE — to compare them on real lyrics).
 * GET  ← { models } — the chat models this Groq key can use right now.
 * The caller double-checks the answer against the real lyrics before trusting it, so a best guess is
 * asked for: a wrong guess costs nothing, a missed song means guessed lyrics.
 */
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';
// Live tests ("Picture", Kid Rock — from its exact lyrics and from misheard ones): gpt-oss with Groq's
// built-in web search named it every time in 7–13 s; from memory alone, gpt-oss said "no idea" and
// qwen3.8 / llama named other songs. So only the web-searching models are asked; the next one is tried
// if one is unavailable.
export const MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
const COMPARE = ['qwen/qwen3.8-27b', 'groq/compound', 'groq/compound-mini', 'llama-3.3-70b-versatile', 'moonshotai/kimi-k2-instruct'];
const searches = (model: string) => model.startsWith('openai/gpt-oss') || model.startsWith('groq/compound');

export default async (req: Request) => {
  const key = env('GROQ_API_KEY');
  if (!key) return json({ error: 'GROQ_API_KEY is not configured', code: 'missing_key' }, 503);
  if (req.method === 'GET') return json({ models: await currentModels(key, true) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
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
      max_tokens: searches(model) ? 4000 : 1500,
      ...(model.startsWith('openai/') ? { reasoning_effort: 'medium' } : {}),
      // Web-searching models answer in text (JSON is picked out of it below).
      ...(searches(model) ? {} : { response_format: { type: 'json_object' } }),
      ...(model.startsWith('openai/gpt-oss') ? { tools: [{ type: 'browser_search' }], tool_choice: 'auto' } : {}),
      messages: [
        {
          role: 'system',
          content: 'You identify songs from their lyrics. The lyrics were written down by speech recognition from a sung vocal, so some words are misheard. '
            + (searches(model) ? 'Search the web for a few distinctive lines to find the song. ' : '')
            + 'Answer with only JSON: {"title": string | null, "artist": string | null} — the official title and main artist of the released song. '
            + 'Give your best guess: the answer is checked against the real lyrics afterwards. Answer {"title": null, "artist": null} only if you have no idea.'
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
  if (only && (MODELS.includes(only) || COMPARE.includes(only))) await tryModels([only]);
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
  const content = result?.choices?.[0]?.message?.content ?? '';
  // The JSON, even when it comes wrapped in text or a code block.
  const found = content.match(/\{[^{}]*"title"[^{}]*\}/);
  try { answer = JSON.parse(found ? found[0] : content || '{}'); } catch { /* not JSON: treat as unknown */ }
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : null);
  return json({ title: text(answer.title), artist: text(answer.artist), model: tried[tried.length - 1]?.split(' → ')[0] ?? null });
};

/** Chat models Groq offers right now (not the listed ones, nor speech, safety or tiny models), biggest first; `all`: every model id. */
async function currentModels(key: string, all = false): Promise<string[]> {
  const response = await fetch(GROQ_MODELS_URL, { headers: { Authorization: 'Bearer ' + key } }).catch(() => null);
  const list = response?.ok ? ((await response.json().catch(() => null)) as { data?: Array<{ id?: unknown; active?: unknown }> } | null) : null;
  const size = (id: string) => Number(/(\d+)b\b/i.exec(id)?.[1] ?? 0);
  const ids = (list?.data ?? []).map(model => (model.active === false ? '' : typeof model.id === 'string' ? model.id : '')).filter(Boolean);
  if (all) return ids.sort();
  return ids
    .filter(id => id && !MODELS.includes(id) && !/whisper|tts|guard|playai|orpheus|compound|distil|embed/i.test(id) && (size(id) === 0 || size(id) >= 8))
    .sort((a, b) => size(b) - size(a))
    .slice(0, 3);
}

export const config: Config = { path: '/api/identify' };
