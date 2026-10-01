import type { SongAnalysis } from './analysis';
import type { Range } from './player';

/** Songs and takes are saved on this device (IndexedDB) so a song only has to be separated once. */
export interface StoredSong {
  id: string;
  title: string;
  source: string;
  createdAt: number;
  analysis: SongAnalysis;
  stems: { lead: Blob; backing?: Blob; instrumental?: Blob };
  /** A YouTube video id kept as a reference video (listening only — never downloaded or separated). */
  referenceVideoId?: string;
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
  segments: Range[];
  offsetSeconds: number;
  /** A take not saved yet: kept only for this visit (see lib/visit), thrown out once its window is closed. */
  visit?: string;
}

/**
 * Song builder: the take you kept for one line of a song. Keyed by the line's start time (line ids
 * change when the lyrics are redone; the moment in the song doesn't).
 */
export interface StoredBuildLine {
  id: string;
  songId: string;
  start: number;
  end: number;
  text: string;
  score: number;
  /** The recorded voice (mono WAV) and the song moment its first sample belongs to. */
  voice: Blob;
  songTimeAtStart: number;
  createdAt: number;
}

const DB_NAME = 'pitch-cruzer';
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('takes')) db.createObjectStore('takes', { keyPath: 'id' }).createIndex('songId', 'songId');
      if (!db.objectStoreNames.contains('builds')) db.createObjectStore('builds', { keyPath: 'id' }).createIndex('songId', 'songId');
    };
    request.onsuccess = () => {
      // Another tab opening a newer version (after an update) must not wait on this one: step aside.
      request.result.onversionchange = () => { request.result.close(); dbPromise = null; };
      resolve(request.result);
    };
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
  await clearBuild(id);
  await run('songs', 'readwrite', s => s.delete(id));
}

export const saveTake = (take: StoredTake) => run('takes', 'readwrite', s => s.put(take)).then(() => undefined);
export const deleteTake = (id: string) => run('takes', 'readwrite', s => s.delete(id)).then(() => undefined);
export const listTakes = (songId: string) => run<StoredTake[]>('takes', 'readonly', s => s.index('songId').getAll(songId))
  .then(takes => takes.sort((a, b) => b.score - a.score));

/** Throws out the unsaved takes of visits whose window has been closed (run when the app starts). */
export async function forgetClosedVisits(open: Set<string>): Promise<void> {
  const takes = await run<StoredTake[]>('takes', 'readonly', s => s.getAll());
  await Promise.all(takes.filter(take => take.visit && !open.has(take.visit)).map(take => deleteTake(take.id)));
}

// ---------------------------------------------------------------- song files (download / import)
// A ".pitchcruzer" file holds everything about a song — its separated tracks, notes, lyrics, sections
// and saved takes — so it can be kept anywhere and opened again on any device without re-preparing.
// Layout: 4-byte header length, JSON header, then the audio blobs in header order.

interface SongFileHeader {
  format: 'pitch-cruzer-song';
  version: 1;
  song: Omit<StoredSong, 'stems'>;
  stems: Array<{ name: keyof StoredSong['stems']; type: string; size: number }>;
  takes: Array<Omit<StoredTake, 'voice'> & { voiceType: string; voiceSize: number }>;
}

export async function exportSong(song: StoredSong): Promise<Blob> {
  const takes = (await listTakes(song.id).catch(() => [] as StoredTake[])).filter(take => !take.visit);   // saved takes only
  const stemEntries = (Object.entries(song.stems) as Array<[keyof StoredSong['stems'], Blob | undefined]>).filter((entry): entry is [keyof StoredSong['stems'], Blob] => Boolean(entry[1]));
  const { stems: _stems, ...info } = song;
  const header: SongFileHeader = {
    format: 'pitch-cruzer-song',
    version: 1,
    song: info,
    stems: stemEntries.map(([name, blob]) => ({ name, type: blob.type, size: blob.size })),
    takes: takes.map(({ voice, ...take }) => ({ ...take, voiceType: voice.type, voiceSize: voice.size }))
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  return new Blob([new Uint32Array([json.length]), json, ...stemEntries.map(([, blob]) => blob), ...takes.map(take => take.voice)],
    { type: 'application/octet-stream' });
}

/** Reads a ".pitchcruzer" file and saves the song (and its takes) on this device. */
export async function importSong(file: Blob): Promise<StoredSong> {
  const bytes = await file.arrayBuffer();
  const length = new Uint32Array(bytes.slice(0, 4))[0];
  let header: SongFileHeader;
  try { header = JSON.parse(new TextDecoder().decode(bytes.slice(4, 4 + length))); } catch { throw new Error('That isn’t a Pitch Cruzer song file.'); }
  if (header.format !== 'pitch-cruzer-song') throw new Error('That isn’t a Pitch Cruzer song file.');
  let offset = 4 + length;
  const next = (size: number, type: string) => { const blob = new Blob([bytes.slice(offset, offset + size)], { type }); offset += size; return blob; };
  const stems = {} as StoredSong['stems'];
  for (const stem of header.stems) stems[stem.name] = next(stem.size, stem.type);
  if (!stems.lead) throw new Error('The song file is missing its vocal track.');
  const song: StoredSong = { ...header.song, stems };
  await saveSong(song);
  for (const { voiceType, voiceSize, ...take } of header.takes) await saveTake({ ...take, voice: next(voiceSize, voiceType) });
  return song;
}

/** Asks the browser not to clear saved songs when space runs low (no prompt in most browsers). */
export function keepStoragePersistent(): void {
  void navigator.storage?.persist?.().catch(() => false);
}

export const buildLineId = (songId: string, start: number) => songId + ':' + Math.round(start * 100);
export const saveBuildLine = (line: StoredBuildLine) => run('builds', 'readwrite', s => s.put(line)).then(() => undefined);
export const listBuildLines = (songId: string) => run<StoredBuildLine[]>('builds', 'readonly', s => s.index('songId').getAll(songId))
  .then(lines => lines.sort((a, b) => a.start - b.start));
export async function clearBuild(songId: string): Promise<void> {
  const lines = await listBuildLines(songId);
  await Promise.all(lines.map(line => run('builds', 'readwrite', s => s.delete(line.id))));
}
