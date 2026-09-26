import type { LyricLine, NoteEvent, PitchTrack } from './analysis';
import { encodeWav } from './audio';
import { foldToOctave } from './music';
import type { Timeline } from './player';
import { analyzeVibrato, centerTrack, summarizeVibrato, type VibratoSummary } from './vibrato';
import type { SongBuffers } from './prepare';

export interface LineScore { line: LyricLine; percent: number; meanCents: number | null; frames: number }
export interface TakeScore {
  score: number;
  onPitchWhenSinging: number;
  coverage: number;
  meanCents: number | null;
  /** 0–100: how evenly held notes are sustained (precision), separate from landing on them (accuracy). */
  steadiness: number | null;
  vibrato: VibratoSummary;
  lines: LineScore[];
  trail: Array<{ t: number; midi: number }>;
}

function noteAt(notes: NoteEvent[], time: number): NoteEvent | null {
  let lo = 0, hi = notes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (time < notes[mid].start) hi = mid - 1;
    else if (time >= notes[mid].end) lo = mid + 1;
    else return notes[mid];
  }
  return null;
}

/**
 * Compares the singer's take (pitch track aligned to the practice timeline) against the
 * artist's notes. "On pitch" = within a quarter tone (50 cents); octave can be ignored.
 */
export function scoreTake(
  voice: PitchTrack,
  voiceOffset: number,
  timeline: Timeline,
  notes: NoteEvent[],
  lines: LyricLine[],
  flexibleOctave: boolean
): TakeScore {
  const hop = 0.02;
  let targetFrames = 0, voicedFrames = 0, points = 0, hits = 0;
  const errors: number[] = [];
  const perLine = new Map<LyricLine, { frames: number; points: number; errors: number[] }>();
  const perNote = new Map<NoteEvent, number[]>();
  const perNoteRaw = new Map<NoteEvent, number[]>();
  // Judge the CENTER of any vibrato (average over ~one cycle), not each instant of the swing.
  const center = centerTrack(voice.midi, Math.max(2, Math.round(0.12 / voice.hopSeconds)));
  const trail: Array<{ t: number; midi: number }> = [];
  let lineIndex = 0;

  const turnsOnly = timeline.hasTurns;
  for (let t = 0; t < timeline.duration; t += hop) {
    const source = timeline.sourceTimeAt(t);
    if (source === null) continue;
    // Echo practice: only the singer's turns count (the artist's demo parts are for listening).
    if (turnsOnly && !timeline.pieceAt(t)?.turn) continue;
    const index = Math.round((t - voiceOffset) / voice.hopSeconds);
    const raw = index >= 0 && index < voice.midi.length ? voice.midi[index] : NaN;
    const sung = index >= 0 && index < center.length ? center[index] : NaN;
    if (!Number.isNaN(raw)) trail.push({ t: source, midi: raw });

    const target = noteAt(notes, source);
    if (!target) continue;
    targetFrames += 1;
    while (lineIndex < lines.length - 1 && lines[lineIndex].end < source) lineIndex += 1;
    let line = lines[lineIndex];
    if (!line || source < line.start - 0.3 || source > line.end + 0.3) {
      line = lines.find(candidate => source >= candidate.start - 0.3 && source <= candidate.end + 0.3)!;
    }
    const bucket = line ? (perLine.get(line) ?? { frames: 0, points: 0, errors: [] }) : null;
    if (line && bucket) { perLine.set(line, bucket); bucket.frames += 1; }
    if (Number.isNaN(sung)) continue;

    voicedFrames += 1;
    const rawList = perNoteRaw.get(target) ?? [];
    rawList.push(raw);
    perNoteRaw.set(target, rawList);
    const compared = flexibleOctave ? foldToOctave(sung, target.midi) : sung;
    const error = compared - target.midi;
    const value = Math.abs(error) <= 0.5 ? 1 : Math.abs(error) <= 1 ? 0.5 : 0;
    if (value === 1) hits += 1;
    points += value;
    if (Math.abs(error) <= 2) {
      errors.push(error * 100);
      const held = perNote.get(target) ?? [];
      held.push(error * 100);
      perNote.set(target, held);
    }
    if (bucket) { bucket.points += value; if (Math.abs(error) <= 2) bucket.errors.push(error * 100); }
  }

  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  // Steadiness: wobble (standard deviation) within each held note, ignoring deliberate vibrato-scale
  // averages across notes. ≤15¢ wobble scores 100, ≥60¢ scores 0.
  const wobbles: number[] = [];
  perNote.forEach(values => {
    if (values.length < 8) return;
    const m = mean(values)!;
    wobbles.push(Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length));
  });
  const wobble = mean(wobbles);
  const vibrato = summarizeVibrato([...perNoteRaw.values()]
    .map(values => analyzeVibrato(values, hop))
    .filter((reading): reading is NonNullable<typeof reading> => reading !== null));
  const centerSteadiness = wobble === null ? null : Math.round(Math.max(0, Math.min(100, ((60 - wobble) / 45) * 100)));
  // Healthy vibrato (or a straight tone) never lowers Steadiness; a wobble, tight tremolo, uneven or
  // very wide vibrato does.
  const vibratoCap: Record<string, number> = { healthy: 100, straight: 100, fast: 70, 'slow-wide': 55, irregular: 45, 'too-wide': 40 };
  const steadiness = centerSteadiness === null ? null : Math.min(centerSteadiness, vibrato.kind ? vibratoCap[vibrato.kind] ?? 100 : 100);
  return {
    score: targetFrames ? Math.round((100 * points) / targetFrames) : 0,
    onPitchWhenSinging: voicedFrames ? Math.round((100 * hits) / voicedFrames) : 0,
    coverage: targetFrames ? Math.round((100 * voicedFrames) / targetFrames) : 0,
    meanCents: mean(errors),
    steadiness,
    vibrato,
    lines: [...perLine.entries()]
      .filter(([, bucket]) => bucket.frames >= 5)
      .map(([line, bucket]) => ({ line, frames: bucket.frames, percent: Math.round((100 * bucket.points) / bucket.frames), meanCents: mean(bucket.errors) }))
      .sort((a, b) => a.line.start - b.line.start),
    trail
  };
}

