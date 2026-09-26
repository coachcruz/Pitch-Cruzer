import { buildLines, buildSections, keyAndRange, segmentNotes, type LyricsOptions, type NoteEvent, type PitchTrack, type SongAnalysis } from './analysis';
import { decodeAudio, resampleMono } from './audio';
import * as lalal from './lalal';
import type { StoredSong } from './library';
import type { PitchJobResult } from './pitch.worker';
import type { TimedWord } from './transcribe.worker';

export type SongInput =
  | { kind: 'file'; file: Blob; name: string }
  | { kind: 'link'; url: string }
  | { kind: 'recording'; blob: Blob; name: string };

export type StepId = 'upload' | 'separate' | 'download' | 'pitch' | 'lyrics' | 'sections';
export const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'upload', label: 'Sending the song' },
  { id: 'separate', label: 'Separating the singer from the music (LALAL.AI)' },
  { id: 'download', label: 'Loading vocal + music tracks' },
  { id: 'pitch', label: 'Finding every note the singer hits' },
  { id: 'lyrics', label: 'Writing out the lyrics' },
  { id: 'sections', label: 'Finding intro, verses, choruses…' }
];

export type Progress = (step: StepId, fraction: number, detail?: string) => void;

export interface PreparedSong { song: StoredSong; buffers: SongBuffers }
export interface SongBuffers { lead: AudioBuffer; backing: AudioBuffer | null; instrumental: AudioBuffer | null }

const PITCH_RATE = 11025;

/** `soloVoice`: a single isolated voice (enables subharmonic detection); false for a full mix. */
export function pitchTrackFor(buffer: AudioBuffer, onProgress?: (fraction: number) => void, soloVoice = true): Promise<PitchTrack> {
  return resampleMono(buffer, PITCH_RATE).then(samples => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pitch.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ progress?: number; result?: PitchJobResult }>) => {
      if (event.data.result) { worker.terminate(); resolve(event.data.result); }
      else if (typeof event.data.progress === 'number') onProgress?.(event.data.progress);
    };
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message || 'Pitch analysis failed.')); };
    worker.postMessage({ samples, sampleRate: PITCH_RATE, hopSeconds: 0.02, soloVoice }, [samples.buffer]);
  }));
}

/** Most common song languages; "auto" chooses among these per phrase. */
export const AUTO_LANGUAGES = ['en', 'es', 'pt', 'fr', 'it', 'de', 'nl', 'sv', 'pl', 'ru', 'tr', 'ar', 'hi', 'ja', 'ko', 'zh', 'tl', 'id', 'vi'];

export const LANGUAGE_CHOICES: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'Detect for each line (any language)' },
  { value: 'en,es', label: 'English + Spanish' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'en,pt', label: 'English + Portuguese' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'en,fr', label: 'English + French' },
  { value: 'fr', label: 'French' },
  { value: 'it', label: 'Italian' },
  { value: 'de', label: 'German' },
  { value: 'en,ko', label: 'English + Korean' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'en,tl', label: 'English + Tagalog' }
];

export function lyricsOptionsFrom(language: string, quality: string): LyricsOptions {
  return {
    languages: language === 'auto' || !language ? AUTO_LANGUAGES : language.split(','),
    quality: quality === 'fast' ? 'fast' : 'best'
  };
}

/** Cuts the vocal into clips of one or a few phrases so the language can change line by line. */
function vocalClips(notes: NoteEvent[], duration: number): Array<{ start: number; end: number }> {
  const clips: Array<{ start: number; end: number }> = [];
  for (const note of notes) {
    const last = clips[clips.length - 1];
    if (last && note.start - last.end < 1.2 && note.end - last.start <= 10) last.end = Math.max(last.end, note.end);
    else clips.push({ start: note.start, end: note.end });
  }
  const padded = clips
    .filter(clip => clip.end - clip.start >= 0.4)
    .map(clip => ({ start: Math.max(0, clip.start - 0.3), end: Math.min(duration, clip.end + 0.4) }));
  if (padded.length) return padded;
  const windows = [];
  for (let start = 0; start < duration; start += 25) windows.push({ start, end: Math.min(duration, start + 25) });
  return windows;
}

