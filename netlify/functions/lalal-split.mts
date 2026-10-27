import type { Config } from '@netlify/functions';
import { json } from '../lib/http.mts';
import { LALAL_BASE, lalalKey, missingKey, relay } from '../lib/lalal.mts';
import { gate } from '../lib/gate.mts';

export async function splitRequest(key: string, sourceId: string): Promise<Response> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pitch-cruzer:lead-back:mp3:v1:' + sourceId));
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  const idempotencyKey = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return fetch(LALAL_BASE + '/split/stem_separator/', {
    method: 'POST',
    headers: { 'X-License-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_id: sourceId,
      presets: {
        stem: 'vocals',
        multivocal: 'lead_back',
        dereverb_enabled: false,
        encoder_format: 'mp3',
        extraction_level: 'deep_extraction'
      },
      idempotency_key: idempotencyKey
    })
  });
}

export default async (req: Request) => {
  const blocked = await gate(req);
  if (blocked) return blocked;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const key = lalalKey();
  if (!key) return missingKey();

  const input = await req.json().catch(() => null) as { source_id?: string } | null;
  if (typeof input?.source_id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(input.source_id)) return json({ error: 'source_id is required' }, 400);

  // MP3 stems are ~10x smaller than WAV, which keeps downloads fast and under function limits.
  // Fall back to WAV if this account/API version rejects mp3.
  const limited = await gate(req, { quota: 'lalal-split', limit: 10, globalLimit: 20 });
  if (limited) return limited;
  const response = await splitRequest(key, input.source_id);
  return relay(response);
};

export const config: Config = { path: '/api/lalal/split' };
