import type { Config } from '@netlify/functions';
import { json } from '../lib/http.mts';
import { MAX_UPLOAD_BYTES, lalalKey, missingKey, relay, safeFilename, uploadBytesToLalal } from '../lib/lalal.mts';

/**
 * Imports a song from a link and sends it straight to LALAL.AI (server to server, so no size limit
 * from the browser). Supports Suno song pages and direct audio/video file URLs.
 * Streaming services (YouTube, Spotify, Apple Music) are DRM-protected or prohibit downloading, so the
 * app records those from a browser tab instead.
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SUNO_ID = new RegExp('suno\\.(?:com|ai)/(?:song|s|embed)/(' + UUID + ')', 'i');
const SUNO_HOST = /(^|\.)suno\.(com|ai)$/i;

/** Suno's servers turn away requests that don't look like a browser. */
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://suno.com/'
};

/**
 * Where a Suno song's MP3 can be downloaded from. Share links come as suno.com/song/<id> or short
 * suno.com/s/<code>; a short one is opened to find the id (in the redirect or the page), and the page's
 * own audio address is preferred when it has one.
 */
async function sunoAudioUrls(link: URL): Promise<{ urls: string[]; id: string } | { error: string; status?: number }> {
  let id = link.href.match(SUNO_ID)?.[1] ?? null;
  let pageAudio: string | null = null;
  if (!id) {
    const response = await fetchPublic(link.href, BROWSER_HEADERS);
    if (!response || !response.ok) {
      return { error: 'Suno wouldn’t open that short link for us (status ' + (response?.status ?? 'network error') + '). On Suno, open the song and copy the address from the address bar (suno.com/song/…) instead.', status: response?.status };
    }
    id = response.url.match(SUNO_ID)?.[1] ?? null;
    const page = await response.text().catch(() => '');
    id ??= page.match(new RegExp('(?:/song/|cdn\\d*\\.suno\\.ai/)(' + UUID + ')', 'i'))?.[1] ?? null;
    pageAudio = page.match(new RegExp('https://[a-z0-9.]*suno\\.ai/[^"\'\\s\\\\]*' + (id ?? UUID) + '[^"\'\\s\\\\]*\\.mp3', 'i'))?.[0] ?? null;
  }
  if (!id) return { error: 'Couldn’t find the song behind that Suno link. Open the song on Suno, press Share → Copy link, and paste that.' };
  const urls = [pageAudio, 'https://cdn1.suno.ai/' + id + '.mp3', 'https://audiopipe.suno.ai/?item_id=' + id, 'https://cdn2.suno.ai/' + id + '.mp3']
    .filter((url, i, all): url is string => Boolean(url) && all.indexOf(url) === i);
  return { urls, id };
}

/**
 * A Suno song's title and lyrics — Suno keeps the lyrics the song was made from. Tried from Suno's
 * public clip data first, then from the song page. Section tags ([Verse], [Chorus]…) are kept.
 */
async function sunoDetails(id: string): Promise<{ title: string | null; lyrics: string | null }> {
  // Keep [Verse]/[Chorus] tags: the app uses them to name the song's sections.
  const clean = (text: string) => text.split(/\r?\n/).map(line => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  for (const url of ['https://studio-api.prod.suno.com/api/clip/' + id, 'https://suno.com/api/clip/' + id]) {
    const response = await fetch(url, { headers: BROWSER_HEADERS }).catch(() => null);
    if (!response?.ok) continue;
    const clip = await response.json().catch(() => null) as { title?: string; metadata?: { prompt?: string } } | null;
    if (clip?.metadata?.prompt) return { title: clip.title ?? null, lyrics: clean(clip.metadata.prompt) };
  }
  const page = await fetch('https://suno.com/song/' + id, { headers: BROWSER_HEADERS }).then(r => (r.ok ? r.text() : ''), () => '');
  // The page embeds the song's data as JSON, partly inside Next.js "flight" strings — decode those too.
  const flight = [...page.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)]
    .map(match => { try { return JSON.parse(match[1]) as string; } catch { return ''; } }).join('');
  const raw = (page + '\n' + flight).match(/"prompt":"((?:[^"\\]|\\.)*)"/)?.[1];
  let prompt: string | null = null;
  try { prompt = raw ? JSON.parse('"' + raw + '"') as string : null; } catch { prompt = null; }
  const title = page.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? null;
  return { title: title ? title.replace(/\s*[|–-]\s*Suno.*$/i, '').trim() : null, lyrics: prompt ? clean(prompt) : null };
}

function isPrivateHost(hostname: string): boolean {
  return hostname === 'localhost' ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname.endsWith('.internal') || hostname.endsWith('.local') || hostname.includes(':');
}

/** Fetches a public URL, re-checking every redirect so a link can't bounce the server to a private address. */
async function fetchPublic(url: string, headers: Record<string, string> = {}, hops = 5): Promise<Response | null> {
  let current = new URL(url);
  for (let hop = 0; hop <= hops; hop += 1) {
    if ((current.protocol !== 'https:' && current.protocol !== 'http:') || isPrivateHost(current.hostname)) return null;
    const response = await fetch(current, { redirect: 'manual', headers }).catch(() => null);
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

  // Where to download from: a Suno song's MP3 (several addresses), or the link itself.
  let urls: string[];
  let filename: string;
  // The song's own title and lyrics, when the source has them (Suno does).
  let details: { title: string | null; lyrics: string | null } = { title: null, lyrics: null };
  const suno = SUNO_HOST.test(link.hostname) && !/^cdn\d*\./i.test(link.hostname);
  if (suno) {
    const found = await sunoAudioUrls(link);
    if ('error' in found) return json({ error: found.error, step: 'suno-page', status: found.status ?? null }, 502);
    urls = found.urls;
    filename = 'suno-' + found.id + '.mp3';
    details = await sunoDetails(found.id).catch(() => ({ title: null, lyrics: null }));
  } else {
    urls = [link.href];
    filename = link.pathname.split('/').pop() || 'linked-song';
  }

  let bytes: ArrayBuffer | null = null;
  let lastStatus: number | string = 'network error';
  for (const url of urls) {
    const upstream = await fetchPublic(url, suno ? BROWSER_HEADERS : {});
    if (!upstream || !upstream.ok) { lastStatus = upstream?.status ?? 'network error'; continue; }
    const type = upstream.headers.get('content-type') || '';
    if (type.includes('text/html')) {
      if (suno) { lastStatus = 'web page'; continue; }
      return json({ error: 'That link is a web page, not an audio file. Download the song and upload the file instead.' }, 415);
    }
    const declared = Number(upstream.headers.get('content-length') || 0);
    if (declared > MAX_UPLOAD_BYTES) return json({ error: 'That file is too large.' }, 413);
    const body = await upstream.arrayBuffer();
    if (body.byteLength >= 1024) { bytes = body; break; }
    lastStatus = 'empty file';
  }
  if (!bytes) {
    // Some hosts (Suno) block downloads from servers but not from a person's browser: tell the app
    // where the audio is so the browser can fetch it itself.
    return json({
      error: (suno ? 'Suno' : 'That site') + ' blocked the download from our server (' + lastStatus + ').',
      code: 'source_blocked', step: 'download', audioUrls: urls, ...details
    }, 502);
  }

  const response = await uploadBytesToLalal(key, bytes, safeFilename(decodeURIComponent(filename), 'linked-song.mp3'));
  if (!response.ok) return relay(response);
  const uploaded = await response.json().catch(() => ({})) as Record<string, unknown>;
  return json({ ...uploaded, ...details });
};

export const config: Config = { path: '/api/import-link' };
