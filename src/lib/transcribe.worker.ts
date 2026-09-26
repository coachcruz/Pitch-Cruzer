/// <reference lib="webworker" />
/**
 * Transcribes the isolated lead vocal with word-level timestamps using Whisper (transformers.js).
 *
 * The vocal is sent as short clips (one or a few sung phrases each), and the language is detected
 * separately for every clip. transformers.js does not detect language itself — without an explicit
 * language it silently forces English — so bilingual songs lost their non-English lines. Here we ask
 * the model which language token is most likely for each clip, limited to the languages the singer chose.
 */
export interface TranscribeClip { audio: Float32Array; offset: number }
export interface TranscribeJob { clips: TranscribeClip[]; languages: string[]; quality: 'fast' | 'best' }
export interface TimedWord { text: string; start: number; end: number; lang?: string }

const MODELS: Record<TranscribeJob['quality'], string[]> = {
  best: ['Xenova/whisper-small', 'Xenova/whisper-base', 'Xenova/whisper-tiny'],
  fast: ['Xenova/whisper-base', 'Xenova/whisper-tiny']
};

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
        progress_callback: (info: any) => {
          if (info?.status !== 'progress' || typeof info.progress !== 'number') return;
          files.set(String(info.file), info.progress);
          const values = [...files.values()];
          self.postMessage({ stage: 'download', progress: values.reduce((a, b) => a + b, 0) / (values.length * 100), model });
        }
      });
      return transcriber;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('Could not load a transcription model.');
}

/** Scores each allowed language token after <|startoftranscript|> and returns the likeliest code. */
async function detectLanguage(audio: Float32Array, allowed: string[]): Promise<string> {
  const model = transcriber.model;
  const config = model.generation_config;
  const langToId: Record<string, number> = config.lang_to_id ?? {};
  const candidates = (allowed.length ? allowed : Object.keys(langToId).map(token => token.slice(2, -2)))
    .filter(code => langToId['<|' + code + '|>'] !== undefined);
  if (candidates.length <= 1) return candidates[0] ?? 'en';

  const inputs = await transcriber.processor(audio);
  const start = config.decoder_start_token_id ?? langToId['<|en|>'] - 1;
  const decoderInput = new transformers!.Tensor('int64', BigInt64Array.from([BigInt(start)]), [1, 1]);
  const output = await model({ ...inputs, decoder_input_ids: decoderInput });
  const logits = output.logits;
  const vocab = logits.dims[logits.dims.length - 1];
  const offset = (logits.dims[1] - 1) * vocab;
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const code of candidates) {
    const score = Number(logits.data[offset + langToId['<|' + code + '|>']]);
    if (score > bestScore) { bestScore = score; best = code; }
  }
  return best;
}

self.onmessage = async (event: MessageEvent<TranscribeJob>) => {
  const { clips, languages, quality } = event.data;
  try {
    const asr = await loadModel(quality);
    const multilingual = Boolean(asr.model.generation_config?.lang_to_id);
    const words: TimedWord[] = [];
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index];
      const lang = multilingual ? await detectLanguage(clip.audio, languages) : 'en';
      const output: any = await asr(clip.audio, {
        return_timestamps: 'word',
        ...(clip.audio.length > 16000 * 30 ? { chunk_length_s: 30, stride_length_s: 5 } : {}),
        ...(multilingual ? { task: 'transcribe', language: lang } : {})
      });
      for (const chunk of Array.isArray(output?.chunks) ? output.chunks : []) {
        const text = String(chunk?.text ?? '').trim();
        const start = Number(chunk?.timestamp?.[0]);
        const endRaw = chunk?.timestamp?.[1];
        const end = endRaw == null ? start + 0.4 : Number(endRaw);
        if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
        // Whisper hallucinates stock phrases on silence/instrumental; drop the obvious ones.
        if (/^[\[(♪]|^(thank you|thanks for watching|subtitles by)/i.test(text)) continue;
        words.push({ text, start: clip.offset + start, end: clip.offset + Math.max(end, start + 0.08), lang });
      }
      self.postMessage({ stage: 'transcribe', progress: (index + 1) / clips.length, lang });
    }
    self.postMessage({ words });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