function transcribe(buffer: AudioBuffer, notes: NoteEvent[], options: LyricsOptions, onProgress: (fraction: number, detail: string) => void): Promise<TimedWord[]> {
  return resampleMono(buffer, 16000).then(audio => new Promise((resolve, reject) => {
    const clips = vocalClips(notes, buffer.duration).map(clip => ({
      audio: audio.slice(Math.floor(clip.start * 16000), Math.ceil(clip.end * 16000)),
      offset: clip.start
    }));
    const worker = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' });
    const timeout = window.setTimeout(() => { worker.terminate(); reject(new Error('Transcription timed out.')); }, 15 * 60 * 1000);
    const heard = new Set<string>();
    worker.onmessage = (event: MessageEvent<any>) => {
      const data = event.data;
      if (data.words) { window.clearTimeout(timeout); worker.terminate(); resolve(data.words); }
      else if (data.error) { window.clearTimeout(timeout); worker.terminate(); reject(new Error(data.error)); }
      else if (data.stage === 'download') onProgress(data.progress * 0.4, 'Downloading the lyrics model (first time only)…');
      else if (data.stage === 'transcribe') {
        if (data.lang) heard.add(String(data.lang).toUpperCase());
        onProgress(0.4 + data.progress * 0.6, 'Listening line by line' + (heard.size ? ' · heard ' + [...heard].join(' + ') : '') + '…');
      }
    };
    worker.onerror = event => { window.clearTimeout(timeout); worker.terminate(); reject(new Error(event.message || 'Transcription failed.')); };
    worker.postMessage({ clips, languages: options.languages, quality: options.quality }, clips.map(clip => clip.audio.buffer));
  }));
}

/**
 * (Re)writes the lyrics of a song and rebuilds its lines and sections.
 * Returns false (and leaves existing lyrics untouched) if a redo could not hear anything.
 */
export async function transcribeLyrics(lead: AudioBuffer, analysis: SongAnalysis, options: LyricsOptions, progress: Progress): Promise<boolean> {
  let words: TimedWord[] = [];
  const hadLyrics = analysis.lines.some(line => line.words.some(word => word.text !== '♪'));
  progress('lyrics', 0);
  try {
    words = await transcribe(lead, analysis.notes, options, (fraction, detail) => progress('lyrics', fraction, detail));
    analysis.transcript = words.length ? 'ok' : 'none';
    progress('lyrics', 1, words.length ? words.length + ' words' : 'No clear words heard');
  } catch (error) {
    console.warn('Transcription failed', error);
    analysis.transcript = 'failed';
    progress('lyrics', 1, 'Lyrics unavailable — you can paste them in later');
  }
  if (!words.length && hadLyrics) {
    analysis.transcript = 'edited';
    return false;
  }
  analysis.lyricsOptions = options;
  progress('sections', 0.2);
  analysis.lines = buildLines(words, analysis.notes);
  analysis.sections = buildSections(analysis.lines, analysis.notes, analysis.duration, words.length > 0);
  progress('sections', 1, analysis.sections.length + ' sections');
  return words.length > 0;
}

export async function analyzeLead(lead: AudioBuffer, separated: boolean, lyrics: LyricsOptions, progress: Progress): Promise<SongAnalysis> {
  progress('pitch', 0);
  const track = await pitchTrackFor(lead, fraction => progress('pitch', fraction), separated);
  const notes = segmentNotes(track);
  const { key, range } = keyAndRange(notes);
  progress('pitch', 1, notes.length + ' notes found');
  const analysis: SongAnalysis = { duration: lead.duration, key, range, notes, lines: [], sections: [], transcript: 'none', separated };
  await transcribeLyrics(lead, analysis, lyrics, progress);
  return analysis;
}

