import type { BreathMark, NoteEvent } from '../lib/analysis';
import { foldToOctave, midiToNote, VOICE_TYPES } from '../lib/music';

export interface TrailPoint { t: number; midi: number }
/** A sung word on the lyrics belt, with the note it starts on. */
export interface LaneWord { text: string; start: number; end: number; midi: number | null }

const CONVEYOR = 84;   // px: lyrics strip across the top (one big row + breath marks)
const OCTAVE_COL = 18;  // px: TREBLE / BASS labels on the far left
const NOTE_COL = 46;    // px: note names (two zigzag columns so every note fits)

/**
 * The Staff view, drawn on one canvas:
 *  - top: a lyrics belt — whole words that slide left at a steady speed, each right above its notes
 *  - below: the artist's notes as bars on a fixed grand staff (bass half darker, treble half lighter,
 *    every note labeled), with breath marks in the real gaps between words
 *  - your voice as a line at the octave you are REALLY singing in (never folded)
 * Time runs right→left past a fixed playhead.
 */
export class PitchLane {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  /** Fixed staff range (MIDI): the song's lowest to highest note, plus 2 each side. */
  private readonly low: number = 45;
  private readonly high: number = 69;
  trail: TrailPoint[] = [];
  /** Score the right note in any octave (the line is still drawn where you really sing). */
  forgiveOctave = false;
  /** Seconds of song across the lane; fitted to the lyrics by layoutWords(). */
  private windowSeconds = 6;
  /** Voice-type staff (bass, baritone, tenor…) beside the octave labels. */
  showVoiceTypes = true;
  /** Simple view: no voice staff, note names only on C rows, no syllable threads. */
  simple = false;
  /** Duet: song stretches sung by your partner — drawn faded, so your own lines stand out. */
  partner: Array<{ start: number; end: number }> = [];
  private gutter = OCTAVE_COL + NOTE_COL;
  private allBreaths: BreathMark[];
  private breaths: BreathMark[];
  /** Conveyor layout, computed once: each word's fixed position (in song seconds). */
  private layout: Array<{ at: number; size: number; text: string; start: number; end: number; midi: number | null }> | null = null;
  private layoutGutter = 0;
  private view = { t0: 0, t1: 1, low: 45, rowHeight: 10, laneHeight: 100 };

  constructor(
    private canvas: HTMLCanvasElement,
    private notes: NoteEvent[],
    private words: LaneWord[],
    range: [number, number] | null,
    breaths: BreathMark[] = []
  ) {
    this.ctx = canvas.getContext('2d')!;
    // The staff spans exactly what the song sings plus 2 notes each side, and never moves. A voice
    // outside it is pinned to the edge with an arrow.
    const sung = notes.map(note => Math.round(note.midi));
    const songLow = sung.length ? Math.min(...sung) : range?.[0];
    const songHigh = sung.length ? Math.max(...sung) : range?.[1];
    let low = songLow === undefined ? 45 : songLow - 2;
    let high = songHigh === undefined ? 69 : songHigh + 2;
    if (high - low < 8) {
      const mid = (high + low) / 2;
      low = Math.floor(mid - 4);
      high = Math.ceil(mid + 4);
    }
    this.low = low;
    this.high = high;
    this.allBreaths = breaths;
    this.breaths = this.breathsBetweenWords();
    this.resize();
  }

  setLyrics(words: LaneWord[]): void {
    this.words = words;
    this.layout = null;
    this.breaths = this.breathsBetweenWords();
  }

  /** Breaths only count in real gaps in the lyrics — not in the middle of a held or sliding word. */
  private breathsBetweenWords(): BreathMark[] {
    return this.allBreaths.filter(breath => {
      const middle = breath.time + breath.length / 2;
      return !this.words.some(word => word.start < middle - 0.05 && word.end > middle + 0.05);
    });
  }

  resize(): void {
    const ratio = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(200, rect.width);
    this.height = Math.max(160, rect.height);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    // The time scale is re-fitted to the lyrics (see the conveyor in draw()).
    this.layout = null;
  }

