import type { SongAnalysis } from './analysis';

/** Songs and takes are saved on this device (IndexedDB) so a song only has to be separated once. */
export interface StoredSong {
  id: string;
  title: string;
  source: string;
  createdAt: number;
  analysis: SongAnalysis;
  stems: { lead: Blob; backing?: Blob; instrumental?: Blob };
}

export interface StoredTake {
  id: string;
  songId: string;
  singer: string;
  createdAt: number;
  score: number;
  label: string;
  voice: Blob;
  sampleRate: number;
  segments: Array<{ start: number; end: number; turn?: boolean }>;
  offsetSeconds: number;
}

const DB_NAME = 'pitch-cruzer';
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('takes')) db.createObjectStore('takes', { keyPath: 'id' }).createIndex('songId', 'songId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(db => new Promise<T>((resolve, reject) => {
    const request = action(db.transaction(store, mode).objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

export const saveSong = (song: StoredSong) => run('songs', 'readwrite', s => s.put(song)).then(() => undefined);
export const getSong = (id: string) => run<StoredSong | undefined>('songs', 'readonly', s => s.get(id));
export const listSongs = () => run<StoredSong[]>('songs', 'readonly', s => s.getAll())
  .then(songs => songs.sort((a, b) => b.createdAt - a.createdAt));

export async function deleteSong(id: string): Promise<void> {
  const takes = await listTakes(id);
  await Promise.all(takes.map(take => deleteTake(take.id)));
  await run('songs', 'readwrite', s => s.delete(id));
}

export const saveTake = (take: StoredTake) => run('takes', 'readwrite', s => s.put(take)).then(() => undefined);
export const deleteTake = (id: string) => run('takes', 'readwrite', s => s.delete(id)).then(() => undefined);
export const listTakes = (songId: string) => run<StoredTake[]>('takes', 'readonly', s => s.index('songId').getAll(songId))
  .then(takes => takes.sort((a, b) => b.score - a.score));
