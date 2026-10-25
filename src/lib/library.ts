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
  repeats?: number;
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
    const request = indexedDB.open(DB_NAME, 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('takes')) db.createObjectStore('takes', { keyPath: 'id' }).createIndex('songId', 'songId');
      if (!db.objectStoreNames.contains('builds')) db.createObjectStore('builds', { keyPath: 'id' }).createIndex('songId', 'songId');
      if (!db.objectStoreNames.contains('preparations')) db.createObjectStore('preparations', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      // Another tab opening a newer version (after an update) must not wait on this one: step aside.
      request.result.onversionchange = () => { request.result.close(); dbPromise = null; };
      resolve(request.result);
    };
    request.onerror = () => { dbPromise = null; reject(request.error); };
    request.onblocked = () => { dbPromise = null; reject(new Error('Close other Pitch Cruzer tabs and try saving again.')); };
  });
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error ?? new Error('Saving was interrupted.'));
    tx.onerror = () => reject(tx.error ?? new Error('Could not save.'));
    request.onerror = () => reject(request.error);
  }));
}

export const saveSong = (song: StoredSong) => run('songs', 'readwrite', s => s.put(song)).then(() => undefined);
/** Background completions may update a song, but cannot resurrect one the user deleted. */
export async function saveExistingSong(song: StoredSong): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('songs', 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
    const store = tx.objectStore('songs'), request = store.get(song.id);
    request.onsuccess = () => { if (request.result) store.put(song); };
  });
}
export const getSong = (id: string) => run<StoredSong | undefined>('songs', 'readonly', s => s.get(id));
export const listSongs = () => run<StoredSong[]>('songs', 'readonly', s => s.getAll())
  .then(songs => songs.sort((a, b) => b.createdAt - a.createdAt));

export async function deleteSong(id: string): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['songs', 'takes', 'builds'], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Could not delete the song.'));
    tx.onerror = () => reject(tx.error);
    tx.objectStore('songs').delete(id);
    for (const name of ['takes', 'builds']) {
      const request = tx.objectStore(name).index('songId').openCursor(IDBKeyRange.only(id));
      request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
    }
  });
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
  version: 1 | 2;
  song: Omit<StoredSong, 'stems'>;
  stems: Array<{ name: keyof StoredSong['stems']; type: string; size: number }>;
  takes: Array<Omit<StoredTake, 'voice'> & { voiceType: string; voiceSize: number }>;
  builds?: Array<Omit<StoredBuildLine, 'voice'> & { voiceType: string; voiceSize: number }>;
}

export async function exportSong(song: StoredSong): Promise<Blob> {
  const takes = (await listTakes(song.id)).filter(take => !take.visit);
  const builds = await listBuildLines(song.id);
  const stemEntries = (Object.entries(song.stems) as Array<[keyof StoredSong['stems'], Blob | undefined]>).filter((entry): entry is [keyof StoredSong['stems'], Blob] => Boolean(entry[1]));
  const { stems: _stems, ...info } = song;
  const header: SongFileHeader = {
    format: 'pitch-cruzer-song',
    version: 2,
    song: info,
    stems: stemEntries.map(([name, blob]) => ({ name, type: blob.type, size: blob.size })),
    takes: takes.map(({ voice, ...take }) => ({ ...take, voiceType: voice.type, voiceSize: voice.size })),
    builds: builds.map(({ voice, ...line }) => ({ ...line, voiceType: voice.type, voiceSize: voice.size }))
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const prefix = new ArrayBuffer(4);
  new DataView(prefix).setUint32(0, json.length, true);
  return new Blob([prefix, json, ...stemEntries.map(([, blob]) => blob), ...takes.map(take => take.voice), ...builds.map(line => line.voice)],
    { type: 'application/octet-stream' });
}

/** Reads a ".pitchcruzer" file and saves the song (and its takes) on this device. */
export async function importSong(file: Blob): Promise<StoredSong> {
  if (file.size < 4 || file.size > 1024 * 1024 * 1024) throw new Error('That song file is empty or too large.');
  const bytes = await file.arrayBuffer();
  const length = new DataView(bytes).getUint32(0, true);
  if (length > 32 * 1024 * 1024 || length > bytes.byteLength - 4) throw new Error('The song file is incomplete.');
  let header: SongFileHeader;
  try { header = JSON.parse(new TextDecoder().decode(bytes.slice(4, 4 + length))); } catch { throw new Error('That isn’t a Pitch Cruzer song file.'); }
  validateHeader(header);
  let offset = 4 + length;
  const next = (size: number, type: string) => {
    if (!Number.isSafeInteger(size) || size <= 0 || offset + size > bytes.byteLength) throw new Error('The song file contains missing or truncated audio.');
    const blob = new Blob([bytes.slice(offset, offset + size)], { type }); offset += size; return blob;
  };
  const stems = {} as StoredSong['stems'];
  for (const stem of header.stems) stems[stem.name] = next(stem.size, stem.type);
  if (!stems.lead) throw new Error('The song file is missing its vocal track.');
  // Import a new copy. A backup must never silently overwrite an existing song or take.
  const song: StoredSong = { ...header.song, id: crypto.randomUUID(), stems };
  const takes = header.takes.map(({ voiceType, voiceSize, ...take }) => ({ ...take, id: crypto.randomUUID(), songId: song.id,
    visit: undefined, voice: next(voiceSize, voiceType) }));
  const builds = (header.builds ?? []).map(({ voiceType, voiceSize, ...line }) => ({ ...line,
    id: buildLineId(song.id, line.start), songId: song.id, voice: next(voiceSize, voiceType) }));
  if (offset !== bytes.byteLength) throw new Error('The song file has unexpected audio data.');
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['songs', 'takes', 'builds'], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Import was interrupted.'));
    tx.onerror = () => reject(tx.error);
    tx.objectStore('songs').put(song);
    takes.forEach(take => tx.objectStore('takes').put(take));
    builds.forEach(line => tx.objectStore('builds').put(line));
  });
  return song;
}

