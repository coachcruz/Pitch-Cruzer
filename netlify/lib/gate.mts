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
  get(key: string, opts?: { type: 'json' }): Promise<QuotaState | null>;
  setJSON(key: string, value: QuotaState): Promise<void>;
};

export interface GateOptions {
  /** Quota bucket name, e.g. 'lalal-split'. Omit for endpoints that spend nothing. */
  quota?: string;
  /** Max paid calls per IP per UTC day for this bucket. */
  limit?: number;
  /** Injected in tests; production uses the real Netlify Blobs store. */
  store?: StoreLike;
}

const asStore = (store: StoreLike | undefined): StoreLike =>
  store ?? (getStore(QUOTA_STORE) as unknown as StoreLike);

function clientIp(req: Request): string {
  return (
    req.headers.get('x-nf-client-connection-ip')?.trim() ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
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
 * Quota failures (Blobs unavailable) fail OPEN — the app key already did the gating.
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
      const key = `${opts.quota}/${today()}/${await ipHash(clientIp(req))}`;
      const store = asStore(opts.store);
      const state: QuotaState = (await store.get(key, { type: 'json' })) ?? { count: 0, reset: 0 };
      if (state.count >= opts.limit) {
        return json({ error: 'Daily limit reached for this endpoint. Try again tomorrow.' }, 429);
      }
      await store.setJSON(key, { count: state.count + 1, reset: state.reset });
    } catch (error) {
      console.error('[gate] quota check failed, allowing request:', error);
    }
  }
  return null;
}
