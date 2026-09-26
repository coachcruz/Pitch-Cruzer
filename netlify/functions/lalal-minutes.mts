import type { Config } from '@netlify/functions';
import { LALAL_BASE, json, lalalKey, missingKey, relay } from '../lib/lalal.mts';

export default async (req: Request) => {
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
