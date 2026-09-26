import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { MAX_CHUNK_BYTES, UPLOAD_STORE, isValidUploadId, json } from '../lib/lalal.mts';

/**
 * Stores one piece of a song file. Netlify functions reject request bodies over
 * ~6 MB, so the browser sends songs in 4 MB chunks that /api/lalal/upload stitches together.
 */
export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const params = new URL(req.url).searchParams;
  const uploadId = params.get('upload');
  const index = Number(params.get('index'));
  if (!isValidUploadId(uploadId) || !Number.isInteger(index) || index < 0 || index > 60) {
    return json({ error: 'Invalid upload chunk parameters' }, 400);
  }

  const bytes = await req.arrayBuffer();
  if (!bytes.byteLength) return json({ error: 'Empty chunk' }, 400);
  if (bytes.byteLength > MAX_CHUNK_BYTES) return json({ error: 'Chunk too large' }, 413);

  await getStore(UPLOAD_STORE).set(uploadId + '/' + index, bytes);
  return json({ ok: true, index, bytes: bytes.byteLength });
};

export const config: Config = { path: '/api/upload/chunk' };
