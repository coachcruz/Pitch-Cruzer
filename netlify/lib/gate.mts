import { getStore } from '@netlify/blobs';
import { env, json } from './http.mts';

/**
 * The gate every /api/* function calls first.
 *
 * Two layers:
 * 1. App key — the browser sends `x-app-key: <PITCH_CRUZER_APP_KEY>` (baked into the bundle as
 *    VITE_PITCH_CRUZER_APP_KEY). This stops drive-by abuse: crawlers and anyone guessing the URL
 *    can't burn LALAL.AI minutes or Groq quota. It is NOT a vault — the key is visible in the
 *    shipped JS — so layer 2 does the real damage control.
 * 2. Per-IP daily quota (Netlify Blobs) on the endpoints that spend money. Even with a leaked key,
 *    one IP can only start a handful of paid jobs a day.
 *
 * Fail-closed: if PITCH_CRUZER_APP_KEY isn't set, every gated endpoint answers 503. A missing env
 * var must break loudly, never silently leave the paid endpoints open.
 *
 * Nothing about the user's songs changes: chunks were already deleted after reassembly
 * (see lalal-upload.mts) and stems download straight to the browser — the server never keeps
 * user audio. The gate only decides WHO may ask, not WHAT is stored.
 */

const APP_KEY_ENV = 'PITCH_CRUZER_APP_KEY';
const QUOTA_STORE = 'pitch-cruzer-ratelimit';

interface QuotaState { count: number; reset: number }

type StoreLike = {
  getWithMetadata(key: string, opts: { type: 'json'; consistency: 'strong' }): Promise<{ data: QuotaState; etag: string } | null>;
  setJSON(key: string, value: QuotaState, opts: { onlyIfNew: true } | { onlyIfMatch: string }): Promise<{ modified: boolean }>;
};

export interface GateOptions {
  /** Quota bucket name, e.g. 'lalal-split'. Omit for endpoints that spend nothing. */
  quota?: string;
  /** Max paid calls per IP per UTC day for this bucket. */
  limit?: number;
  /** Hard shared cap, independent of the caller's IP. */
  globalLimit?: number;
  /** Injected in tests; production uses the real Netlify Blobs store. */
  store?: StoreLike;
}

const asStore = (store: StoreLike | undefined): StoreLike =>
  store ?? (getStore({ name: QUOTA_STORE, consistency: 'strong' }) as unknown as StoreLike);

function clientIp(req: Request): string {
  return (
    req.headers.get('x-nf-client-connection-ip')?.trim() ||
    'unknown'
  );
}

async function ipHash(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pitch-cruzer|' + ip));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function today(): string {
  return new Date().toISOString().slice(0, 10); // UTC day
}

/**
 * Returns null when the request may proceed, otherwise the rejection Response.
 * Paid operations fail closed if quota storage cannot enforce their budget.
 */
export async function gate(req: Request, opts: GateOptions = {}): Promise<Response | null> {
  const expected = env(APP_KEY_ENV);
  if (!expected) {
    console.error(`[gate] ${APP_KEY_ENV} is not set — refusing all API traffic until it is.`);
    return json({ error: 'Server is not configured. The app owner needs to set PITCH_CRUZER_APP_KEY.' }, 503);
  }
  if (req.headers.get('x-app-key') !== expected) {
    return json({ error: 'Unauthorized' }, 401);
  }

  if (opts.quota && opts.limit) {
    try {
      const store = asStore(opts.store);
      const prefix = `${opts.quota}/${today()}/`;
      const configured = Number(env('PITCH_CRUZER_LIMIT_' + opts.quota.replace(/-/g, '_').toUpperCase()));
      const globalLimit = Number.isInteger(configured) && configured > 0 ? configured : opts.globalLimit ?? opts.limit * 10;
      if (!await reserve(store, prefix + await ipHash(clientIp(req)), opts.limit) || !await reserve(store, prefix + 'global', globalLimit)) {
        return json({ error: 'Daily limit reached for this endpoint. Try again tomorrow.' }, 429);
      }
    } catch (error) {
      console.error('[gate] quota check failed, refusing paid request:', error);
      return json({ error: 'Spending protection is temporarily unavailable. No new paid job was started. Try again shortly.' }, 503);
    }
  }
  return null;
}

async function reserve(store: StoreLike, key: string, limit: number): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const entry = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    const count = entry?.data.count ?? 0;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid quota state');
    if (count >= limit) return false;
    const result = await store.setJSON(key, { count: count + 1, reset: Date.now() }, entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
    if (result.modified) return true;
  }
  throw new Error('Quota contention');
}