function validateHeader(h: SongFileHeader): void {
  const fail = () => { throw new Error('That song file contains invalid song data.'); };
  const id = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_:.-]{1,200}$/.test(value);
  const text = (value: unknown) => typeof value === 'string';
  const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  if (!h || h.format !== 'pitch-cruzer-song' || ![1, 2].includes(h.version) || !h.song || !Array.isArray(h.stems) || !Array.isArray(h.takes)) fail();
  const a = h.song.analysis;
  if (!id(h.song.id) || !text(h.song.title) || !text(h.song.source) || !num(h.song.createdAt) || !a || !num(a.duration) || a.duration <= 0 || a.duration > 21600) fail();
  const windowOK = (x: { start: number; end: number }) => x && num(x.start) && num(x.end) && x.start >= 0 && x.end >= x.start && x.end <= a.duration + 1;
  if (!Array.isArray(a.notes) || !Array.isArray(a.lines) || !Array.isArray(a.sections)) fail();
  if (a.notes.length > 100000 || a.lines.length > 20000 || a.notes.some(n => !windowOK(n) || !num(n.midi))) fail();
  for (const line of a.lines) {
    if (!id(line.id) || !windowOK(line) || !Array.isArray(line.words)) fail();
    for (const word of line.words) {
      if (!text(word.text) || !windowOK(word) || !Array.isArray(word.syllables)) fail();
      for (const s of word.syllables) if (!text(s.text) || !windowOK(s) || (s.midi !== null && !num(s.midi)) || !Array.isArray(s.notes) || s.notes.some(n => !num(n)) ||
        [s.noteIndex, s.noteEnd].some(n => n !== null && (!Number.isInteger(n) || n < 0 || n >= a.notes.length))) fail();
    }
  }
  if (a.sections.some(s => !id(s.id) || !text(s.label) || !windowOK(s))) fail();
  if (h.stems.some(s => !['lead', 'backing', 'instrumental'].includes(s.name) || !text(s.type)) || new Set(h.stems.map(s => s.name)).size !== h.stems.length) fail();
  for (const take of h.takes) if (!id(take.id) || !text(take.singer) || !text(take.label) || !num(take.score) || !num(take.offsetSeconds) || !num(take.sampleRate) ||
    !Array.isArray(take.segments) || take.segments.some(s => !windowOK(s)) || (take.repeats !== undefined && (!Number.isInteger(take.repeats) || take.repeats < 1 || take.repeats > 99))) fail();
  if (h.builds !== undefined && !Array.isArray(h.builds)) fail();
  for (const line of h.builds ?? []) if (!windowOK(line) || !text(line.text) || !num(line.songTimeAtStart) || !num(line.score)) fail();
}

/** Durable preparation checkpoints: save before starting any paid separation. */
export interface Preparation {
  id: string; sourceId?: string; taskId?: string; title?: string | null; lyrics?: string | null;
  stems?: StoredSong['stems']; songId?: string; createdAt: number;
}
export const getPreparation = (id: string) => run<Preparation | undefined>('preparations', 'readonly', s => s.get(id));
export const savePreparation = (job: Preparation) => run('preparations', 'readwrite', s => s.put(job));
export const deletePreparation = (id: string) => run('preparations', 'readwrite', s => s.delete(id));

/** Retain the paid job identity without duplicating the saved song's audio. */
export async function completePreparation(id: string, songId: string): Promise<void> {
  const [job, song] = await Promise.all([getPreparation(id), getSong(songId)]);
  if (!job || !song) return;
  await savePreparation({ ...job, songId, stems: undefined });
}

export async function preparedStems(job: Preparation): Promise<StoredSong['stems'] | undefined> {
  return job.stems ?? (job.songId ? (await getSong(job.songId))?.stems : undefined);
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
