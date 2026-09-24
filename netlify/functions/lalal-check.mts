import type { Config } from '@netlify/functions';
declare const Netlify: { env: { get(name: string): string | undefined } };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const key = Netlify.env.get('LALAL_API_KEY');
  if (!key) return json({ error: 'LALAL_API_KEY is not configured' }, 503);

  const input = await req.json().catch(() => null) as { task_id?: string } | null;
  if (!input?.task_id) return json({ error: 'task_id is required' }, 400);

  const response = await fetch('https://www.lalal.ai/api/v1/check/', {
    method: 'POST',
    headers: { 'X-License-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_ids: [input.task_id] })
  });
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') || 'application/json' }
  });
};

export const config: Config = { path: '/api/lalal/check' };
