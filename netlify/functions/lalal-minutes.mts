import type { Config } from '@netlify/functions';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const key = Netlify.env.get('LALAL_API_KEY');
  if (!key) return json({ error: 'LALAL_API_KEY is not configured' }, 503);

  const response = await fetch('https://www.lalal.ai/api/v1/limits/minutes_left/', {
    method: 'POST',
    headers: { 'X-License-Key': key }
  });
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') || 'application/json' }
  });
};

export const config: Config = { path: '/api/lalal/minutes' };
