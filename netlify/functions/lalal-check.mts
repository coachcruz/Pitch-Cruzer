import type { Config } from '@netlify/functions';
import { json } from '../lib/http.mts';
import { LALAL_BASE, lalalKey, missingKey, relay } from '../lib/lalal.mts';

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const key = lalalKey();
  if (!key) return missingKey();

  const input = await req.json().catch(() => null) as { task_id?: string } | null;
  if (!input?.task_id) return json({ error: 'task_id is required' }, 400);

  const response = await fetch(LALAL_BASE + '/check/', {
    method: 'POST',
    headers: { 'X-License-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_ids: [input.task_id] })
  });
  return relay(response);
};

export const config: Config = { path: '/api/lalal/check' };
