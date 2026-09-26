/**
 * YIN fundamental-frequency estimator (de Cheveigné & Kawahara, 2002).
 * Much faster and more octave-stable than brute-force normalized autocorrelation.
 */
export interface YinResult { frequency: number; confidence: number }

export function yin(
  frame: Float32Array,
  sampleRate: number,
  minHz = 60,
  maxHz = 1100,
  threshold = 0.15,
  subharmonics = true
): YinResult | null {
  const maxLag = Math.min(Math.floor(sampleRate / minHz), Math.floor(frame.length / 2));
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  if (maxLag <= minLag + 2) return null;
  const window = frame.length - maxLag;

  const diff = new Float32Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = 0; i < window; i += 1) {
      const d = frame[i] - frame[i + lag];
      sum += d * d;
    }
    diff[lag] = sum;
  }

  // Cumulative mean normalized difference.
  const cmnd = new Float32Array(maxLag + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let lag = 1; lag <= maxLag; lag += 1) {
    running += diff[lag];
    cmnd[lag] = running > 0 ? (diff[lag] * lag) / running : 1;
  }

  let lag = -1;
  for (let tau = minLag; tau <= maxLag; tau += 1) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= maxLag && cmnd[tau + 1] < cmnd[tau]) tau += 1;
      lag = tau;
      break;
    }
  }
  if (lag < 0) return null;

  // Octave check: if the waveform repeats far more cleanly at twice the period, the true pitch is an
  // octave lower. This fixes vowels whose resonance boosts the 2nd harmonic (read an octave high) and
  // catches subharmonic (period-doubled) singing. In a full mix, chords also repeat every few cycles,
  // so there it only applies above the normal voice floor (see minHz).
  const doubled = lag * 2;
  // (Not above ~800 Hz: there a period is only a dozen samples long and the doubled one looks falsely clean.)
  if (sampleRate / lag < 800 && (subharmonics || sampleRate / doubled >= 65) && doubled + 2 <= maxLag && cmnd[lag] > 0.05) {
    let best = doubled;
    for (let tau = doubled - 2; tau <= doubled + 2; tau += 1) if (cmnd[tau] < cmnd[best]) best = tau;
    if (cmnd[best] < cmnd[lag] * 0.4) lag = best;
  }

  let refined = lag;
  if (lag > 1 && lag < maxLag) {
    const a = cmnd[lag - 1], b = cmnd[lag], c = cmnd[lag + 1];
    const denom = a - 2 * b + c;
    if (Math.abs(denom) > 1e-9) refined = lag + (0.5 * (a - c)) / denom;
  }
  const frequency = sampleRate / refined;
  if (!Number.isFinite(frequency) || frequency < minHz || frequency > maxHz) return null;
  return { frequency, confidence: 1 - cmnd[lag] };
}

export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
  return Math.sqrt(sum / Math.max(1, frame.length));
}
