import type { Config } from '@netlify/functions';
import { env, json } from '../lib/http.mts';
import { gate } from '../lib/gate.mts';

/**
 * Song search on YouTube (YouTube Data API v3) so a song can be found, played and recorded without
 * leaving the app. Needs YOUTUBE_API_KEY (free: about 100 searches a day). Without it the app opens
 * YouTube's own search in a new tab instead.
 *
 * GET ?q=song name  ← [{ id, title, channel, thumbnail }]   ·   GET (no q) ← { available }
 */
const ENTITIES: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' };
const decode = (value: string) => value.replace(/&(amp|quot|#39|lt|gt);/g, match => ENTITIES[match] ?? match);

interface SearchItem {
  id?: { videoId?: string };
  snippet?: { title?: string; channelTitle?: string; thumbnails?: { medium?: { url?: string }; default?: { url?: string } } };
}

export default async (req: Request) => {
  const blocked = await gate(req, { quota: 'youtube-search', limit: 30 });
  if (blocked) return blocked;
  const key = env('YOUTUBE_API_KEY');
  const query = new URL(req.url).searchParams.get('q')?.trim();
  if (!query) return json({ available: Boolean(key) });
  if (!key) return json({ error: 'YOUTUBE_API_KEY is not configured', code: 'missing_key' }, 503);

  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.search = new URLSearchParams({
    part: 'snippet', type: 'video', maxResults: '8', videoEmbeddable: 'true', safeSearch: 'none',
    q: query.slice(0, 200), key
  }).toString();
  const response = await fetch(url).catch(() => null);
  if (!response?.ok) return json({ error: 'YouTube search is unavailable right now.', status: response?.status ?? 0 }, 502);
  const body = (await response.json()) as { items?: SearchItem[] };
  return json((body.items ?? [])
    .filter(item => item.id?.videoId)
    .map(item => ({
      id: item.id!.videoId!,
      title: decode(item.snippet?.title ?? ''),
      channel: decode(item.snippet?.channelTitle ?? ''),
      thumbnail: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? ''
    })));
};

export const config: Config = { path: '/api/youtube' };
