import type { LyricLine, NoteEvent } from './analysis';

/**
 * The song's beat: tempo (seconds per beat), where the beats fall, and whether it counts in 4 or 3.
 * Found from the music track: an "onset" curve (how suddenly the sound gets louder, 100 times a second)
 * is autocorrelated to find the beat period (60–180 BPM, leaning toward ~120), the beat grid is slid
 * to where onsets land, and the meter is the grouping (3 or 4 beats) whose first beat stands out most.
 */
export interface Beat { period: number; phase: number; meter: 3 | 4; version?: number }

/** Bump when the detector changes so beats saved by an older version are found again. */
export const BEAT_VERSION = 2;

/**
 * Whether the saved beat needs (re-)estimation: never estimated, previously found nothing, or from
 * an older detector. A saved "none found" must be retried — otherwise a song that once failed
 * detection would never get its count-in dots, no matter how the detector improves.
 */
export function beatNeedsEstimate(saved: Beat | null | undefined): boolean {
  return saved?.version !== BEAT_VERSION;
}

const RATE = 100; // onset curve samples per second

function onsetCurve(buffer: AudioBuffer): Float32Array {
  const hop = Math.round(buffer.sampleRate / RATE);
  const frames = Math.floor(buffer.length / hop);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    for (const data of channels) for (let i = f * hop; i < (f + 1) * hop; i += 2) sum += data[i] * data[i];
    energy[f] = Math.sqrt(sum / hop); // loudness on a linear scale: big hits count more than quiet ticks
  }
  // Rising energy only (half-wave), minus a local average so steady loud parts don't count.
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f += 1) onset[f] = Math.max(0, energy[f] - energy[f - 1]);
  const smooth = new Float32Array(frames);
  let running = 0;
  const window = 50;
  for (let f = 0; f < frames; f += 1) {
    running += onset[f] - (f >= window ? onset[f - window] : 0);
    smooth[f] = Math.max(0, onset[f] - running / Math.min(window, f + 1));
  }
  return smooth;
}

export function estimateBeat(buffer: AudioBuffer): Beat | null {
  const onset = onsetCurve(buffer);
  if (onset.length < RATE * 10) return null;
  // Tempo: autocorrelation over 60–180 BPM, weighted toward ~120 BPM (people tap near there).
  const autocorr = (lag: number) => {
    let sum = 0;
    for (let i = lag; i < onset.length; i += 1) sum += onset[i] * onset[i - lag];
    return sum;
  };
  const minLag = Math.round(RATE * 60 / 180), maxLag = Math.round(RATE * 60 / 60);
  const scores: number[] = [];
  let bestLag = 0, best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    scores[lag] = autocorr(lag);
    const weight = Math.exp(-0.5 * (Math.log2((60 * RATE) / lag / 120) / 0.9) ** 2);
    if (scores[lag] * weight > best) { best = scores[lag] * weight; bestLag = lag; }
  }
  if (!bestLag) return null;
  // Half-tempo guard: a slow pick (under ~90 BPM) whose double tempo also lines up well is almost always
  // counting every other beat — the dots would come twice as slow and start far too early.
  const half = Math.round(bestLag / 2);
  if ((60 * RATE) / bestLag < 90 && half >= minLag && (scores[half] ?? autocorr(half)) >= 0.35 * scores[bestLag]) bestLag = half;
  const sample = (t: number) => {
    const i = Math.round(t * RATE);
    return (onset[i] ?? 0) + 0.5 * ((onset[i - 1] ?? 0) + (onset[i + 1] ?? 0));
  };
  // Refine: a whole-frame period drifts off the beat over a song, so try fractional periods around the
  // best lag and keep the period + offset whose beat grid collects the most onset.
  let period = bestLag / RATE, phase = 0, gridScore = -Infinity;
  for (let lag = bestLag - 1; lag <= bestLag + 1; lag += 0.02) {
    const candidate = lag / RATE;
    for (let offset = 0; offset < candidate; offset += 1 / RATE) {
      let sum = 0;
      for (let t = offset; t < onset.length / RATE; t += candidate) sum += sample(t);
      if (sum > gridScore) { gridScore = sum; period = candidate; phase = offset; }
    }
  }
  // Meter: in 4/4 every 4th beat is accented; in 3/4 every 3rd. Pick the stronger contrast (4 unless 3 clearly wins).
  const beatStrength: number[] = [];
  for (let t = phase; t < onset.length / RATE; t += period) beatStrength.push(sample(t));
  const contrast = (meter: number) => {
    let bestRatio = 0;
    for (let down = 0; down < meter; down += 1) {
      let on = 0, onCount = 0, off = 0, offCount = 0;
      beatStrength.forEach((value, k) => { if (k % meter === down) { on += value; onCount += 1; } else { off += value; offCount += 1; } });
      bestRatio = Math.max(bestRatio, (on / Math.max(1, onCount)) / Math.max(1e-6, off / Math.max(1, offCount)));
    }
    return bestRatio;
  };
  const meter: 3 | 4 = contrast(3) > contrast(4) * 1.15 ? 3 : 4;
  return { period, phase, meter, version: BEAT_VERSION };
}

/** Where the silent count-in dots go: before the first line, and before any line after a long gap. */
export interface Cue { lineId: string; dots: number[] }

export function countInCues(lines: LyricLine[], beat: Beat, notes: NoteEvent[] = []): Cue[] {
  const cues: Cue[] = [];
  const sung = lines.filter(line => line.words.some(word => !word.aside && word.text !== '♪'));
  sung.forEach((line, i) => {
    const previousEnd = i > 0 ? sung[i - 1].end : 0;
    // Where the voice really comes in: the first sung word, moved to the singer's first note near it
    // (lyric timing often starts a little early; the pitch track knows when the singing starts).
    const firstWord = line.words.find(word => !word.aside && word.text !== '♪');
    const lyricStart = firstWord ? firstWord.start : line.start;
    const note = notes.find(n => n.start >= lyricStart - 0.35 && n.start <= lyricStart + 1.5);
    const entry = note ? note.start : lyricStart;
    if (entry - previousEnd < beat.meter * beat.period + 0.4) return;
    // Count toward the beat the voice starts on (if it's close to one), one dot per beat before it.
    const nearest = beat.phase + Math.round((entry - beat.phase) / beat.period) * beat.period;
    const target = Math.abs(nearest - entry) <= beat.period * 0.3 ? nearest : entry;
    const dots = Array.from({ length: beat.meter }, (_, k) => target - (beat.meter - k) * beat.period);
    if (dots[0] > previousEnd) cues.push({ lineId: line.id, dots });
  });
  return cues;
}
