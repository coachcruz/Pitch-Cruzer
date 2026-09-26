/// <reference lib="webworker" />
/**
 * Transcribes the isolated lead vocal with word-level timestamps using Whisper (transformers.js).
 *
 * Speed matters: Whisper always processes 30-second windows, so the vocal is sent as windows of up
 * to ~25 s of sung phrases (a 5-second phrase would cost as much as 30 seconds).
 *
 * Languages: transformers.js does not detect language itself — without an explicit language it
 * silently forces English, which dropped the non-English lines of bilingual songs. When more than one
 * language is allowed we score the model's language tokens for each window. If a window sounds like a
 * mix (the top two languages are close), its phrases are transcribed one by one, each in its own
 * language. Words are streamed back after every window so partial lyrics survive a timeout.
 */
export interface TranscribeClip { audio: Float32Array; offset: number; phrases: Array<{ start: number; end: number }> }
export interface TranscribeJob { clips: TranscribeClip[]; languages: string[]; quality: 'fast' | 'best' }
export interface TimedWord { text: string; start: number; end: number; lang?: string }

const MODELS: Record<TranscribeJob['quality'], string[]> = {
  best: ['Xenova/whisper-small', 'Xenova/whisper-base', 'Xenova/whisper-tiny'],
  fast: ['Xenova/whisper-base', 'Xenova/whisper-tiny']
};
const RATE = 16000;
/** Logit gap below which a window is treated as a language mix and split into phrases. */
const MIXED_GAP = 2.5;

let transformers: typeof import('@huggingface/transformers') | null = null;
let transcriber: any = null;

async function loadModel(quality: TranscribeJob['quality']): Promise<any> {
  if (transcriber) return transcriber;
  transformers ??= await import('@huggingface/transformers');
  let lastError: unknown = null;
  for (const model of MODELS[quality]) {
    try {
      const files = new Map<string, number>();
      transcriber = await transformers.pipeline('automatic-speech-recognition', model, {
        dtype: 'q8',
        progress_callback: (info: any) => {
          if (info?.status !== 'progress' || typeof info.progress !== 'number') return;
          files.set(String(info.file), info.progress);
          const values = [...files.values()];
          self.postMessage({ stage: 'download', progress: values.reduce((a, b) => a + b, 0) / (values.length * 100), model });
        }
      });
      self.postMessage({ stage: 'model', model, threads: (self as any).crossOriginIsolated ? 'multi' : 'single' });
      return transcriber;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('Could not load a transcription model.');
}

/** Scores the allowed language tokens after <|startoftranscript|>; returns them best first. */
async function languageScores(audio: Float32Array, allowed: string[]): Promise<Array<[string, number]>> {
  const model = transcriber.model;
  const config = model.generation_config;
  const langToId: Record<string, number> = config.lang_to_id ?? {};
  const candidates = allowed.filter(code => langToId['<|' + code + '|>'] !== undefined);
  if (candidates.length <= 1) return candidates.map(code => [code, 0]);
  const inputs = await transcriber.processor(audio);
  const start = config.decoder_start_token_id ?? langToId['<|en|>'] - 1;
  const decoderInput = new transformers!.Tensor('int64', BigInt64Array.from([BigInt(start)]), [1, 1]);
  const output = await model({ ...inputs, decoder_input_ids: decoderInput });
  const logits = output.logits;
  const vocab = logits.dims[logits.dims.length - 1];
  const offset = (logits.dims[1] - 1) * vocab;
  return candidates
    .map(code => [code, Number(logits.data[offset + langToId['<|' + code + '|>']])] as [string, number])
    .sort((a, b) => b[1] - a[1]);
}

async function transcribePiece(audio: Float32Array, offset: number, lang: string, multilingual: boolean): Promise<TimedWord[]> {
  const output: any = await transcriber(audio, {
    return_timestamps: 'word',
    ...(audio.length > RATE * 30 ? { chunk_length_s: 30, stride_length_s: 5 } : {}),
    ...(multilingual ? { task: 'transcribe', language: lang } : {})
  });
  const words: TimedWord[] = [];
  for (const chunk of Array.isArray(output?.chunks) ? output.chunks : []) {
    const text = String(chunk?.text ?? '').replace(/♪/g, '').trim();
    const start = Number(chunk?.timestamp?.[0]);
    const endRaw = chunk?.timestamp?.[1];
    const end = endRaw == null ? start + 0.4 : Number(endRaw);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    // Whisper hallucinates stock phrases / sound tags on music and silence; drop the obvious ones.
    if (/^[\[(]|^(thank you|thanks for watching|subtitles by)/i.test(text)) continue;
    words.push({ text, start: offset + start, end: offset + Math.max(end, start + 0.08), lang });
  }
  return words;
}

self.onmessage = async (event: MessageEvent<TranscribeJob>) => {
  const { clips, languages, quality } = event.data;
  try {
    const asr = await loadModel(quality);
    const multilingual = Boolean(asr.model.generation_config?.lang_to_id);
    const allowed = multilingual ? languages : ['en'];
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index];
      const scores = multilingual && allowed.length > 1 ? await languageScores(clip.audio, allowed) : [[allowed[0] ?? 'en', 0] as [string, number]];
      const mixed = scores.length > 1 && clip.phrases.length > 1 && scores[0][1] - scores[1][1] < MIXED_GAP;
      let words: TimedWord[] = [];
      const langs = new Set<string>();
      if (mixed) {
        // Sounds like more than one language: give each phrase its own language.
        for (const phrase of clip.phrases) {
          const piece = clip.audio.subarray(Math.floor(phrase.start * RATE), Math.ceil(phrase.end * RATE));
          if (piece.length < RATE * 0.4) continue;
          const pieceScores = await languageScores(piece, allowed);
          const lang = pieceScores[0]?.[0] ?? 'en';
          langs.add(lang);
          words = words.concat(await transcribePiece(piece, clip.offset + phrase.start, lang, multilingual));
        }
      } else {
        const lang = scores[0]?.[0] ?? 'en';
        langs.add(lang);
        words = await transcribePiece(clip.audio, clip.offset, lang, multilingual);
      }
      self.postMessage({ stage: 'transcribe', progress: (index + 1) / clips.length, langs: [...langs], mixed, words });
    }
    self.postMessage({ done: true });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
