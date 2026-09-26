import type { Config } from '@netlify/functions';
import { json } from '../lib/lalal.mts';

/**
 * Looks up real lyrics in LRCLIB (free, open lyrics database — https://lrclib.net) so songs don't
 * rely on speech recognition, which is unreliable on sung words.
 */
export default async (req: Request) => {
  const query = new URL(req.url).searchParams.get('q')?.trim();
  if (!query || query.length < 2) return json({ error: 'q is required' }, 400);
  const response = await fetch('https://lrclib.net/api/search?q=' + encodeURIComponent(query.slice(0, 200)), {
    headers: { 'User-Agent': 'PitchCruzer (https://pitch-cruzer.netlify.app)' }
  }).catch(() => null);
  if (!response?.ok) return json({ error: 'Lyrics lookup is unavailable right now.' }, 502);
  const results = (await response.json().catch(() => [])) as Array<Record<string, unknown>>;
  return json(results.slice(0, 8).map(item => ({
    title: item.trackName, artist: item.artistName, duration: item.duration,
    lyrics: typeof item.plainLyrics === 'string' && item.plainLyrics.trim()
      ? item.plainLyrics
      : typeof item.syncedLyrics === 'string' ? item.syncedLyrics.replace(/^\[[^\]]*\]\s?/gm, '') : null
  })).filter(item => item.lyrics));
};

export const config: Config = { path: '/api/lyrics' };
