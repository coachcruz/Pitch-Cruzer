import type { LyricLine, NoteEvent, PitchTrack, Section, Word } from './analysis';
import { noteAt } from './analysis';
import { encodeWav } from './audio';
import { foldToOctave } from './music';
import { splitByRanges, type Range, type Timeline } from './player';
import { analyzeVibrato, centerTrack, summarizeVibrato, type VibratoSummary } from './vibrato';
import type { SongBuffers } from './prepare';

export interface LineScore { line: LyricLine; percent: number; meanCents: number | null; frames: number }
/** Signed mean pitch error of one sung word (cents, sung minus target), for word-level coaching. */
export interface WordScore { lineId: string; text: string; meanCents: number }
export interface TakeScore {
  score: number;
  onPitchWhenSinging: number;
  coverage: number;
  meanCents: number | null;
  /** 0–100: how evenly held notes are sustained (precision), separate from landing on them (accuracy). */
  steadiness: number | null;
  vibrato: VibratoSummary;
  lines: LineScore[];
  /** Only words with at least 3 voiced frames and a measurable error. */
  words: WordScore[];
  trail: Array<{ t: number; midi: number }>;
}

/** The sung (non-aside) word sounding at `time`, if any. */
function wordAt(line: LyricLine, time: number): Word | null {
  for (const word of line.words) {
    if (word.aside) continue;
    if (time >= word.start && time < word.end) return word;
  }
  return null;
}

/**
 * Compares the singer's take (pitch track aligned to the practice timeline) against the
 * artist's notes. "On pitch" = within a quarter tone (50 cents); octave can be ignored.
 * Echo practice counts only the singer's turns; a duet counts only the singer's own lines.
 */
