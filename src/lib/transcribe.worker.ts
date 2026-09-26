/// <reference lib="webworker" />
/**
 * Transcribes the isolated lead vocal with word-level timestamps using Whisper (transformers.js).
 * Runs in a worker so the page stays responsive while the model downloads and runs.
 */
export interface TranscribeJob { audio: Float32Array; language?: string }
export interface TimedWord { text: string; start: number; end: number }

const MODELS = ['Xenova/whisper-base', 'Xenova/whisper-tiny'];
let transcriber: any = null;

async function loadModel(): Promise<any> {
  if (transcriber) return transcriber;
  const { pipeline } = await import('@huggingface/transformers');
  let lastError: unknown = null;
  for (const model of MODELS) {
    try {
      transcriber = await pipeline('automatic-speech-recognition', model, {
        progress_callback: (info: any) => {
          if (info?.status === 'progress' && typeof info.progress === 'number') {
            self.postMessage({ stage: 'download', progress: info.progress / 100 });
          }
        }
      });
      return transcriber;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('Could not load a transcription model.');
}

self.onmessage = async (event: MessageEvent<TranscribeJob>) => {
  try {
    const model = await loadModel();
    self.postMessage({ stage: 'transcribe', progress: 0 });
    const output: any = await model(event.data.audio, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      task: 'transcribe',
      ...(event.data.language ? { language: event.data.language } : {})
    });
    const chunks: any[] = Array.isArray(output?.chunks) ? output.chunks : [];
    const words: TimedWord[] = [];
    for (const chunk of chunks) {
      const text = String(chunk?.text ?? '').trim();
      const start = Number(chunk?.timestamp?.[0]);
      const endRaw = chunk?.timestamp?.[1];
      const end = endRaw == null ? start + 0.4 : Number(endRaw);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
      words.push({ text, start, end: Math.max(end, start + 0.08) });
    }
    self.postMessage({ words });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
