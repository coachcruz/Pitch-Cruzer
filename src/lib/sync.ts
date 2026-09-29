import { prefs } from '../ui/dom';

/**
 * Sync: how late sound arrives — out of the app to your ears (Bluetooth headphones add 150–300 ms,
 * which the browser often doesn't report), and from your mouth back into the recording. The Sync check
 * (in the Mic check) measures it: it plays clicks, you clap along — or, on speakers, the mic simply
 * hears the clicks — and the delay found lines up your recordings, their scores and the moving staff.
 */

export interface SyncSetting {
  /** Round trip: a click played at T is heard in the recording at T + ms. */
  ms: number;
  /** The mic it was measured with (another mic, another delay). */
  mic: string;
  at: number;
}

export const savedSync = (): SyncSetting | null => prefs.get<SyncSetting | null>('sync', null);
export const saveSync = (setting: SyncSetting | null) => prefs.set('sync', setting);

/** The delay between what the app plays and what the mic records in answer to it (seconds). */
export function roundTrip(ctx: BaseAudioContext & { outputLatency?: number; baseLatency?: number }): number {
  const measured = savedSync();
  return measured ? measured.ms / 1000 : (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + 0.02;
}

/** How late the sound you hear is: what the staff and lyrics wait for so they follow your ears. */
export function outputDelay(ctx: BaseAudioContext & { outputLatency?: number; baseLatency?: number }): number {
  const reported = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  const measured = savedSync();
  // The measured round trip also holds the mic's own delay (small): count most of it as output.
  return measured ? Math.max(reported, measured.ms / 1000 - 0.03) : reported;
}

/**
 * From a recording made while clicks played at clock times `clicks`: the delay (seconds) from each
 * click to the sound it caused (a clap, or the click itself heard by the mic), as the median — or
 * null if too few clicks got a clear answer or the answers disagree.
 */
export function measureRoundTrip(samples: Float32Array, sampleRate: number, startTime: number, clicks: number[]): number | null {
  const frame = Math.max(1, Math.round(sampleRate * 0.005));
  const env = new Float32Array(Math.floor(samples.length / frame));
  for (let f = 0; f < env.length; f += 1) {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i += 1) sum += samples[i] * samples[i];
    env[f] = Math.sqrt(sum / frame);
  }
  const floor = [...env].sort((a, b) => a - b)[Math.floor(env.length * 0.2)] ?? 0;
  const threshold = Math.max(floor * 8, 0.02);
  const frameTime = (f: number) => startTime + (f * frame) / sampleRate;
  const found: number[] = [];
  for (const click of clicks) {
    const from = Math.max(10, Math.ceil(((click - 0.05 - startTime) * sampleRate) / frame));
    const to = Math.min(env.length, Math.floor(((click + 0.7 - startTime) * sampleRate) / frame));
    for (let f = from; f < to; f += 1) {
      let before = 0;
      for (let k = f - 10; k < f; k += 1) before += env[k];
      if (env[f] > threshold && env[f] > (before / 10) * 3) { found.push(frameTime(f) - click); break; }
    }
  }
  if (found.length < Math.ceil(clicks.length / 2)) return null;
  found.sort((a, b) => a - b);
  const median = found[Math.floor(found.length / 2)];
  const q1 = found[Math.floor(found.length / 4)], q3 = found[Math.floor((found.length * 3) / 4)];
  if (q3 - q1 > 0.08) return null;   // all over the place: not a steady delay
  return Math.max(0, median);
}