export async function prepareSong(input: SongInput, useSeparation: boolean, lyrics: LyricsOptions, progress: Progress, signal?: AbortSignal): Promise<PreparedSong> {
  const title = input.kind === 'link' ? titleFromLink(input.url) : input.name.replace(/\.[a-z0-9]{2,5}$/i, '');
  let stems: StoredSong['stems'];

  if (useSeparation) {
    progress('upload', 0);
    const sourceId = input.kind === 'link'
      ? await lalal.importLink(input.url)
      : await lalal.uploadFile(input.kind === 'file' ? input.file : input.blob, input.kind === 'file' ? input.name : input.name, f => progress('upload', f));
    progress('upload', 1);
    if (signal?.aborted) throw new lalal.LalalError('Cancelled.');

    progress('separate', 0);
    const taskId = await lalal.startSplit(sourceId);
    const tracks = await lalal.waitForSplit(taskId, f => progress('separate', f), signal);
    const picked = lalal.pickStems(tracks);
    if (!picked.lead || !picked.instrumental) throw new lalal.LalalError('LALAL did not return a vocal and a music track.');
    progress('separate', 1);

    progress('download', 0);
    let done = 0;
    const fetchOne = async (track?: lalal.LalalTrack) => {
      if (!track) return undefined;
      const blob = await lalal.downloadTrack(track.url);
      done += 1;
      progress('download', done / (picked.backing ? 3 : 2));
      return blob;
    };
    const [lead, instrumental, backing] = await Promise.all([fetchOne(picked.lead), fetchOne(picked.instrumental), fetchOne(picked.backing)]);
    stems = { lead: lead!, instrumental, backing };
  } else {
    if (input.kind === 'link') throw new lalal.LalalError('Links need the LALAL.AI connection. Upload a file instead.');
    stems = { lead: input.kind === 'file' ? input.file : input.blob };
    ['upload', 'separate', 'download'].forEach(step => progress(step as StepId, 1, 'Skipped'));
  }

  const buffers: SongBuffers = {
    lead: await decodeAudio(await stems.lead.arrayBuffer()),
    backing: stems.backing ? await decodeAudio(await stems.backing.arrayBuffer()) : null,
    instrumental: stems.instrumental ? await decodeAudio(await stems.instrumental.arrayBuffer()) : null
  };
  const analysis = await analyzeLead(buffers.lead, useSeparation, lyrics, progress);
  const song: StoredSong = {
    id: crypto.randomUUID(),
    title: title || 'Untitled song',
    source: input.kind === 'link' ? input.url : input.kind === 'recording' ? 'Recorded from a browser tab' : 'Uploaded file',
    createdAt: Date.now(),
    analysis,
    stems
  };
  return { song, buffers };
}

export async function decodeStems(song: StoredSong): Promise<SongBuffers> {
  const decode = async (blob?: Blob) => (blob ? decodeAudio(await blob.arrayBuffer()) : null);
  const [lead, backing, instrumental] = await Promise.all([decode(song.stems.lead), decode(song.stems.backing), decode(song.stems.instrumental)]);
  return { lead: lead!, backing, instrumental };
}

export function titleFromLink(url: string): string {
  try {
    const link = new URL(url);
    const last = decodeURIComponent(link.pathname.split('/').filter(Boolean).pop() ?? '');
    if (/suno/i.test(link.hostname)) return 'Suno song';
    return last.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_]+/g, ' ') || link.hostname;
  } catch {
    return 'Linked song';
  }
}

export type LinkKind = 'suno' | 'direct' | 'youtube' | 'spotify' | 'apple' | 'soundcloud' | 'other' | 'invalid';

export function classifyLink(value: string): LinkKind {
  let link: URL;
  try { link = new URL(value.trim()); } catch { return 'invalid'; }
  const host = link.hostname.replace(/^www\.|^m\.|^music\./, '');
  if (/suno\.(com|ai)$/.test(host)) return 'suno';
  if (/youtube\.com$|youtu\.be$/.test(host)) return 'youtube';
  if (/spotify\.com$/.test(host)) return 'spotify';
  if (/apple\.com$/.test(host)) return 'apple';
  if (/soundcloud\.com$/.test(host)) return 'soundcloud';
  if (/\.(mp3|wav|m4a|aac|flac|ogg|opus|webm|mp4|mov|aiff?)$/i.test(link.pathname)) return 'direct';
  return 'other';
}
