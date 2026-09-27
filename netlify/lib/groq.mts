import { json } from './http.mts';

/**
 * Calls to Groq, which rate-limits the free tier per model (requests and tokens per minute). A "too
 * many requests" (429) or "over capacity" (503) answer says how long to wait; a short wait is waited
 * out here and the call retried. A longer one is passed on (`rateLimited`) so the browser can wait
 * instead — a Netlify function only has about 10 seconds to answer.
 */

/** How long Groq asks us to wait, in ms (null if it doesn't say). */
export function retryDelayMs(headers: Headers): number | null {
  const after = headers.get('retry-after');
  if (after && /^\d+(\.\d+)?$/.test(after.trim())) return Math.ceil(parseFloat(after) * 1000);
  // Groq also says when each limit resets, as a duration like "7.66s", "2m59.56s" or "340ms".
  const resets = ['x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens']
    .map(name => durationMs(headers.get(name)))
    .filter((ms): ms is number => ms !== null);
  return resets.length ? Math.max(...resets) : null;
}

function durationMs(value: string | null): number | null {
  const match = value?.trim().match(/^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/);
  if (!match || !match.slice(1).some(Boolean)) return null;
  const [, h, m, s, ms] = match.map(part => parseFloat(part ?? '0'));
  return Math.ceil(((h * 60 + m) * 60 + s) * 1000 + ms);
}

export const isRateLimited = (status: number) => status === 429 || status === 503;

/**
 * `request` is called for each try. Waits out rate limits while the total wait stays within
 * `budgetMs`; returns the last response (still a 429/503 if the wait would be too long).
 */
export async function groqFetch(request: () => Promise<Response>, budgetMs = 6000): Promise<Response | null> {
  let waited = 0;
  for (;;) {
    const response = await request().catch(() => null);
    if (!response || !isRateLimited(response.status)) return response;
    const wait = retryDelayMs(response.headers) ?? 1000;
    if (waited + wait > budgetMs) return response;
    await response.body?.cancel().catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, wait));
    waited += wait;
  }
}

/** The answer for a call that is still rate-limited: 429, with how long to wait (seconds). */
export function rateLimited(response: Response): Response {
  const seconds = Math.max(1, Math.ceil((retryDelayMs(response.headers) ?? 5000) / 1000));
  const answer = json({ error: 'Groq is busy (rate limit) — try again shortly.', code: 'rate_limited', retryAfter: seconds }, 429);
  answer.headers.set('retry-after', String(seconds));
  return answer;
}
