import { alignSyncedLyrics, applyTypedLyrics, buildLines, parseSyncedLyrics, type SyncedLine, buildSections, buildWord, keyAndRange, NOTES_VERSION, segmentNotes, type LyricsOptions, type NoteEvent, type PitchTrack, type SongAnalysis } from './analysis';
import { decodeAudio, resampleMono } from './audio';
import { formatTime } from './music';
import { compressForUpload } from './mp3';
import * as lalal from './lalal';
import { diag } from './diag';
import type { StoredSong } from './library';
import type { PitchJobResult } from './pitch.worker';
import { serverTranscriptionAvailable, transcribeOnServer } from './serverTranscribe';
import type { TimedWord } from './transcribe.worker';

export type SongInput =
  | { kind: 'file'; file: Blob; name: string }
  | { kind: 'link'; url: string }
  | { kind: 'recording'; blob: Blob; name: string };

/** Where the words come from: pasted by the user, looked up online, or (fallback) speech recognition. */
export interface LyricsSource { pasted?: string; lookup?: string }

/** Finds the real lyrics in LRCLIB (via /api/lyrics), preferring the result whose length matches. */
export async function findLyricsOnline(query: string, duration?: number): Promise<{ text: string; synced: SyncedLine[] | null; label: string } | null> {
  try {
    const response = await fetch('/api/lyrics?q=' + encodeURIComponent(query), { signal: AbortSignal.timeout(15000) });
    if (!response.ok) { diag('Lyrics lookup → HTTP ' + response.status, 'warn'); return null; }
    const results = (await response.json()) as Array<{ title: string; artist: string; duration?: number; lyrics: string; synced?: string | null }>;
    if (!results.length) { diag('Lyrics lookup: nothing found for “' + query + '”', 'warn'); return null; }
    const best = [...results].sort((a, b) => (duration ? Math.abs((a.duration ?? 0) - duration) - Math.abs((b.duration ?? 0) - duration) : 0))[0];
    diag('Lyrics found online: ' + best.title + ' — ' + best.artist, 'ok');
    return { text: best.lyrics, synced: best.synced ? parseSyncedLyrics(best.synced) : null, label: best.title + ' — ' + best.artist };
  } catch {
    diag('Lyrics lookup failed', 'warn');
    return null;
  }
}

export type StepId = 'upload' | 'separate' | 'download' | 'pitch' | 'lyrics' | 'sections';
/** Preparation steps. `background` steps run after the song opens (while you practice). */
export const STEPS: Array<{ id: StepId; label: string; background?: boolean }> = [
  { id: 'upload', label: 'Sending the song' },
  { id: 'separate', label: 'Separating the singer from the music (LALAL.AI)' },
  { id: 'download', label: 'Loading vocal + music tracks' },
  { id: 'pitch', label: 'Finding every note the singer hits' },
  { id: 'lyrics', label: 'Writing out the lyrics', background: true },
  { id: 'sections', label: 'Finding intro, verses, choruses…', background: true }
];

export type Progress = (step: StepId, fraction: number, detail?: string) => void;

export interface PreparedSong { song: StoredSong; buffers: SongBuffers; lyricsJob: () => Promise<void> }
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
    quality: quality === 'best' ? 'best' : 'fast'
  };
}

/**
 * Groups the vocal into windows of up to ~25 s of sung phrases. Whisper processes 30-second windows
 * whatever the clip length, so bigger windows mean far fewer model passes (much faster). Each window
 * keeps its phrase boundaries so a bilingual window can still be split phrase by phrase.
 */
function vocalClips(notes: NoteEvent[], duration: number): Array<{ start: number; end: number; phrases: Array<{ start: number; end: number }> }> {
  const phrases: Array<{ start: number; end: number }> = [];
  for (const note of notes) {
    const last = phrases[phrases.length - 1];
    if (last && note.start - last.end < 0.7 && note.end - last.start <= 12) last.end = Math.max(last.end, note.end);
    else phrases.push({ start: note.start, end: note.end });
  }
  const sung = phrases.filter(phrase => phrase.end - phrase.start >= 0.4);
  const clips: Array<{ start: number; end: number; phrases: Array<{ start: number; end: number }> }> = [];
  for (const phrase of sung) {
    const last = clips[clips.length - 1];
    if (last && phrase.end + 0.4 - last.start <= 25 && phrase.start - last.end < 6) {
      last.end = phrase.end;
      last.phrases.push(phrase);
    } else clips.push({ start: phrase.start, end: phrase.end, phrases: [phrase] });
  }
  const padded = clips.map(clip => {
    const start = Math.max(0, clip.start - 0.3);
    return {
      start,
      end: Math.min(duration, clip.end + 0.4),
      phrases: clip.phrases.map(phrase => ({ start: Math.max(0, phrase.start - 0.2 - start), end: phrase.end + 0.3 - start }))
    };
  });
  if (padded.length) return padded;
  const windows = [];
  for (let start = 0; start < duration; start += 25) windows.push({ start, end: Math.min(duration, start + 25), phrases: [{ start: 0, end: Math.min(25, duration - start) }] });
  return windows;
}

