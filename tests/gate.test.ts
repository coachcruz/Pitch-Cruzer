import { describe, expect, it, beforeEach } from 'vitest';
import { gate } from '../netlify/lib/gate.mts';

// The function reads its key through Netlify's global.
const netlify = { env: { get: (name: string) => (name === 'PITCH_CRUZER_APP_KEY' ? 'secret123' : undefined) } };
(globalThis as unknown as { Netlify: unknown }).Netlify = netlify;

/** In-memory stand-in for the Netlify Blobs store. */
function fakeStore() {
  const data = new Map<string, { count: number; reset: number }>();
  return {
    data,
    get: async (key: string) => data.get(key) ?? null,
    setJSON: async (key: string, value: { count: number; reset: number }) => { data.set(key, value); },
  };
}

const req = (headers: Record<string, string> = {}) =>
  new Request('https://example.net/api/x', { headers: { 'x-app-key': 'secret123', ...headers } });

describe('gate', () => {
  beforeEach(() => {
    (globalThis as unknown as { Netlify: unknown }).Netlify = netlify;
  });

  it('lets a request with the right app key through', async () => {
    expect(await gate(req(), { store: fakeStore() })).toBeNull();
  });

  it('rejects a missing or wrong app key with 401', async () => {
    expect((await gate(req({ 'x-app-key': 'nope' }), { store: fakeStore() }))?.status).toBe(401);
    const missing = new Request('https://example.net/api/x');
    expect((await gate(missing, { store: fakeStore() }))?.status).toBe(401);
  });

  it('fails closed when the env var is not set', async () => {
    (globalThis as unknown as { Netlify: unknown }).Netlify = { env: { get: () => undefined } };
    const response = await gate(req(), { store: fakeStore() });
    expect(response?.status).toBe(503);
  });

  it('counts quota per UTC day and rejects past the limit', async () => {
    const store = fakeStore();
    const opts = { quota: 'lalal-split', limit: 2, store };
    expect(await gate(req(), opts)).toBeNull();
    expect(await gate(req(), opts)).toBeNull();
    const rejected = await gate(req(), opts);
    expect(rejected?.status).toBe(429);
    expect((await rejected?.json()) as { error?: string }).toHaveProperty('error');
  });

  it('does not store raw IPs in the quota keys', async () => {
    const store = fakeStore();
    await gate(req({ 'x-nf-client-connection-ip': '203.0.113.7' }), { quota: 'q', limit: 5, store });
    const keys = [...store.data.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain('203.0.113.7');
  });

  it('still allows the request when the quota store is down', async () => {
    const broken = {
      get: async () => { throw new Error('blobs down'); },
      setJSON: async () => { throw new Error('blobs down'); },
    };
    expect(await gate(req(), { quota: 'q', limit: 1, store: broken })).toBeNull();
  });
});
