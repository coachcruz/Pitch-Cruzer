import type { BreathMark, NoteEvent, Syllable } from '../lib/analysis';
import { foldToOctave, midiToNote, octaveOf, scalePitchClasses, VOICE_TYPES, type MusicalKey } from '../lib/music';

export interface TrailPoint { t: number; midi: number }

const CONVEYOR = 72;   // px: lyrics strip across the top (one row + breath marks)
const OCTAVE_COL = 18;  // px: octave stripe + label on the far left
const NOTE_COL = 34;    // px: note names

/**
 * The practice stage, drawn on one canvas:
 *  - top: lyrics on a conveyor belt — each syllable slides left and sits right above its note
 *  - below: the artist's notes as bars on a pitch lane shaded by octave
 *  - your voice as a line at the octave you are REALLY singing in (never folded)
 * Time runs right→left past a fixed playhead.
 */
export class PitchLane {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private baseLow = 45;
  private baseHigh = 69;
  private low = 45;
  private high = 69;
  trail: TrailPoint[] = [];
  /** Score the right note in any octave (the line is still drawn where you really sing). */
  forgiveOctave = false;
  windowSeconds = 8;
  liveMidi: number | null = null;
  /** Voice-type staff (bass, baritone, tenor…) beside the octave labels. */
  showVoiceTypes = true;
  /** Simple view: no voice staff, note names only on C rows, no syllable threads. */
  simple = false;
  private gutter = OCTAVE_COL + NOTE_COL;
  private view = { t0: 0, t1: 1, low: 45, rowHeight: 10, laneHeight: 100 };

  constructor(
    private canvas: HTMLCanvasElement,
    private notes: NoteEvent[],
    private syllables: Syllable[],
    range: [number, number] | null,
    private key: MusicalKey | null,
    private breaths: BreathMark[] = []
  ) {
    this.ctx = canvas.getContext('2d')!;
    if (range) { this.baseLow = range[0] - 3; this.baseHigh = range[1] + 3; }
    if (this.baseHigh - this.baseLow < 14) {
      const mid = (this.baseHigh + this.baseLow) / 2;
      this.baseLow = Math.floor(mid - 7);
      this.baseHigh = Math.ceil(mid + 7);
    }
    this.low = this.baseLow;
    this.high = this.baseHigh;
    this.resize();
  }

  setLyrics(syllables: Syllable[]): void { this.syllables = syllables; }