/**
 * Words + timing for the lead vocal. The server model (Whisper Large v3 Turbo) is used when it's set
 * up — it's much more accurate on singing; otherwise, or if it fails, the in-browser model runs.
 */
async function transcribe(buffer: AudioBuffer, notes: NoteEvent[], options: LyricsOptions, title: string | undefined, onProgress: (fraction: number, detail: string) => void): Promise<{ words: TimedWord[]; partial: boolean }> {
  if (await serverTranscriptionAvailable()) {
    try {
      diag('Lyrics: using the server model (Whisper Large v3 Turbo)');
      return { words: await transcribeOnServer(buffer, notes, options, title, onProgress), partial: false };
    } catch (error) {
      diag('Server lyrics failed (' + (error instanceof Error ? error.message : String(error)) + ') — using the in-browser model', 'warn');
    }
  } else diag('Lyrics: server model not set up (GROQ_API_KEY) — using the in-browser model', 'warn');
  return transcribeInBrowser(buffer, notes, options, onProgress);
}

function transcribeInBrowser(buffer: AudioBuffer, notes: NoteEvent[], options: LyricsOptions, onProgress: (fraction: number, detail: string) => void): Promise<{ words: TimedWord[]; partial: boolean }> {
  return resampleMono(buffer, 16000).then(audio => new Promise((resolve, reject) => {
    const clips = vocalClips(notes, buffer.duration).map(clip => ({
      audio: audio.slice(Math.floor(clip.start * 16000), Math.ceil(clip.end * 16000)),
      offset: clip.start,
      phrases: clip.phrases
    }));
    const worker = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' });
    const words: TimedWord[] = [];
    const heard = new Set<string>();
    let modelNoted = false;
    let clipsDone = 0;
    let transcribeStarted = 0;
    let settled = false;
    // Generous limit that grows with song length; whatever was transcribed before it is kept.
    const limitMs = Math.max(15, (buffer.duration / 60) * 8) * 60 * 1000;
    const finish = (partial: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      worker.terminate();
      resolve({ words: words.sort((a, b) => a.start - b.start), partial });
    };
    const timeout = window.setTimeout(() => {
      diag('Lyrics: time limit reached after ' + clipsDone + '/' + clips.length + ' windows — keeping what was heard', 'warn');
      if (words.length) finish(true);
      else { settled = true; worker.terminate(); reject(new Error('Transcription took too long. Try “Faster” accuracy, or paste the lyrics.')); }
    }, limitMs);
    diag('Lyrics: ' + clips.length + ' windows of singing to transcribe (' + options.quality + ' model, languages: ' + options.languages.join('+') + ')');
    worker.onmessage = (event: MessageEvent<any>) => {
      const data = event.data;
      if (data.done) finish(false);
      else if (data.error) {
        if (settled) return;
        diag('Lyrics failed: ' + data.error, 'error');
        if (words.length) finish(true);
        else { settled = true; window.clearTimeout(timeout); worker.terminate(); reject(new Error(data.error)); }
      } else if (data.stage === 'restart') {
        clipsDone = 0;
        words.length = 0;
      } else if (data.stage === 'note') {
        diag('Lyrics: ' + data.text, 'warn');
      } else if (data.stage === 'download') {
        if (!modelNoted) { modelNoted = true; diag('Downloading lyrics model ' + (data.model ?? '') + ' (first time only)'); }
        onProgress(data.progress * 0.4, 'Downloading the lyrics model (first time only)… ' + Math.round(data.progress * 100) + '%');
      } else if (data.stage === 'model') {
        diag('Lyrics model ready: ' + data.model + ' · ' + data.threads + '-threaded');
        transcribeStarted = performance.now();
        onProgress(0.4, 'Listening to the singer…');
      } else if (data.stage === 'transcribe') {
        (data.langs as string[] | undefined)?.forEach(lang => heard.add(lang.toUpperCase()));
        words.push(...(data.words ?? []));
        clipsDone += 1;
        const elapsed = (performance.now() - (transcribeStarted || performance.now())) / 1000;
        const left = clipsDone ? (elapsed / clipsDone) * (clips.length - clipsDone) : 0;
        diag('Lyrics: window ' + clipsDone + '/' + clips.length + ' in ' + elapsed.toFixed(0) + 's total' + (data.mixed ? ' (mixed languages — line by line)' : '') + ' · ' + (data.words?.length ?? 0) + ' words');
        onProgress(0.4 + data.progress * 0.6, 'Listening · ' + clipsDone + '/' + clips.length + (heard.size ? ' · heard ' + [...heard].join(' + ') : '') + (left > 5 ? ' · about ' + formatTime(left) + ' left' : ''));
      }
    };
    worker.onerror = event => {
      if (settled) return;
      diag('Lyrics worker crashed: ' + (event.message || 'unknown error'), 'error');
      if (words.length) finish(true);
      else { settled = true; window.clearTimeout(timeout); worker.terminate(); reject(new Error(event.message || 'Transcription failed.')); }
    };
    worker.postMessage({ clips, languages: options.languages, quality: options.quality }, clips.map(clip => clip.audio.buffer));
  }));
}

