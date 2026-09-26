import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import {
  MAX_CHUNKS, MAX_UPLOAD_BYTES, UPLOAD_STORE, isValidUploadId, json, lalalKey, missingKey, relay, safeFilename, uploadBytesToLalal
} from '../lib/lalal.mts';

/** Reassembles the chunks stored by /api/upload/chunk and forwards the file to LALAL.AI. */
export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const key = lalalKey();
  if (!key) return missingKey();

  const input = await req.json().catch(() => null) as { upload_id?: string; chunks?: number; filename?: string } | null;
  const chunkCount = Number(input?.chunks);
  if (!isValidUploadId(input?.upload_id) || !Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > MAX_CHUNKS) {
    return json({ error: 'upload_id and chunks are required' }, 400);
  }

  const store = getStore(UPLOAD_STORE);
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (let index = 0; index < chunkCount; index += 1) {
      const part = await store.get(input.upload_id + '/' + index, { type: 'arrayBuffer' });
      if (!part) return json({ error: 'Upload chunk ' + index + ' is missing. Try again.' }, 400);
      parts.push(new Uint8Array(part));
      total += part.byteLength;
      if (total > MAX_UPLOAD_BYTES) return json({ error: 'File is too large' }, 413);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }

    const response = await uploadBytesToLalal(key, bytes, safeFilename(input.filename, 'pitch-cruzer-song.wav'));
    return relay(response);
  } finally {
    await Promise.all(
      Array.from({ length: chunkCount }, (_, index) => store.delete(input!.upload_id + '/' + index).catch(() => undefined))
    );
  }
};

export const config: Config = { path: '/api/lalal/upload' };
