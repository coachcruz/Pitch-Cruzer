/**
 * Retries a server call that says "too many requests" (429 — Groq's free-tier limits) or hiccups (5xx).
 * A 429 says how long to wait (`retry-after`, in seconds), which is waited out up to `maxWaitMs`; other
 * failures wait the next of `backoffMs`. With `retryServerErrors: false` only a 429 is retried.
 * Returns the last response (or throws the last network error).
 */
export async function fetchWithRetry(
  request: () => Promise<Response>,
  { backoffMs = [3000, 10000], maxWaitMs = 30000, retryServerErrors = true, sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)) } = {}
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await request();
    const retryable = response.status === 429 || (retryServerErrors && response.status >= 500);
    if (!retryable || attempt >= backoffMs.length) return response;
    const after = parseFloat(response.headers.get('retry-after') ?? '');
    const wait = response.status === 429 && after > 0 ? Math.max(after * 1000, backoffMs[attempt]) : backoffMs[attempt];
    if (wait > maxWaitMs) return response;
    await sleep(wait);
  }
}
