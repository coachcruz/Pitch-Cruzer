import { afterEach, describe, expect, it, vi } from 'vitest';
import { splitRequest } from '../netlify/functions/lalal-split.mts';

afterEach(() => vi.unstubAllGlobals());

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** LALAL rejects the split when the idempotency key is not a UUID v4 (HTTP 422). */
describe('lalal split idempotency key', () => {
  it('sends a UUID v4 key', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return new Response('{}', { status: 200 });
    }));
    await splitRequest('test-key', 'source-123');
    const body = JSON.parse(bodies[0]!);
    expect(body.idempotency_key).toMatch(UUID_V4);
  });

  it('sends the same key for the same source, every time', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return new Response('{}', { status: 200 });
    }));
    await splitRequest('test-key', 'source-123');
    await splitRequest('test-key', 'source-123');
    const first = JSON.parse(bodies[0]!).idempotency_key;
    const second = JSON.parse(bodies[1]!).idempotency_key;
    expect(first).toBe(second);
  });
});