export function coachingTip(score: TakeScore): string {
  if (score.coverage < 40) return 'Try singing out a little more — the mic heard you on less than half the notes. Turning the artist to “Guide” can help you feel safer.';
  if (score.onPitchWhenSinging >= 55 && score.steadiness !== null && score.steadiness < 50) return 'You’re landing on the notes — now hold them steadier. Keep a slow, even breath flowing through long notes instead of pushing.';
  if (score.meanCents !== null && score.meanCents < -25) return 'You tend to sing a bit flat (under the note). Think “up” and lift your eyebrows on long notes.';
  if (score.meanCents !== null && score.meanCents > 25) return 'You tend to sing a bit sharp (over the note). Relax and let the note settle rather than pushing.';
  if (score.onPitchWhenSinging >= 75) return 'Great pitch! Try turning the artist down further, or record the next section.';
  return 'Loop the lines marked in red with the artist at “Guide” level, then try again.';
}

/** Renders song stems + the singer's voice to a stereo WAV, using the current mix levels. */
export async function mixdown(
  buffers: SongBuffers,
  timeline: Timeline,
  levels: { lead: number; backing: number; music: number; voice: number },
  voice: AudioBuffer,
  voiceOffset: number
): Promise<Blob> {
  const sampleRate = buffers.lead.sampleRate;
  const length = Math.ceil((timeline.duration + 0.5) * sampleRate);
  const offline = new OfflineAudioContext(2, length, sampleRate);
  const gain = (value: number) => { const node = offline.createGain(); node.gain.value = value; node.connect(offline.destination); return node; };
  const stems: Array<[AudioBuffer | null, GainNode]> = [
    [buffers.lead, gain(levels.lead)], [buffers.backing, gain(levels.backing)], [buffers.instrumental, gain(levels.music)]
  ];
  for (const piece of timeline.pieces) {
    for (const [buffer, node] of stems) {
      if (!buffer || piece.sourceStart >= buffer.duration) continue;
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(node);
      source.start(piece.timelineStart, piece.sourceStart, Math.min(piece.duration, buffer.duration - piece.sourceStart));
    }
  }
  const voiceSource = offline.createBufferSource();
  voiceSource.buffer = voice;
  voiceSource.connect(gain(levels.voice));
  const skip = Math.max(0, -voiceOffset);
  voiceSource.start(Math.max(0, voiceOffset), skip);
  const rendered = await offline.startRendering();

  // Keep the mix from clipping.
  const left = rendered.getChannelData(0), right = rendered.getChannelData(1);
  let peak = 0;
  for (let i = 0; i < left.length; i += 1) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  if (peak > 0.98) {
    const factor = 0.98 / peak;
    for (let i = 0; i < left.length; i += 1) { left[i] *= factor; right[i] *= factor; }
  }
  return encodeWav([left, right], sampleRate);
}
