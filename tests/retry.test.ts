import { describe, expect, it } from 'vitest';
import { fetchWithRetry } from '../src/lib/retry';
import { groqFetch, rateLimited, retryDelayMs } from '../netlify/lib/groq.mts';

const answer = (status: number, headers: Record<string, string> = {}) => new Response('{}', { status, headers });

/** A fake server that gives these answers in turn, and remembers how often it was asked. */
function server(...answers: Response[]) {
  const calls = { count: 0 };
  return { calls, request: async () => answers[Math.min(calls.count++, answers.length - 1)] };
}

describe('browser retry (fetchWithRetry)', () => {
  it('waits as long as a 429 asks, then retries', async () => {
    const { calls, request } = server(answer(429, { 'retry-after': '7' }), answer(200));
    const waits: number[] = [];
    const response = await fetchWithRetry(request, { sleep: async ms => { waits.push(ms); } });
    expect(response.status).toBe(200);
    expect(calls.count).toBe(2);
    expect(waits).toEqual([7000]);
  });

  it('backs off on server errors and gives up after the last wait', async () => {
    const { calls, request } = server(answer(502));
    const waits: number[] = [];
    const response = await fetchWithRetry(request, { backoffMs: [1, 2], sleep: async ms => { waits.push(ms); } });
    expect(response.status).toBe(502);
    expect(calls.count).toBe(3);
    expect(waits).toEqual([1, 2]);
  });

  it('does not retry other answers, or a wait longer than allowed', async () => {
    const ok = server(answer(404));
    expect((await fetchWithRetry(ok.request, { sleep: async () => undefined })).status).toBe(404);
    expect(ok.calls.count).toBe(1);
    const long = server(answer(429, { 'retry-after': '120' }), answer(200));
    expect((await fetchWithRetry(long.request, { maxWaitMs: 30000, sleep: async () => undefined })).status).toBe(429);
    expect(long.calls.count).toBe(1);
  });
});

describe('server retry (Groq)', () => {
  it('reads how long Groq asks to wait', () => {
    expect(retryDelayMs(new Headers({ 'retry-after': '2' }))).toBe(2000);
    expect(retryDelayMs(new Headers({ 'x-ratelimit-reset-requests': '2m59.56s', 'x-ratelimit-reset-tokens': '7.66s' }))).toBe(179560);
    expect(retryDelayMs(new Headers({ 'x-ratelimit-reset-tokens': '340ms' }))).toBe(340);
    expect(retryDelayMs(new Headers())).toBeNull();
  });

  it('waits out a short limit and retries', async () => {
    const { calls, request } = server(answer(429, { 'retry-after': '0.01' }), answer(200));
    expect((await groqFetch(request, 1000))?.status).toBe(200);
    expect(calls.count).toBe(2);
  });

  it('passes a long limit on to the browser as a 429 with the wait', async () => {
    const { calls, request } = server(answer(429, { 'retry-after': '30' }));
    const response = await groqFetch(request, 1000);
    expect(response?.status).toBe(429);
    expect(calls.count).toBe(1);
    const passed = rateLimited(response!);
    expect(passed.status).toBe(429);
    expect(passed.headers.get('retry-after')).toBe('30');
    expect(await passed.json()).toMatchObject({ code: 'rate_limited', retryAfter: 30 });
  });
});
