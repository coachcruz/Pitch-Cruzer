import { rebaseToNoteRuns, type SongAnalysis } from './analysis';

/** Vocal articulations from the amplitude envelope, independent of pitch changes.
 * These are acoustic candidates, not a claim that energy alone identifies phonemes.
 * Continuous legato is kept continuous; short silences/re-attacks provide rap boundaries.
 */
export function vocalOnsets(samples: Float32Array, rate: number): number[] {
  const hop = Math.max(1, Math.round(rate * 0.005));
  const width = Math.max(hop, Math.round(rate * 0.02));
  const envelope: number[] = [];
  for (let from = 0; from < samples.length; from += hop) {
    let energy = 0;
    const end = Math.min(samples.length, from + width);
    for (let n = from; n < end; n++) energy += samples[n] * samples[n];
    envelope.push(Math.sqrt(energy / Math.max(1, end - from)));
  }
  const sorted = envelope.filter(x => x > 0).sort((a, b) => a - b);
  const floor = Math.max(0.001, (sorted[Math.floor(sorted.length * 0.8)] ?? 0) * 0.08);
  const result: number[] = [];
  let valley = 0, peak = 0, inSilence = true;
  for (let i = 0; i < envelope.length; i++) {
    const level = envelope[i];
    if (level < floor) { inSilence = true; valley = i; peak = 0; continue; }
    const previous = envelope[Math.max(0, i - 1)];
    if (level < previous) valley = i;
    const dipped = peak > floor * 2 && envelope[valley] < peak * 0.55;
    if (inSilence || (dipped && level > Math.max(floor * 2, envelope[valley] * 1.8))) {
      const at = Math.max(0, (inSilence ? i : valley) * hop / rate);
      if (!result.length || at - result[result.length - 1] >= 0.045) result.push(at);
      inSilence = false; peak = level; valley = i;
    }
    peak = Math.max(peak, level);
  }
  return result;
}

/** Refine transcript anchors only near measured attacks; never distribute missing attacks evenly. */
export function alignVocalOnsets(analysis: SongAnalysis, samples: Float32Array, rate: number): void {
  const onsets = vocalOnsets(samples, rate);
  const words = analysis.lines.flatMap(line => line.words).filter(word => !word.aside && word.text !== '♪');
  let measured = 0;
  words.forEach((word, index) => {
    const lower = index ? words[index - 1].end : 0;
    // Without phoneme evidence, a word attack cannot erase a saved syllable.
    const upper = Math.min(word.end, word.syllables[0]?.end ?? word.end, words[index + 1]?.start ?? analysis.duration);
    const candidate = onsets.filter(at => at >= lower && at < upper && Math.abs(at - word.start) <= 0.18)
      .sort((a, b) => Math.abs(a - word.start) - Math.abs(b - word.start))[0];
    word.timing = candidate === undefined ? 'estimated' : 'measured';
    if (candidate !== undefined) { word.start = candidate; measured++; }
    const internal = onsets.filter(at => at > word.start + 0.045 && at < word.end - 0.045);
    const syllables = word.syllables;
    const enough = internal.length === syllables.length - 1;
    syllables.forEach((syllable, k) => {
      // Only claim an interior syllable boundary when the audio provides the required attacks.
      // Ambiguous legato keeps its transcript estimate and is explicitly marked as uncertain.
      syllable.timing = enough && (k > 0 || candidate !== undefined) ? 'measured' : 'estimated';
      if (enough) {
        syllable.start = k === 0 ? word.start : internal[k - 1];
        syllable.end = k === syllables.length - 1 ? word.end : internal[k];
      } else if (k === 0) syllable.start = word.start;
    });
  });
  for (const line of analysis.lines) {
    const sung = line.words.filter(word => !word.aside);
    if (sung.length) { line.start = Math.min(...sung.map(w => w.start)); line.end = Math.max(...sung.map(w => w.end)); }
  }
  rebaseToNoteRuns(analysis.lines, analysis.notes);
  analysis.alignment = { measured, total: words.length };
}