/**
 * (Re)writes the lyrics of a song and rebuilds its lines and sections.
 * Returns false (and leaves existing lyrics untouched) if a redo could not hear anything.
 */
export async function transcribeLyrics(lead: AudioBuffer, analysis: SongAnalysis, options: LyricsOptions, progress: Progress, title?: string): Promise<boolean> {
  let words: TimedWord[] = [];
  const hadLyrics = analysis.lines.some(line => line.words.some(word => word.text !== '♪'));
  progress('lyrics', 0);
  try {
    const result = await transcribe(lead, analysis.notes, options, title, (fraction, detail) => progress('lyrics', fraction, detail));
    words = result.words;
    analysis.transcript = words.length ? 'ok' : 'none';
    progress('lyrics', 1, words.length ? words.length + ' words' + (result.partial ? ' (partial — use Redo lyrics or Fix lyrics for the rest)' : '') : 'No clear words heard');
  } catch (error) {
    console.warn('Transcription failed', error);
    diag('Lyrics failed: ' + (error instanceof Error ? error.message : String(error)), 'error');
    analysis.transcript = 'failed';
    progress('lyrics', 1, 'Lyrics unavailable — you can paste them in later');
  }
  analysis.lyricsPending = false;
  if (!words.length && hadLyrics) {
    analysis.transcript = 'edited';
    return false;
  }
  analysis.lyricsOptions = options;
  progress('sections', 0.2);
  analysis.heard = words.length ? words : undefined;
  analysis.lines = buildLines(words, analysis.notes);
  analysis.sections = buildSections(analysis.lines, analysis.notes, analysis.duration, words.length > 0);
  progress('sections', 1, analysis.sections.length + ' sections');
  return words.length > 0;
}

/**
 * Finds the notes (seconds), then returns straight away so practice can start; the lyrics are written
 * in the background by `lyricsJob`. Pasted or looked-up lyrics supply the exact words, and speech
 * recognition only supplies their timing.
 */
export async function analyzeLead(lead: AudioBuffer, separated: boolean, lyrics: LyricsOptions, progress: Progress, source: LyricsSource = {}, title?: string): Promise<{ analysis: SongAnalysis; lyricsJob: () => Promise<void> }> {
  progress('pitch', 0);
  const track = await pitchTrackFor(lead, fraction => progress('pitch', fraction), separated);
  const notes = segmentNotes(track);
  const { key, range } = keyAndRange(notes);
  progress('pitch', 1, notes.length + ' notes found');
  const lines = buildLines([], notes);
  const analysis: SongAnalysis = {
    duration: lead.duration, key, range, notes, lines, sections: buildSections(lines, notes, lead.duration, false),
    transcript: 'none', separated, notesVersion: NOTES_VERSION, lyricsPending: true
  };
  const lyricsJob = async () => {
    const pasted = source.pasted?.trim() || '';
    const found = !pasted && source.lookup ? await findLyricsOnline(source.lookup, lead.duration) : null;
    // Best case: timed lyrics from the lyrics database, lined up with the singer — no listening needed.
    if (found?.synced) {
      progress('lyrics', 0.5, 'Lining up the lyrics with the singer…');
      const aligned = alignSyncedLyrics(analysis, found.synced);
      if (aligned) {
        analysis.lines = aligned.lines;
        analysis.transcript = 'edited';
        analysis.lyricsPending = false;
        analysis.sections = buildSections(analysis.lines, notes, lead.duration, true);
        diag('Lyrics: timed lyrics from ' + found.label + ' (shifted ' + aligned.offset.toFixed(1) + 's, fit ' + Math.round(aligned.fit * 100) + '%)', 'ok');
        progress('lyrics', 1, 'Timed lyrics found');
        return;
      }
      diag('Lyrics: the timed lyrics didn’t fit this recording (another version?) — listening instead', 'warn');
    }
    const words = pasted || found?.text || '';
    // Speech recognition gives timing (and the words, if we have none of our own).
    await transcribeLyrics(lead, analysis, lyrics, progress, title);
    if (words) {
      analysis.lines = applyTypedLyrics(analysis, words);
      analysis.transcript = 'edited';
      analysis.sections = buildSections(analysis.lines, notes, lead.duration, true);
      diag('Lyrics: using ' + (source.pasted?.trim() ? 'your pasted lyrics' : 'lyrics found online') + ', timed to the singer', 'ok');
    }
  };
  return { analysis, lyricsJob };
}

