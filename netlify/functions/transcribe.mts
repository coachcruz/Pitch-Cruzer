import type { Config } from '@netlify/functions';
import { env, json } from '../lib/http.mts';

/**
 * Server-side lyrics transcription with Whisper Large v3 Turbo (via Groq) — far more accurate on sung
 * vocals than the small models a browser can run, and done in seconds. Costs about $0.04 per hour of
 * audio. Needs GROQ_API_KEY; without it the app falls back to the in-browser model.
 *
 * GET  → { available }             (is the server model set up?)
 * POST → audio/mpeg body (≤ 4 MB), ?lang=xx (optional) &prompt=… (optional, e.g. the song title)
 *      ← { language, words: [{ text, start, end }], segments: [{ start, end, noSpeech, logProb }] }
 */
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MAX_BYTES = 4.5 * 1024 * 1024;

interface GroqResult {
  language?: string;
  words?: Array<{ word: string; start: number; end: number }>;
  segments?: Array<{ start: number; end: number; no_speech_prob?: number; avg_logprob?: number }>;
}

export default async (req: Request) => {
  const key = env('GROQ_API_KEY');
  if (req.method === 'GET') return json({ available: Boolean(key) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!key) return json({ error: 'GROQ_API_KEY is not configured', code: 'missing_key' }, 503);

  const audio = await req.arrayBuffer();
  if (audio.byteLength < 1024) return json({ error: 'No audio received.' }, 400);
  if (audio.byteLength > MAX_BYTES) return json({ error: 'Audio piece too large.' }, 413);

  const params = new URL(req.url).searchParams;
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/mpeg' }), 'vocal.mp3');
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  form.append('temperature', '0');
  const lang = params.get('lang');
  if (lang && /^[a-z]{2}$/.test(lang)) form.append('language', lang);
  const prompt = params.get('prompt')?.slice(0, 400);
  if (prompt) form.append('prompt', prompt);

  const response = await fetch(GROQ_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form }).catch(() => null);
  if (!response) return json({ error: 'The transcription service could not be reached.' }, 502);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return json({ error: 'Transcription service error ' + response.status, detail: detail.slice(0, 300) }, 502);
  }
  const result = (await response.json()) as GroqResult;
  return json({
    language: result.language ?? null,
    words: (result.words ?? []).map(word => ({ text: word.word.trim(), start: word.start, end: word.end })).filter(word => word.text),
    segments: (result.segments ?? []).map(segment => ({
      start: segment.start, end: segment.end, noSpeech: segment.no_speech_prob ?? 0, logProb: segment.avg_logprob ?? 0
    }))
  });
};

export const config: Config = { path: '/api/transcribe' };