  resize(): void {
    const ratio = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(200, rect.width);
    this.height = Math.max(160, rect.height);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.windowSeconds = this.width < 520 ? 4.5 : this.width < 800 ? 6 : 8;
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

  /** Semitones between what you sang and the target (octave forgiven if enabled). */
  errorAt(midi: number, target: NoteEvent): number {
    return (this.forgiveOctave ? foldToOctave(midi, target.midi) : midi) - target.midi;
  }

  /** Grow the visible range when your voice goes above/below the song (e.g. subharmonics). */
  private updateRange(t0: number, now: number): void {
    let low = this.baseLow, high = this.baseHigh;
    for (const point of this.trail) {
      if (point.t < t0 || point.t > now + 0.05) continue;
      low = Math.min(low, Math.floor(point.midi) - 2);
      high = Math.max(high, Math.ceil(point.midi) + 2);
    }
    if (this.liveMidi !== null) {
      low = Math.min(low, Math.floor(this.liveMidi) - 2);
      high = Math.max(high, Math.ceil(this.liveMidi) + 2);
    }
    low = Math.max(21, low);
    high = Math.min(100, high);
    this.low += (low - this.low) * 0.12;
    this.high += (high - this.high) * 0.12;
  }

  draw(now: number): void {
    const { ctx, width, height } = this;
    const style = getComputedStyle(this.canvas);
    const color = (name: string) => style.getPropertyValue(name).trim();
    const t0 = now - this.windowSeconds * 0.25;
    const t1 = t0 + this.windowSeconds;
    this.updateRange(t0, now);
    // Voice types whose range overlaps what's on screen get a column each in the left gutter.
    const wide = width >= 560;
    const voiceCol = wide ? 13 : 10;
    const voices = this.showVoiceTypes && !this.simple ? VOICE_TYPES.filter(type => type.high >= this.low && type.low <= this.high) : [];
    const G = OCTAVE_COL + voices.length * voiceCol + NOTE_COL;
    this.gutter = G;
    const x = (t: number) => G + ((t - t0) / (t1 - t0)) * (width - G);
    const laneTop = CONVEYOR;
    const laneHeight = height - CONVEYOR;
    const span = this.high - this.low + 1;
    const rowHeight = laneHeight / span;
    const y = (midi: number) => laneTop + laneHeight - (midi - this.low + 0.5) * rowHeight;
    this.view = { t0, t1, low: this.low, rowHeight, laneHeight };

    ctx.clearRect(0, 0, width, height);

    // ---- octave bands
    ctx.textBaseline = 'middle';
    const firstOctave = octaveOf(Math.floor(this.low));
    const lastOctave = octaveOf(Math.ceil(this.high));
    for (let octave = firstOctave; octave <= lastOctave; octave += 1) {
      const cMidi = (octave + 1) * 12;
      const top = Math.max(laneTop, y(cMidi + 11) - rowHeight / 2);
      const bottom = Math.min(height, y(cMidi) + rowHeight / 2);
      if (bottom <= top) continue;
      ctx.fillStyle = octave % 2 === 0 ? color('--band-a') : color('--band-b');
      ctx.fillRect(0, top, width, bottom - top);
      // Octave number in a stripe along the far left edge, clear of the note names.
      ctx.fillStyle = octave % 2 === 0 ? color('--accent') : color('--accent-2');
      ctx.globalAlpha = 0.55;
      ctx.fillRect(0, top + 1, 4, bottom - top - 2);
      ctx.globalAlpha = 1;
      if (bottom - top > 40) {
        ctx.save();
        ctx.translate(13, (top + bottom) / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillStyle = color('--muted');
        ctx.font = '800 9px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText('OCTAVE ' + octave, 0, 0);
        ctx.restore();
      }
    }

    // ---- note rows
    const scale = this.key ? new Set(scalePitchClasses(this.key)) : null;
    ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
    for (let midi = Math.ceil(this.low); midi <= Math.floor(this.high); midi += 1) {
      const pc = ((midi % 12) + 12) % 12;
      const rowY = y(midi);
      if (scale?.has(pc)) {
        ctx.fillStyle = color('--lane-row');
        ctx.fillRect(G, rowY - rowHeight / 2, width - G, rowHeight - 1);
      }
      if (pc === 0) {
        ctx.fillStyle = color('--border');
        ctx.fillRect(G, rowY + rowHeight / 2 - 1, width - G, 1);
      }
      if ((rowHeight >= 11 && !this.simple) || pc === 0) {
        ctx.fillStyle = pc === 0 ? color('--text') : color('--muted');
        ctx.fillText(midiToNote(midi), G - NOTE_COL + 4, rowY);
      }
    }

    // ---- voice-type staff: one bar per voice type spanning its typical range
    voices.forEach((type, index) => {
      const colX = OCTAVE_COL + index * voiceCol;
      const top = Math.max(laneTop, y(type.high) - rowHeight / 2);
      const bottom = Math.min(height, y(type.low) + rowHeight / 2);
      if (bottom <= top) return;
      ctx.fillStyle = type.color;
      ctx.globalAlpha = 0.85;
      roundRect(ctx, colX + 1, top + 1, 3, bottom - top - 2, 1.5);
      ctx.globalAlpha = 1;
      if (bottom - top > 34) {
        ctx.save();
        ctx.translate(colX + 9, (top + bottom) / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = type.color;
        ctx.font = '800 ' + (wide ? 9 : 8) + 'px ui-sans-serif, system-ui, sans-serif';
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
      roundRect(ctx, left, barY - h / 2, Math.max(3, right - left - 1), h, 5);
      if (right - left > 24 && h >= 10) {
        ctx.fillStyle = note === active ? color('--on-accent') : color('--lane-note-text');
        ctx.fillText(midiToNote(note.midi), left + 4, barY);
      }
    }

    // ---- conveyor belt of lyrics
    ctx.fillStyle = color('--conveyor');
    ctx.fillRect(0, 0, width, CONVEYOR);
    // One row, so lyrics always read left to right. Syllables that must shift right to make room
    // keep a dotted thread back to the exact note (and time) they are sung on.
    const rowY = 30;
    let rowRight = -Infinity;
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.beginPath();
    ctx.rect(G, 0, width - G, height);
    ctx.clip();
    for (const syllable of this.syllables) {
      // Syllables that have fully scrolled past the left edge drop off the belt.
      if (syllable.text === '♪' || x(syllable.end) < G - 4) continue;
      if (syllable.start > t1) break;
      const current = syllable.start <= now && now < syllable.end;
      const sung = syllable.end <= now;
      ctx.font = (current ? '800 21px' : '600 19px') + ' ui-sans-serif, system-ui, sans-serif';
      const textWidth = ctx.measureText(syllable.text).width;
      // Already-sung syllables stay where they were sung; if one would overlap, drop it rather than
      // shoving it along (that made words pile up at the left edge when paused).
      if (sung && x(syllable.start) < rowRight + 5) continue;
      const left = Math.max(x(syllable.start), rowRight + 5);
      rowRight = left + textWidth;
      if (left > width) break;
      ctx.fillStyle = current ? color('--accent-2') : sung ? color('--muted') : color('--text');
      ctx.globalAlpha = sung ? 0.55 : 1;
      ctx.fillText(syllable.text, left, rowY);
      ctx.globalAlpha = 1;
      if (syllable.midi !== null && !sung && !this.simple) {
        ctx.strokeStyle = current ? color('--accent-2') : color('--thread');
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(left + 2, rowY + 13);
        ctx.lineTo(x(syllable.start) + 1, CONVEYOR);
        ctx.lineTo(x(syllable.start) + 1, y(Math.round(syllable.midi)) - Math.max(6, rowHeight * 0.8) / 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // Breath marks.
    ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
    for (const breath of this.breaths) {
      if (breath.time + breath.length < t0 || breath.time > t1) continue;
      const bx = x(breath.time + breath.length / 2);
      if (bx < G + 20) continue;
      ctx.fillStyle = color('--breath');
      ctx.globalAlpha = breath.time + breath.length < now ? 0.35 : 1;
      ctx.fillText('˅ breathe', bx - 22, CONVEYOR - 8);
      ctx.globalAlpha = 1;
    }
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
      const px = x(point.t), py = y(point.midi);
      ctx.strokeStyle = error === null ? color('--voice') : error <= 0.5 ? color('--good') : error <= 1.2 ? color('--close') : color('--off');
      ctx.beginPath();
      if (previous && point.t - previous.t < 0.15) { ctx.moveTo(previous.px, previous.py); ctx.lineTo(px, py); }
      else ctx.arc(px, py, 1.5, 0, Math.PI * 2);
      ctx.stroke();
      previous = { px, py, t: point.t };
    }

    // ---- playhead + live voice marker
    const playX = x(now);
    ctx.strokeStyle = color('--text');
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(playX, 0);
    ctx.lineTo(playX, height);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (this.liveMidi !== null) {
      const vy = y(this.liveMidi);
      ctx.fillStyle = color('--voice');
      ctx.beginPath();
      ctx.arc(playX, vy, 6, 0, Math.PI * 2);
      ctx.fill();
      const label = 'You ' + midiToNote(this.liveMidi);
      ctx.font = '800 12px ui-sans-serif, system-ui, sans-serif';
      const w = ctx.measureText(label).width + 12;
      ctx.fillStyle = color('--surface');
      roundRect(ctx, playX + 10, vy - 10, w, 20, 6);
      ctx.fillStyle = color('--voice');
      ctx.fillText(label, playX + 16, vy);
    }
  }
}

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
