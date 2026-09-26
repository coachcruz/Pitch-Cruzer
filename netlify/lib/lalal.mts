declare const Netlify: { env: { get(name: string): string | undefined } };

export const LALAL_BASE = 'https://www.lalal.ai/api/v1';
/** Browser → function uploads are split into chunks below Netlify's 6 MB request limit. */
export const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
export const UPLOAD_STORE = 'pitch-cruzer-uploads';

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function lalalKey(): string | null {
  return Netlify.env.get('LALAL_API_KEY') ?? null;
}

export const missingKey = () =>
  json({ error: 'LALAL_API_KEY is not configured', code: 'missing_key' }, 503);

/** Pass LALAL's response straight through to the browser. */
export async function relay(response: Response): Promise<Response> {
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') || 'application/json' }
  });
}

export function safeFilename(name: string | null | undefined, fallback: string): string {
  const cleaned = (name || fallback).replace(/[\r\n"\\/]/g, '_').trim().slice(0, 180);
  return cleaned || fallback;
}

export async function uploadBytesToLalal(key: string, bytes: ArrayBuffer | Uint8Array<ArrayBuffer>, filename: string): Promise<Response> {
  return fetch(LALAL_BASE + '/upload/', {
    method: 'POST',
    headers: {
      'X-License-Key': key,
      'Content-Disposition': 'attachment; filename="' + filename + '"',
      'Content-Type': 'application/octet-stream'
    },
    body: bytes
  });
}

export function isValidUploadId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(value);
}
