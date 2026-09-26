/** Browser-side client for the Netlify functions that talk to LALAL.AI. */
const CHUNK_BYTES = 4 * 1024 * 1024;

export class LalalError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new LalalError('Could not reach the Pitch Cruzer server. Check your connection.');
  }
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 200) }; }
  if (!response.ok) {
    if (response.status === 404 && url.startsWith('/api/')) {
      throw new LalalError('The server functions are not running. Deploy to Netlify or use `netlify dev`.', 'no_server');
    }
    const detail = typeof data?.detail === 'string' ? data.detail : Array.isArray(data?.detail) ? data.detail[0]?.msg : null;
    throw new LalalError(data?.error || detail || 'Request failed (' + response.status + ')', data?.code);
  }
  return data as T;
}

export async function minutesLeft(): Promise<number | null> {
  const data = await requestJson<{ minutes_left?: number }>('/api/lalal/minutes', { method: 'POST' });
  return typeof data.minutes_left === 'number' ? data.minutes_left : null;
}

export async function uploadFile(file: Blob, filename: string, onProgress: (fraction: number) => void): Promise<string> {
  const uploadId = crypto.randomUUID();
  const chunks = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));
  if (chunks > 50) throw new LalalError('That file is too large (limit about 200 MB).');
  for (let index = 0; index < chunks; index += 1) {
    const body = file.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
    await requestJson('/api/upload/chunk?upload=' + uploadId + '&index=' + index, { method: 'POST', body });
    onProgress((index + 1) / chunks);
  }
  const data = await requestJson<{ id?: string }>('/api/lalal/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_id: uploadId, chunks, filename })
  });
  if (!data.id) throw new LalalError('LALAL did not accept the upload.');
  return data.id;
}

export async function importLink(url: string): Promise<string> {
  const data = await requestJson<{ id?: string }>('/api/import-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  if (!data.id) throw new LalalError('LALAL did not accept the linked file.');
  return data.id;
}

export async function startSplit(sourceId: string): Promise<string> {
  const data = await requestJson<{ task_id?: string }>('/api/lalal/split', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_id: sourceId })
  });
  if (!data.task_id) throw new LalalError('LALAL did not start the separation.');
  return data.task_id;
}

export interface LalalTrack { label: string; type?: string; url: string }

export async function waitForSplit(taskId: string, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<LalalTrack[]> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (signal?.aborted) throw new LalalError('Cancelled.');
    const data = await requestJson<{ result?: Record<string, any> }>('/api/lalal/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId })
    });
    const item = data.result?.[taskId];
    if (!item) throw new LalalError('LALAL returned no status for this song.');
    if (item.status === 'success') return item.result?.tracks ?? [];
    if (['error', 'server_error', 'cancelled'].includes(item.status)) {
      const detail = typeof item.error === 'string' ? item.error : item.error?.detail;
      throw new LalalError(detail || 'LALAL could not separate this song.');
    }
    onProgress(Math.min(0.99, (item.progress ?? 0) / 100));
    await new Promise(resolve => window.setTimeout(resolve, 2500));
  }
  throw new LalalError('Separation is taking unusually long. Try again later.');
}

/** Stems download straight from LALAL's CDN when allowed, otherwise through our proxy. */
export async function downloadTrack(url: string): Promise<Blob> {
  try {
    const direct = await fetch(url, { mode: 'cors' });
    if (direct.ok) return await direct.blob();
  } catch { /* CORS blocked: fall through to the proxy */ }
  const proxied = await fetch('/api/lalal/track?url=' + encodeURIComponent(url));
  if (!proxied.ok) throw new LalalError('Could not download a separated track.');
  return proxied.blob();
}

export function pickStems(tracks: LalalTrack[]): { lead?: LalalTrack; backing?: LalalTrack; instrumental?: LalalTrack } {
  const find = (...labels: string[]) => tracks.find(track => labels.includes(track.label));
  return {
    lead: find('vocals@0', 'vocals', 'lead_vocals'),
    backing: find('vocals@1', 'back_vocals', 'backing_vocals'),
    instrumental: find('no_vocals', 'instrumental', 'back')
  };
}