export function scoreTake(
  voice: PitchTrack,
  voiceOffset: number,
  timeline: Timeline,
  notes: NoteEvent[],
  lines: LyricLine[],
  flexibleOctave: boolean,
  /** Only these moments count (duet: just your lines). */
  counts: (sourceTime: number) => boolean = () => true
): TakeScore {
  const hop = 0.02;
  let targetFrames = 0, voicedFrames = 0, points = 0, hits = 0;
  const errors: number[] = [];
  const perLine = new Map<LyricLine, { frames: number; points: number; errors: number[] }>();
  const perWord = new Map<Word, { lineId: string; text: string; voiced: number; errors: number[] }>();
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
    if (!counts(source)) continue;
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
    if (line) {
      const word = wordAt(line, source);
      if (word) {
        const entry = perWord.get(word) ?? { lineId: line.id, text: word.text, voiced: 0, errors: [] as number[] };
        perWord.set(word, entry);
        entry.voiced += 1;
        if (Math.abs(error) <= 2) entry.errors.push(error * 100);
      }
    }
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
    words: [...perWord.values()]
      .filter(entry => entry.voiced >= 3 && entry.errors.length > 0)
      .map((entry): WordScore => ({ lineId: entry.lineId, text: entry.text, meanCents: mean(entry.errors)! })),
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

export interface WordNote { word: string; lineText: string; cents: number; direction: 'flat' | 'sharp'; tip: string }
export interface SectionCoaching {
  sectionId: string; label: string;
  score: number | null; coverage: number | null;
  strengths: string[]; weaknesses: string[]; wordNotes: WordNote[];
}

/**
 * A one-line vowel-shaping suggestion for a word, from a rough guess at its stressed vowel
 * (the last vowel cluster — the vowel most often sustained when a word is sung). This is
 * heuristic coaching language, never a measurement of the singer's mouth.
 */
function vowelTip(word: string): string {
  const clusters = word.toLowerCase().match(/[aeiouy]+/g) ?? [];
  const vowel = clusters.length ? clusters[clusters.length - 1] : '';
  if (/ee|ea|ei|ie|ey/i.test(vowel) || vowel === 'i' || vowel === 'y') return 'Try a narrower "ee" — lips spread, sound placed forward.';
  if (/oo|ou|ew|ue/i.test(vowel) || vowel === 'u') return 'Try a narrow, forward "oo" — lips gently pursed, never tight.';
  if (/oa|oe|ow/i.test(vowel) || vowel === 'o') return 'Try a tall, round "oh" — keep the lips from clamping shut.';
  if (vowel.includes('a')) return 'Try dropping the jaw on the "ah" — keep the space in the throat open.';
  return 'Try a relaxed jaw on the "eh" — loose, neither spread nor pushed.';
}

/**
 * Per-section coaching for a scored take: a frame-weighted score, an approximate coverage,
 * plain-language strengths and weaknesses, and up to three words worth a closer listen.
 *
 * Coverage is an approximation: a line's heard share is estimated from the share of its words
 * that carried enough voice to measure (at least 3 voiced frames), weighted by each line's
 * target frames. Brief fragments count as unheard, so it can read slightly low.
 */
export function sectionCoaching(take: TakeScore, sections: Section[], lines: LyricLine[]): SectionCoaching[] {
  const lineWords = new Map<string, string[]>();
  for (const line of lines) lineWords.set(line.id, line.words.filter(word => !word.aside).map(word => word.text));
  const wordsByLine = new Map<string, WordScore[]>();
  for (const word of take.words) {
    const list = wordsByLine.get(word.lineId) ?? [];
    list.push(word);
    wordsByLine.set(word.lineId, list);
  }

  return sections.map(section => {
    const none: SectionCoaching = {
      sectionId: section.id, label: section.label,
      score: null, coverage: null, strengths: [], weaknesses: [], wordNotes: []
    };
    const scored = take.lines.filter(item => item.line.start >= section.start && item.line.start < section.end);
    if (!scored.length) return none;

    const frames = scored.reduce((n, item) => n + item.frames, 0);
    const score = Math.round(scored.reduce((n, item) => n + item.percent * item.frames, 0) / frames);
    const coverage = Math.round(100 * scored.reduce((n, item) => {
      const total = lineWords.get(item.line.id)?.length ?? 0;
      return total ? n + item.frames * ((wordsByLine.get(item.line.id)?.length ?? 0) / total) : n;
    }, 0) / frames);
    const centsFrames = scored.reduce((n, item) => n + (item.meanCents === null ? 0 : item.frames), 0);
    const cents = centsFrames
      ? scored.reduce((n, item) => n + (item.meanCents ?? 0) * item.frames, 0) / centsFrames
      : 0;

    const strengths: string[] = [];
    const weaknesses: string[] = [];
    if (score >= 85) strengths.push('Pitch locked in across the section.');
    else if (score >= 70) strengths.push('Holding pitch well through the section.');
    if (centsFrames > 0 && Math.abs(cents) < 12) strengths.push('Centered on the notes — no steady flat or sharp drift.');
    if (coverage >= 80) strengths.push('Sang out confidently — voice heard on almost every note.');
    if (centsFrames > 0 && cents <= -20) weaknesses.push(`Tending flat by ~${Math.round(-cents)}¢ — think “up” on the long notes.`);
    if (centsFrames > 0 && cents >= 20) weaknesses.push(`Tending sharp by ~${Math.round(cents)}¢ — relax and let the notes settle.`);
    if (coverage < 60) weaknesses.push('Voice dropping out in places — sing out more through the section.');
    if (score < 55) weaknesses.push('Several notes missed — loop the weakest lines with the artist as a guide.');
    if (score >= 70 && !strengths.length) strengths.push('Steady overall — keep doing what you are doing.');
    if (score < 70 && !weaknesses.length) weaknesses.push('Inconsistent — some lines land, others drift; loop the low-scoring lines.');

    const wordNotes: WordNote[] = scored
      .flatMap(item => (wordsByLine.get(item.line.id) ?? []).map(word => ({
        word: word.text,
        lineText: (lineWords.get(item.line.id) ?? []).join(' '),
        cents: Math.round(word.meanCents),
        direction: (word.meanCents < 0 ? 'flat' : 'sharp') as 'flat' | 'sharp',
        tip: vowelTip(word.text)
      })))
      .filter(note => Math.abs(note.cents) >= 20)
      .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents))
      .slice(0, 3);

    return {
      sectionId: section.id, label: section.label,
      score, coverage,
      strengths: strengths.slice(0, 3), weaknesses: weaknesses.slice(0, 3),
      wordNotes
    };
  });
}

/** Renders song stems + the singer's voice to a stereo WAV, using the current mix levels. */
export async function mixdown(
  buffers: SongBuffers,
  timeline: Timeline,
  levels: { lead: number; music: number; voice: number },
  voice: AudioBuffer,
  voiceOffset: number,
  /** Duet: your partner's lines, where the original singer stays at full volume. */
  partner: Range[] = []
): Promise<Blob> {
  const sampleRate = buffers.lead.sampleRate;
  const length = Math.ceil((timeline.duration + 0.5) * sampleRate);
  const offline = new OfflineAudioContext(2, length, sampleRate);
  const gain = (value: number) => { const node = offline.createGain(); node.gain.value = value; node.connect(offline.destination); return node; };
  const leadGain = gain(levels.lead), partnerGain = gain(1);
  const stems: Array<[AudioBuffer | null, GainNode]> = [[buffers.backing, gain(levels.music)], [buffers.instrumental, gain(levels.music)]];
  for (const piece of timeline.pieces) {
    if (piece.turn) continue; // Echo: the song is silent while you sing it back, as in playback
    for (const [start, end, isPartner] of splitByRanges(piece.sourceStart, piece.duration, partner)) {
      if (start >= buffers.lead.duration) continue;
      const source = offline.createBufferSource();
      source.buffer = buffers.lead;
      source.connect(isPartner ? partnerGain : leadGain);
      source.start(piece.timelineStart + start - piece.sourceStart, start, Math.min(end - start, buffers.lead.duration - start));
    }
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
