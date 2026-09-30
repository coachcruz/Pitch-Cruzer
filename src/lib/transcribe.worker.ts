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
export interface TranscribeJob {
  clips: TranscribeClip[];
  languages: string[];
  quality: 'fast' | 'best';
  /**
   * A reattempt's previous words: passed to Whisper as its initial prompt so the second listen is
   * guided by the first — it mainly goes after what was missed or misheard. Plain context, not a
   * script: the audio is still what's transcribed. Dropped silently if it can't be encoded.
   */
  prompt?: string;
}
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
let device: 'webgpu' | 'wasm' | null = null;

/** A note for the "Show details" log (something went wrong but the job carries on). */
const note = (text: string) => self.postMessage({ stage: 'note', text });

async function loadModel(quality: TranscribeJob['quality'], processorOnly = false): Promise<any> {
  if (transcriber && !(processorOnly && device === 'webgpu')) return transcriber;
  if (transcriber) { await transcriber.dispose?.().catch?.(() => undefined); transcriber = null; }
  transformers ??= await import('@huggingface/transformers');
  // Use the graphics chip (WebGPU) when the browser has one — often several times faster — and fall
  // back to the processor (WebAssembly) everywhere else, if the GPU route fails, or if it hears nothing.
  const gpu = !processorOnly && 'gpu' in navigator && Boolean(await (navigator as any).gpu?.requestAdapter?.().catch(() => null));
  const setups: Array<{ device: 'webgpu' | 'wasm'; dtype: any; label: string }> = [
    ...(gpu ? [{ device: 'webgpu' as const, dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, label: 'graphics chip' }] : []),
    { device: 'wasm', dtype: 'q8', label: 'processor' }
  ];
  let lastError: unknown = null;
  for (const setup of setups) {
    for (const model of MODELS[quality]) {
      try {
        const files = new Map<string, number>();
        transcriber = await transformers.pipeline('automatic-speech-recognition', model, {
          device: setup.device,
          dtype: setup.dtype,
          progress_callback: (info: any) => {
            if (info?.status !== 'progress' || typeof info.progress !== 'number') return;
            files.set(String(info.file), info.progress);
            const values = [...files.values()];
            self.postMessage({ stage: 'download', progress: values.reduce((x, y) => x + y, 0) / (values.length * 100), model });
          }
        });
        device = setup.device;
        const threads = setup.device === 'webgpu' ? 'GPU' : (self as any).crossOriginIsolated ? 'multi' : 'single';
        self.postMessage({ stage: 'model', model: model + ' on the ' + setup.label, threads });
        return transcriber;
      } catch (error) {
        lastError = error;
        transcriber = null;
      }
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

/** Encodes the reattempt prompt for Whisper; undefined when there's nothing usable to say. */
async function promptIds(prompt: string | undefined): Promise<number[] | undefined> {
  const text = prompt?.trim();
  if (!text || !transcriber?.tokenizer) return undefined;
  try {
    const encoded: any = await transcriber.tokenizer(text.slice(0, 2000), { add_special_tokens: false });
    const ids = encoded?.input_ids?.data ?? encoded?.input_ids;
    const list = Array.isArray(ids) ? ids.map(Number).filter(Number.isFinite) : [];
    return list.length ? list : undefined;
  } catch {
    return undefined;
  }
}

async function transcribePiece(audio: Float32Array, offset: number, lang: string, multilingual: boolean, prompt_ids?: number[]): Promise<TimedWord[]> {
  const output: any = await transcriber(audio, {
    return_timestamps: 'word',
    ...(audio.length > RATE * 30 ? { chunk_length_s: 30, stride_length_s: 5 } : {}),
    ...(multilingual ? { task: 'transcribe', language: lang } : {}),
    ...(prompt_ids ? { prompt_ids } : {})
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

/**
 * The language of a piece of singing, best guess first. Language detection runs a separate model step
 * that fails on some setups; then English is assumed (or the only allowed language) and the job goes on.
 */
let detectionWorks = true;
async function languagesOf(audio: Float32Array, allowed: string[]): Promise<Array<[string, number]>> {
  const fallback: Array<[string, number]> = [[allowed.includes('en') ? 'en' : allowed[0] ?? 'en', 0]];
  if (allowed.length <= 1 || !detectionWorks) return allowed.length ? [[allowed[0], 0]] : fallback;
  try {
    return await languageScores(audio, allowed);
  } catch (error) {
    detectionWorks = false;
    note('Language detection isn’t available here (' + (error instanceof Error ? error.message : String(error)) + ') — assuming ' + fallback[0][0].toUpperCase());
    return fallback;
  }
}

async function transcribeClip(clip: TranscribeClip, allowed: string[], multilingual: boolean, prompt_ids?: number[]): Promise<{ words: TimedWord[]; langs: string[]; mixed: boolean }> {
  const scores = multilingual ? await languagesOf(clip.audio, allowed) : [['en', 0] as [string, number]];
  const mixed = scores.length > 1 && clip.phrases.length > 1 && scores[0][1] - scores[1][1] < MIXED_GAP;
  const langs = new Set<string>();
  if (!mixed) {
    const lang = scores[0]?.[0] ?? 'en';
    langs.add(lang);
    return { words: await transcribePiece(clip.audio, clip.offset, lang, multilingual, prompt_ids), langs: [...langs], mixed };
  }
  // Sounds like more than one language: give each phrase its own language.
  let words: TimedWord[] = [];
  for (const phrase of clip.phrases) {
    const piece = clip.audio.subarray(Math.floor(phrase.start * RATE), Math.ceil(phrase.end * RATE));
    if (piece.length < RATE * 0.4) continue;
    const lang = (await languagesOf(piece, allowed))[0]?.[0] ?? 'en';
    langs.add(lang);
    words = words.concat(await transcribePiece(piece, clip.offset + phrase.start, lang, multilingual, prompt_ids));
  }
  return { words, langs: [...langs], mixed };
}

self.onmessage = async (event: MessageEvent<TranscribeJob>) => {
  const { clips, languages, quality, prompt } = event.data;
  try {
    let asr = await loadModel(quality);
    const ids = await promptIds(prompt);
    if (ids) note('Lyrics reattempt: listening again with the first pass as context (' + ids.length + ' prompt tokens)');
    let heardAny = false;
    let failed = 0;
    for (let index = 0; index < clips.length; index += 1) {
      const multilingual = Boolean(asr.model.generation_config?.lang_to_id);
      const allowed = multilingual ? languages : ['en'];
      let result: { words: TimedWord[]; langs: string[]; mixed: boolean } = { words: [], langs: [], mixed: false };
      try {
        result = await transcribeClip(clips[index], allowed, multilingual, ids);
      } catch (error) {
        // One bad window shouldn't lose the whole song.
        failed += 1;
        note('Lyrics window ' + (index + 1) + ' failed (' + (error instanceof Error ? error.message : String(error)) + ') — skipped');
      }
      heardAny ||= result.words.length > 0;
      // On some graphics chips the GPU model quietly returns nothing: switch to the processor and start over.
      if (!heardAny && device === 'webgpu' && index >= Math.min(1, clips.length - 1)) {
        note('The graphics chip heard nothing — switching to the processor and starting over');
        self.postMessage({ stage: 'restart' });
        asr = await loadModel(quality, true);
        index = -1;
        failed = 0;
        continue;
      }
      self.postMessage({ stage: 'transcribe', progress: (index + 1) / clips.length, langs: result.langs, mixed: result.mixed, words: result.words });
    }
    if (failed === clips.length) throw new Error('Every part of the song failed to transcribe.');
    self.postMessage({ done: true });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
