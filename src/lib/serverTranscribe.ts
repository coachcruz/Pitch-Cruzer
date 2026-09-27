import type { LyricsOptions, NoteEvent } from './analysis';
import { resampleMono } from './audio';
import { diag } from './diag';
import { encodeMp3 } from './mp3';
import type { TimedWord } from './transcribe.worker';

/**
 * Lyrics from the server model (Whisper Large v3 Turbo via /api/transcribe). It's far more accurate
 * on singing than the small in-browser models. The isolated vocal is sent as small MP3 pieces
 * (16 kHz mono, 48 kbps ≈ 0.35 MB per minute), cut in the silences between phrases.
 */
const RATE = 16000;
const PIECE_SECONDS = 420; // ≈ 2.5 MB per piece — safely under the function's request limit

let availability: Promise<boolean> | null = null;

/** Is the server model set up (GROQ_API_KEY on Netlify)? Asked once per visit. */
export function serverTranscriptionAvailable(): Promise<boolean> {
  availability ??= fetch('/api/transcribe', { signal: AbortSignal.timeout(8000) })
    .then(response => (response.ok ? response.json() : { available: false }))
    .then((body: { available?: boolean }) => Boolean(body.available))
    .catch(() => false);
  return availability;
}

const LANGUAGE_CODES: Record<string, string> = {
  english: 'en', spanish: 'es', portuguese: 'pt', french: 'fr', italian: 'it', german: 'de', dutch: 'nl',
  swedish: 'sv', polish: 'pl', russian: 'ru', turkish: 'tr', arabic: 'ar', hindi: 'hi', japanese: 'ja',
  korean: 'ko', chinese: 'zh', tagalog: 'tl', indonesian: 'id', vietnamese: 'vi'
};

interface ServerResult {
  language: string | null;
  words: Array<{ text: string; start: number; end: number }>;
  segments: Array<{ start: number; end: number; noSpeech: number; logProb: number }>;
}

/** Cuts the song into pieces of at most PIECE_SECONDS, always in a gap between sung notes. */
function pieces(notes: NoteEvent[], duration: number): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let start = 0;
  while (duration - start > PIECE_SECONDS) {
    const limit = start + PIECE_SECONDS;
    // The latest gap between notes before the limit (fall back to the limit itself).
    let cut = limit;
    for (let i = 1; i < notes.length; i += 1) {
      const gapStart = notes[i - 1].end, gapEnd = notes[i].start;
      if (gapEnd > limit) break;
      if (gapStart > start + 60 && gapEnd - gapStart > 0.25) cut = (gapStart + gapEnd) / 2;
    }
    out.push({ start, end: cut });
    start = cut;
  }
  out.push({ start, end: duration });
  return out;
}

/** Whisper sometimes "hears" words in silence; keep only words that line up with actual singing. */
function sungWords(result: ServerResult, offset: number, notes: NoteEvent[], lang?: string): TimedWord[] {
  const silent = result.segments.filter(segment => segment.noSpeech > 0.6 && segment.logProb < -0.8);
  return result.words
    .filter(word => !silent.some(segment => word.start >= segment.start && word.end <= segment.end))
    .filter(word => !/^[[(♪]|^(thank you|thanks for watching|subtitles by)/i.test(word.text))
    .map(word => ({ text: word.text, start: offset + word.start, end: offset + Math.max(word.end, word.start + 0.08), lang }))
    .filter(word => notes.some(note => note.end > word.start - 0.5 && note.start < word.end + 0.5));
}

/**
 * Transcribes the lead vocal on the server. Throws if the server model is unavailable or fails, so
 * the caller can fall back to the in-browser model.
 */
export async function transcribeOnServer(
  buffer: AudioBuffer, notes: NoteEvent[], options: LyricsOptions, title: string | undefined,
  onProgress: (fraction: number, detail: string) => void
): Promise<TimedWord[]> {
  const audio = await resampleMono(buffer, RATE);
  const parts = pieces(notes, buffer.duration);
  // A single chosen language is passed on; "detect" or a language pair lets Whisper decide per piece.
  const lang = options.languages.length === 1 ? options.languages[0] : '';
  const words: TimedWord[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    onProgress(index / parts.length, 'Listening on the server' + (parts.length > 1 ? ' · part ' + (index + 1) + '/' + parts.length : '') + '…');
    const samples = audio.slice(Math.floor(part.start * RATE), Math.ceil(part.end * RATE));
    const mp3 = await encodeMp3([samples], RATE, 48);
    const query = new URLSearchParams();
    if (lang) query.set('lang', lang);
    if (title) query.set('prompt', title);
    const response = await fetch('/api/transcribe?' + query.toString(), {
      method: 'POST', headers: { 'content-type': 'audio/mpeg' }, body: mp3, signal: AbortSignal.timeout(90000)
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? 'Server transcription failed (' + response.status + ').');
    }
    const result = (await response.json()) as ServerResult;
    const code = lang || (result.language ? LANGUAGE_CODES[result.language.toLowerCase()] ?? result.language.slice(0, 2).toLowerCase() : undefined);
    const heard = sungWords(result, part.start, notes, code);
    diag('Lyrics (server): part ' + (index + 1) + '/' + parts.length + ' · ' + heard.length + ' words' + (result.language ? ' · ' + result.language : ''), 'ok');
    words.push(...heard);
  }
  onProgress(1, words.length + ' words');
  return words;
}
