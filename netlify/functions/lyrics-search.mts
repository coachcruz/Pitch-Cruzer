import type { Config } from '@netlify/functions';
import { json } from '../lib/http.mts';
import { gate } from '../lib/gate.mts';

/**
 * Looks up real lyrics in LRCLIB (free, open lyrics database — https://lrclib.net) so songs don't
 * rely on speech recognition, which is unreliable on sung words. Timed ("synced") lyrics also give
 * each line's start, so a song can be timed without transcribing it at all.
 */
export default async (req: Request) => {
  const blocked = await gate(req, { quota: 'lyrics-search', limit: 60 });
  if (blocked) return blocked;
  const query = new URL(req.url).searchParams.get('q')?.trim();
  if (!query || query.length < 2) return json({ error: 'q is required' }, 400);
  const response = await fetch('https://lrclib.net/api/search?q=' + encodeURIComponent(query.slice(0, 200)), {
    headers: { 'User-Agent': 'PitchCruzer (https://pitch-cruzer.netlify.app)' }
  }).catch(() => null);
  if (!response?.ok) return json({ error: 'Lyrics lookup is unavailable right now.' }, 502);
  const results = (await response.json().catch(() => [])) as Array<Record<string, unknown>>;
  return json(results.slice(0, 8).map(item => {
    const synced = typeof item.syncedLyrics === 'string' && item.syncedLyrics.trim() ? item.syncedLyrics : null;
    return {
      title: item.trackName, artist: item.artistName, duration: item.duration,
      lyrics: typeof item.plainLyrics === 'string' && item.plainLyrics.trim() ? item.plainLyrics
        : synced ? synced.replace(/^\[[^\]]*\]\s?/gm, '') : null,
      // "[mm:ss.xx] line" — when each line starts in the original recording.
      synced
    };
  }).filter(item => item.lyrics));
};

export const config: Config = { path: '/api/lyrics' };
