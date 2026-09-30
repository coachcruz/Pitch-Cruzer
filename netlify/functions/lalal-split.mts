import type { Config } from '@netlify/functions';
import { json } from '../lib/http.mts';
import { LALAL_BASE, lalalKey, missingKey, relay } from '../lib/lalal.mts';
import { gate } from '../lib/gate.mts';

function splitRequest(key: string, sourceId: string, encoderFormat: string): Promise<Response> {
  return fetch(LALAL_BASE + '/split/stem_separator/', {
    method: 'POST',
    headers: { 'X-License-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_id: sourceId,
      presets: {
        stem: 'vocals',
        multivocal: 'lead_back',
        dereverb_enabled: false,
        encoder_format: encoderFormat,
        extraction_level: 'deep_extraction'
      },
      idempotency_key: crypto.randomUUID()
    })
  });
}

export default async (req: Request) => {
  const blocked = await gate(req, { quota: 'lalal-split', limit: 10 });
  if (blocked) return blocked;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const key = lalalKey();
  if (!key) return missingKey();

  const input = await req.json().catch(() => null) as { source_id?: string } | null;
  if (!input?.source_id) return json({ error: 'source_id is required' }, 400);

  // MP3 stems are ~10x smaller than WAV, which keeps downloads fast and under function limits.
  // Fall back to WAV if this account/API version rejects mp3.
  let response = await splitRequest(key, input.source_id, 'mp3');
  if (response.status === 400 || response.status === 422) {
    response = await splitRequest(key, input.source_id, 'wav');
  }
  return relay(response);
};

export const config: Config = { path: '/api/lalal/split' };