/**
 * Re-detects the notes of an already prepared song (after note detection improves), keeping its
 * lyrics, timing and sections. Runs locally from the saved vocal — no LALAL.AI minutes.
 */
export async function recheckNotes(lead: AudioBuffer, analysis: SongAnalysis): Promise<void> {
  const track = await pitchTrackFor(lead, undefined, analysis.separated);
  const notes = segmentNotes(track);
  const { key, range } = keyAndRange(notes);
  analysis.notes = notes;
  analysis.key = key;
  analysis.range = range;
  analysis.lines = analysis.lines.map(line => ({
    ...line,
    words: line.words.map(word => word.text === '♪' || word.aside ? word : buildWord(word.text, word.start, word.end, notes, word.lang))
  }));
  analysis.notesVersion = NOTES_VERSION;
}

export async function prepareSong(input: SongInput, useSeparation: boolean, lyrics: LyricsOptions, progress: Progress, signal?: AbortSignal, lyricsSource: LyricsSource = {}): Promise<PreparedSong> {
  let source = lyricsSource;
  let title = input.kind === 'link' ? titleFromLink(input.url) : input.name.replace(/\.[a-z0-9]{2,5}$/i, '');
  let stems: StoredSong['stems'];

  if (useSeparation) {
    progress('upload', 0);
    let sourceId: string;
    if (input.kind === 'link') {
      const imported = await importLinkOrFetchHere(input.url, progress);
      sourceId = imported.id;
      // A Suno song arrives with its own title and lyrics: use them like pasted lyrics.
      if (imported.title) title = imported.title;
      if (imported.lyrics && !source.pasted?.trim()) {
        source = { pasted: imported.lyrics };
        diag('Lyrics: using the song’s own lyrics from the link (' + imported.lyrics.split('\n').filter(Boolean).length + ' lines)', 'ok');
      }
    }
    else {
      progress('upload', 0, 'Compressing…');
      const packed = await compressForUpload(input.kind === 'file' ? input.file : input.blob, input.name);
      sourceId = await lalal.uploadFile(packed.file, packed.name, f => progress('upload', f, (packed.file.size / 1048576).toFixed(1) + ' MB'));
    }
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
  const { analysis, lyricsJob } = await analyzeLead(buffers.lead, useSeparation, lyrics, progress, source, title);
  const song: StoredSong = {
    id: crypto.randomUUID(),
    title: title || 'Untitled song',
    source: input.kind === 'link' ? input.url : input.kind === 'recording' ? 'Recorded from a browser tab' : 'Uploaded file',
    createdAt: Date.now(),
    analysis,
    stems
  };
  return { song, buffers, lyricsJob };
}

/**
 * Imports a link on the server. Some hosts (Suno) refuse downloads from servers but not from your
 * browser — then the browser downloads the song itself and uploads it like a file.
 */
async function importLinkOrFetchHere(url: string, progress: Progress): Promise<{ id: string } & lalal.LinkDetails> {
  try {
    return await lalal.importLink(url);
  } catch (error) {
    const urls = error instanceof lalal.LalalError && error.code === 'source_blocked' && Array.isArray(error.details.audioUrls)
      ? (error.details.audioUrls as string[]) : [];
    if (!urls.length) throw error;
    diag('The server was blocked from downloading the song — downloading it in this browser instead', 'warn');
    for (const audioUrl of urls) {
      const response = await fetch(audioUrl, { signal: AbortSignal.timeout(60000) }).catch(() => null);
      if (!response?.ok) { diag('Browser download ' + (response ? 'HTTP ' + response.status : 'blocked') + ': ' + audioUrl, 'warn'); continue; }
      const blob = await response.blob();
      if (blob.size < 1024) continue;
      diag('Downloaded the song in this browser (' + (blob.size / 1048576).toFixed(1) + ' MB)', 'ok');
      const id = await lalal.uploadFile(blob, 'linked-song.mp3', f => progress('upload', f, (blob.size / 1048576).toFixed(1) + ' MB'));
      const details = (error as lalal.LalalError).details as lalal.LinkDetails;
      return { id, title: details.title, lyrics: details.lyrics };
    }
    throw new lalal.LalalError((error as Error).message + ' Your browser couldn’t download it either — on Suno use ⋯ → Download → MP3 Audio, then 📁 Upload a file.');
  }
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
