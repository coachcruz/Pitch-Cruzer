import { describe, expect, it } from 'vitest';
import { measureRoundTrip } from '../src/lib/sync';

const RATE = 16000;
/** A recording starting at clock time `start`, with a short burst `delay` s after each click (± jitter). */
function recording(start: number, clicks: number[], delay: number, { jitter = 0, noise = 0.003, missing = 0 } = {}) {
  const end = clicks[clicks.length - 1] + 1.5;
  const samples = new Float32Array(Math.round((end - start) * RATE));
  let seed = 3;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let i = 0; i < samples.length; i += 1) samples[i] = noise * rand();
  clicks.forEach((click, k) => {
    if (k < missing) return;
    const at = Math.round((click + delay + jitter * rand() - start) * RATE);
    for (let i = 0; i < RATE * 0.03; i += 1) samples[at + i] += 0.6 * Math.exp(-i / (RATE * 0.006)) * rand();
  });
  return samples;
}

describe('sync check', () => {
  const clicks = Array.from({ length: 8 }, (_, k) => 10 + k * 0.6);

  it('finds the delay of Bluetooth headphones (about a quarter second)', () => {
    expect(Math.abs(measureRoundTrip(recording(9, clicks, 0.26), RATE, 9, clicks)! - 0.26)).toBeLessThan(0.012);
  });

  it('finds a small delay (wired headphones, speakers)', () => {
    const found = measureRoundTrip(recording(9, clicks, 0.04), RATE, 9, clicks)!;
    expect(Math.abs(found - 0.04)).toBeLessThan(0.012);
  });

  it('copes with claps that are a little off and a few that were missed', () => {
    const found = measureRoundTrip(recording(9, clicks, 0.2, { jitter: 0.04, missing: 2 }), RATE, 9, clicks)!;
    expect(Math.abs(found - 0.2)).toBeLessThan(0.03);
  });

  it('gives no answer when it heard nothing', () => {
    expect(measureRoundTrip(recording(9, clicks, 0.2, { missing: 8 }), RATE, 9, clicks)).toBeNull();
  });
});
