import type { Config } from '@netlify/functions';
import { json } from '../lib/http.mts';
import { LALAL_BASE, lalalKey, missingKey, relay } from '../lib/lalal.mts';
import { gate } from '../lib/gate.mts';

export default async (req: Request) => {
  const blocked = await gate(req);
  if (blocked) return blocked;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const key = lalalKey();
  if (!key) return missingKey();

  const response = await fetch(LALAL_BASE + '/limits/minutes_left/', {
    method: 'POST',
    headers: { 'X-License-Key': key }
  });
  return relay(response);
};

export const config: Config = { path: '/api/lalal/minutes' };
