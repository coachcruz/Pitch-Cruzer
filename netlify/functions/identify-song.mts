import type { Config } from '@netlify/functions';
import { env, json } from '../lib/http.mts';
import { groqFetch, isRateLimited, rateLimited } from '../lib/groq.mts';

/**
 * Names the song from the words heard in it, so its real lyrics can be fetched without the user
 * having to find them. Speech recognition on singing is only roughly right, but a language model
 * recognises a song from rough lines the way a person would. Uses the same GROQ_API_KEY as /api/transcribe.
 *
 * POST { heard: string, hint?: string }  ←  { title, artist } or { title: null }
 * The caller double-checks the answer against what was heard before trusting it.
 */
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant'];

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
  let response: Response | null = null;
  let limited: Response | null = null;
  for (const model of MODELS) {
    response = await groqFetch(() => fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 300,
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
    if (response && isRateLimited(response.status)) { limited ??= response; continue; }
    if (!response || (response.status !== 404 && response.status !== 400)) break;
  }
  if (response && isRateLimited(response.status) && limited) return rateLimited(limited);
  if (!response) return json({ error: 'The recognition service could not be reached.' }, 502);
  if (!response.ok) return json({ error: 'Recognition service error ' + response.status }, 502);
  const result = (await response.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
  let answer: { title?: unknown; artist?: unknown } = {};
  try { answer = JSON.parse(result?.choices?.[0]?.message?.content ?? '{}'); } catch { /* not JSON: treat as unknown */ }
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : null);
  return json({ title: text(answer.title), artist: text(answer.artist) });
};

export const config: Config = { path: '/api/identify' };
