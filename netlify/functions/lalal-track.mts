import type { Config } from '@netlify/functions';
import { json } from '../lib/http.mts';

/** Streams a separated track from LALAL.AI's download host (only) when the browser can't fetch it directly. */
export default async (req: Request) => {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const urlValue = new URL(req.url).searchParams.get('url');
  if (!urlValue) return json({ error: 'url is required' }, 400);

  let target: URL;
  try {
    target = new URL(urlValue);
  } catch {
    return json({ error: 'Invalid track URL' }, 400);
  }

  if (target.protocol !== 'https:' || !(target.hostname === 'd.lalal.ai' || target.hostname.endsWith('.lalal.ai'))) {
    return json({ error: 'Track host is not allowed' }, 400);
  }

  const upstream = await fetch(target);
  if (!upstream.ok || !upstream.body) {
    return json({ error: 'Unable to fetch separated track', status: upstream.status }, 502);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
      'cache-control': 'private, max-age=3600'
    }
  });
};

export const config: Config = { path: '/api/lalal/track' };