  /** The artist's note at a song time (binary search). */
  targetAt(time: number): NoteEvent | null {
    let lo = 0, hi = this.notes.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const note = this.notes[mid];
      if (time < note.start) hi = mid - 1;
      else if (time >= note.end) lo = mid + 1;
      else return note;
    }
    return null;
  }

  /** The artist's note bar under a point on the canvas (CSS pixels), if any — for tap-to-hear. */
  noteAtPoint(px: number, py: number): NoteEvent | null {
    const { t0, t1, low, rowHeight, laneHeight } = this.view;
    const G = this.gutter;
    if (py < CONVEYOR || px < G) return null;
    const time = t0 + ((px - G) / (this.width - G)) * (t1 - t0);
    const midi = low - 0.5 + (CONVEYOR + laneHeight - py) / rowHeight;
    let best: NoteEvent | null = null;
    let bestDistance = 1.6;
    for (const note of this.notes) {
      if (note.end < time - 0.15 || note.start > time + 0.15) continue;
      const distance = Math.abs(Math.round(note.midi) - midi);
      if (distance < bestDistance) { bestDistance = distance; best = note; }
    }
    return best;
  }

  /** True while in a breathing gap between phrases. */
  breathAt(time: number): boolean {
    return this.breaths.some(breath => time >= breath.time && time < breath.time + breath.length && breath.length >= 0.35);
  }

  private isPartner(time: number): boolean {
    return this.partner.some(range => time >= range.start && time < range.end);
  }

  /** Semitones between what you sang and the target (octave forgiven if enabled). */
  errorAt(midi: number, target: NoteEvent): number {
    return (this.forgiveOctave ? foldToOctave(midi, target.midi) : midi) - target.midi;
  }

  /**
   * Places every word once, at a fixed spot on the belt (never re-packed while scrolling, so the belt
   * moves rigidly), and picks the belt speed so (nearly) every word ends before the next one starts —
   * i.e. each word sits right above its own notes. Unusually fast words shrink a little; a word is
   * nudged right only as a last resort.
   */
  private layoutWords(gutter: number): void {
    const { ctx, width } = this;
    ctx.font = wordFont(24);
    const words = this.words;
    const need: number[] = [];
    words.forEach((word, i) => {
      const next = words[i + 1];
      if (next && next.start - word.start > 0.04) need.push((ctx.measureText(word.text).width + 14) / (next.start - word.start));
    });
    need.sort((a, b) => a - b);
    const want = need.length ? need[Math.min(need.length - 1, Math.floor(need.length * 0.9))] : 0;
    const usable = width - gutter;
    const defaultWindow = width < 520 ? 3.5 : width < 800 ? 4.5 : 6;
    const minWindow = width < 520 ? 1.8 : 2.4; // never so zoomed in that you can't see what's coming
    this.windowSeconds = Math.max(minWindow, Math.min(defaultWindow, usable / Math.max(1, want)));
    const pxPerSec = usable / this.windowSeconds;
    let freeAt = -Infinity;
    this.layout = words.map((word, i) => {
      const next = words[i + 1];
      const room = next ? (next.start - word.start) * pxPerSec - 12 : Infinity;
      let size = 24;
      ctx.font = wordFont(size);
      while (size > 16 && ctx.measureText(word.text).width > room) { size -= 2; ctx.font = wordFont(size); }
      const at = Math.max(word.start, freeAt);
      freeAt = at + (ctx.measureText(word.text).width + 12) / pxPerSec;
      return { at, size, text: word.text, start: word.start, end: word.end, midi: word.midi };
    });
    this.layoutGutter = gutter;
  }

  draw(now: number): void {
    const { ctx, width, height } = this;
    const style = getComputedStyle(this.canvas);
    const color = (name: string) => style.getPropertyValue(name).trim();
    // Voice types whose range overlaps the staff get a column each in the left gutter.
    const wide = width >= 560;
    const voiceCol = wide ? 13 : 10;
    const voices = this.showVoiceTypes && !this.simple ? VOICE_TYPES.filter(type => type.high >= this.low && type.low <= this.high) : [];
    const G = OCTAVE_COL + voices.length * voiceCol + NOTE_COL;
    this.gutter = G;
    if (!this.layout || this.layoutGutter !== G) this.layoutWords(G);
    const layout = this.layout!;
    const t0 = now - this.windowSeconds * 0.25;
    const t1 = t0 + this.windowSeconds;
    const x = (t: number) => G + ((t - t0) / (t1 - t0)) * (width - G);
    const laneTop = CONVEYOR;
    const laneHeight = height - CONVEYOR;
    const span = this.high - this.low + 1;
    const rowHeight = laneHeight / span;
    const y = (midi: number) => laneTop + laneHeight - (midi - this.low + 0.5) * rowHeight;
    this.view = { t0, t1, low: this.low, rowHeight, laneHeight };

    ctx.clearRect(0, 0, width, height);

    // ---- note rows: every semitone is a band. The bass half (below middle C) uses darker tones, the
    // treble half lighter ones, alternating row by row so you can always tell which note you're on.
    const trebleA = color('--treble-a'), trebleB = color('--treble-b'), bassA = color('--bass-a'), bassB = color('--bass-b');
    for (let midi = Math.ceil(this.low); midi <= Math.floor(this.high); midi += 1) {
      const rowY = y(midi);
      const even = midi % 2 === 0;
      ctx.fillStyle = midi >= 60 ? (even ? trebleA : trebleB) : (even ? bassA : bassB);
      ctx.fillRect(0, rowY - rowHeight / 2, width, rowHeight);
    }

    // ---- grand staff: the five treble-clef lines (E4 G4 B4 D5 F5) and bass-clef lines (G2 B2 D3 F3 A3),
    // like sheet music, with middle C (C4) between them.
    ctx.textBaseline = 'middle';
    const staves: Array<{ name: string; lines: number[] }> = [
      { name: 'TREBLE', lines: [64, 67, 71, 74, 77] },
      { name: 'BASS', lines: [43, 47, 50, 53, 57] }
    ];
    for (const staff of staves) {
      const top = y(staff.lines[4]), bottom = y(staff.lines[0]);
      ctx.strokeStyle = color('--staff');
      ctx.lineWidth = 1.2;
      for (const line of staff.lines) {
        const ly = y(line);
        if (ly < laneTop || ly > height) continue;
        ctx.beginPath();
        ctx.moveTo(G, ly);
        ctx.lineTo(width, ly);
        ctx.stroke();
      }
      if (bottom < laneTop || top > height) continue;
      const mid = Math.min(Math.max((top + bottom) / 2, laneTop + 30), height - 30);
      ctx.save();
      ctx.translate(9, mid);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = color('--muted');
      ctx.font = '800 9px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(staff.name, 0, 0);
      ctx.restore();
    }
    const cY = y(59.5);
    if (cY > laneTop && cY < height) {
      ctx.strokeStyle = color('--accent');
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, cY);
      ctx.lineTo(width, cY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // ---- note names: EVERY note is labeled, zigzagging between two columns so they never collide.
    const labelSize = Math.max(8, Math.min(12, rowHeight * 1.1));
    for (let midi = Math.ceil(this.low); midi <= Math.floor(this.high); midi += 1) {
      const rowY = y(midi);
      const pc = ((midi % 12) + 12) % 12;
      const natural = [0, 2, 4, 5, 7, 9, 11].includes(pc);
      if (this.simple && pc !== 0) continue;
      ctx.font = (pc === 0 ? '800 ' : natural ? '650 ' : '500 ') + labelSize + 'px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = pc === 0 ? color('--text') : natural ? color('--text') : color('--muted');
      ctx.fillText(midiToNote(midi), G - NOTE_COL + (midi % 2 === 0 ? 3 : 23), rowY);
    }

    // ---- voice-type staff: one quiet bar per voice type spanning its typical range
    const voiceInk = color('--muted');
    voices.forEach((type, index) => {
      const colX = OCTAVE_COL + index * voiceCol;
      const top = Math.max(laneTop, y(type.high) - rowHeight / 2);
      const bottom = Math.min(height, y(type.low) + rowHeight / 2);
      if (bottom <= top) return;
      ctx.fillStyle = voiceInk;
      ctx.globalAlpha = 0.55;
      roundRect(ctx, colX + 1, top + 1, 3, bottom - top - 2, 1.5);
      ctx.globalAlpha = 1;
      if (bottom - top > 34) {
        ctx.save();
        ctx.translate(colX + 9, (top + bottom) / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = voiceInk;
        ctx.font = '700 ' + (wide ? 9 : 8) + 'px ui-sans-serif, system-ui, sans-serif';
        const label = wide && bottom - top > 70 ? type.name.replace(' (subharmonic)', '').toUpperCase() : type.short.toUpperCase();
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    });
    ctx.textBaseline = 'middle';

    // ---- artist's notes
    const active = this.targetAt(now);
    ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
    for (const note of this.notes) {
      if (note.end < t0) continue;
      if (note.start > t1) break;
      const left = x(note.start), right = x(note.end);
      const barY = y(Math.round(note.midi));
      const h = Math.max(6, rowHeight * 0.8);
      ctx.fillStyle = note === active ? color('--accent') : note.end < now ? color('--lane-past') : color('--lane-note');
      ctx.globalAlpha = this.isPartner(note.start) ? 0.35 : 1;
      roundRect(ctx, left, barY - h / 2, Math.max(3, right - left - 1), h, 5);
      if (right - left > 24 && h >= 10) {
        ctx.fillStyle = note === active ? color('--on-accent') : color('--lane-note-text');
        ctx.fillText(midiToNote(note.midi), left + 4, barY);
      }
      ctx.globalAlpha = 1;
    }

    // ---- conveyor belt of lyrics
    ctx.fillStyle = color('--conveyor');
    ctx.fillRect(0, 0, width, CONVEYOR);
    // Whole words, written straight (see layoutWords); a dotted thread points to the note where each is sung.
    const rowY = 38;
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.beginPath();
    ctx.rect(G, 0, width - G, height);
    ctx.clip();
    for (const word of layout) {
      if (word.at > t1) break;
      ctx.font = wordFont(word.size);
      const left = x(word.at);
      if (left + ctx.measureText(word.text).width < G) continue;
      const current = word.start <= now && now < word.end;
      const sung = word.end <= now;
      ctx.fillStyle = current ? color('--accent-2') : sung ? color('--muted') : color('--text');
      ctx.globalAlpha = sung || this.isPartner(word.start) ? 0.4 : 1;
      ctx.fillText(word.text, left, rowY);
      ctx.globalAlpha = 1;
      if (word.midi !== null && !sung && !this.simple) {
        ctx.strokeStyle = current ? color('--accent-2') : color('--thread');
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(left + 2, rowY + 16);
        ctx.lineTo(x(word.start) + 1, CONVEYOR);
        ctx.lineTo(x(word.start) + 1, y(Math.round(word.midi)) - Math.max(6, rowHeight * 0.8) / 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // Breath marks: centered in the actual gap between the notes (the same gap the words sit around),
    // with a faint line down through the staff so it's clear which bars it falls between.
    ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const breath of this.breaths) {
      if (breath.time + breath.length < t0 || breath.time > t1) continue;
      const left = x(breath.time), right = x(breath.time + breath.length);
      const bx = (left + right) / 2;
      if (bx < G + 8) continue;
      const done = breath.time + breath.length < now;
      ctx.globalAlpha = done ? 0.3 : 1;
      ctx.strokeStyle = color('--breath');
      ctx.lineWidth = 1;
      ctx.setLineDash([1, 4]);
      ctx.beginPath();
      ctx.moveTo(bx, CONVEYOR);
      ctx.lineTo(bx, height);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color('--breath');
      ctx.fillText(right - left >= 64 ? '˅ breathe' : '˅', bx, CONVEYOR - 8);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
    ctx.restore();
    ctx.fillStyle = color('--border');
    ctx.fillRect(0, CONVEYOR - 1, width, 1);

    // ---- your voice, at its true octave
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    let previous: { px: number; py: number; t: number } | null = null;
    const visible = this.trail.filter(point => point.t >= t0 - 0.2 && point.t <= now + 0.05);
    for (let i = 0; i < visible.length; i += 1) {
      const point = visible[i];
      if (point.t < t0) { previous = null; continue; }
      const target = this.targetAt(point.t);
      // Color by the center of any vibrato (±0.11 s), so a healthy wave doesn't flash sharp/flat.
      let sum = 0, count = 0;
      for (let j = i; j >= 0 && point.t - visible[j].t <= 0.11; j -= 1) { sum += visible[j].midi; count += 1; }
      for (let j = i + 1; j < visible.length && visible[j].t - point.t <= 0.11; j += 1) { sum += visible[j].midi; count += 1; }
      const centerMidi = sum / count;
      const error = target ? Math.abs(this.errorAt(centerMidi, target)) : null;
      const px = x(point.t), py = Math.min(height - 3, Math.max(laneTop + 3, y(point.midi)));
      ctx.strokeStyle = error === null ? color('--voice') : error <= 0.5 ? color('--good') : error <= 1.2 ? color('--close') : color('--off');
      ctx.beginPath();
      if (previous && point.t - previous.t < 0.15) { ctx.moveTo(previous.px, previous.py); ctx.lineTo(px, py); }
      else ctx.arc(px, py, 1.5, 0, Math.PI * 2);
      ctx.stroke();
      previous = { px, py, t: point.t };
    }

    // ---- playhead
    const playX = x(now);
    ctx.strokeStyle = color('--text');
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(playX, 0);
    ctx.lineTo(playX, height);
    ctx.stroke();
    ctx.globalAlpha = 1;

  }
}

const wordFont = (size: number) => '700 ' + size + 'px ui-sans-serif, system-ui, sans-serif';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}
