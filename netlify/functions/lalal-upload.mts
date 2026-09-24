import type { Config } from '@netlify/functions';
declare const Netlify: { env: { get(name: string): string | undefined } };

function apiKey(): string | null {
  return Netlify.env.get('LALAL_API_KEY') ?? null;
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const key = apiKey();
  if (!key) return json({ error: 'LALAL_API_KEY is not configured' }, 503);

  const filename = (req.headers.get('x-file-name') || 'pitch-cruzer-reference.webm')
    .replace(/[\r\n"]/g, '_')
    .slice(0, 180);
  const bytes = await req.arrayBuffer();
  if (!bytes.byteLength) return json({ error: 'No audio data received' }, 400);

  const response = await fetch('https://www.lalal.ai/api/v1/upload/', {
    method: 'POST',
    headers: {
      'X-License-Key': key,
      'Content-Disposition': 'attachment; filename="' + filename + '"',
      'Content-Type': 'application/octet-stream'
    },
    body: bytes
  });
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') || 'application/json' }
  });
};

export const config: Config = { path: '/api/lalal/upload' };
