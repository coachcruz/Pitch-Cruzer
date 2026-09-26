import type { Config } from '@netlify/functions';
import { MAX_UPLOAD_BYTES, json, lalalKey, missingKey, relay, safeFilename, uploadBytesToLalal } from '../lib/lalal.mts';

/**
 * Imports a song from a link and sends it straight to LALAL.AI (server to server, so no size limit
 * from the browser). Supports Suno song pages and direct audio/video file URLs.
 * Streaming services (YouTube, Spotify, Apple Music) are DRM-protected or prohibit downloading, so the
 * app records those from a browser tab instead.
 */
const SUNO_ID = /suno\.(?:com|ai)\/(?:song|s|embed)\/([0-9a-f-]{36})/i;

function resolveAudioUrl(link: URL): { url: string; filename: string } | { error: string } {
  const suno = link.href.match(SUNO_ID);
  if (suno) return { url: 'https://cdn1.suno.ai/' + suno[1] + '.mp3', filename: 'suno-' + suno[1] + '.mp3' };
  if (/(^|\.)suno\.(com|ai)$/i.test(link.hostname) && !/cdn\d*\.suno\.ai$/i.test(link.hostname)) {
    return { error: 'Open the Suno song page and copy its share link (it looks like suno.com/song/…).' };
  }
  const last = link.pathname.split('/').pop() || 'linked-song';
  return { url: link.href, filename: last };
}

function isPrivateHost(hostname: string): boolean {
  return hostname === 'localhost' ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname.endsWith('.internal') || hostname.endsWith('.local') || hostname.includes(':');
}

/** Fetches a public URL, re-checking every redirect so a link can't bounce the server to a private address. */
async function fetchPublic(url: string, hops = 5): Promise<Response | null> {
  let current = new URL(url);
  for (let hop = 0; hop <= hops; hop += 1) {
    if ((current.protocol !== 'https:' && current.protocol !== 'http:') || isPrivateHost(current.hostname)) return null;
    const response = await fetch(current, { redirect: 'manual' }).catch(() => null);
    if (!response) return null;
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) { current = new URL(location, current); continue; }
    return response;
  }
  return null;
}

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const key = lalalKey();
  if (!key) return missingKey();

  const input = await req.json().catch(() => null) as { url?: string } | null;
  let link: URL;
  try {
    link = new URL(String(input?.url ?? ''));
  } catch {
    return json({ error: 'That does not look like a link.' }, 400);
  }
  if (link.protocol !== 'https:' && link.protocol !== 'http:') return json({ error: 'Only web links are supported.' }, 400);
  if (isPrivateHost(link.hostname)) return json({ error: 'That link is not reachable.' }, 400);

  const resolved = resolveAudioUrl(link);
  if ('error' in resolved) return json({ error: resolved.error }, 400);

  const upstream = await fetchPublic(resolved.url);
  if (!upstream || !upstream.ok) {
    return json({ error: 'Could not download audio from that link (status ' + (upstream?.status ?? 'network error') + ').' }, 502);
  }
  const type = upstream.headers.get('content-type') || '';
  if (type.includes('text/html')) {
    return json({ error: 'That link is a web page, not an audio file. Use “Record a browser tab” for this site.' }, 415);
  }
  const declared = Number(upstream.headers.get('content-length') || 0);
  if (declared > MAX_UPLOAD_BYTES) return json({ error: 'That file is too large.' }, 413);

  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength < 1024) return json({ error: 'The link returned no audio.' }, 502);

  const response = await uploadBytesToLalal(key, bytes, safeFilename(decodeURIComponent(resolved.filename), 'linked-song.mp3'));
  return relay(response);
};

export const config: Config = { path: '/api/import-link' };
