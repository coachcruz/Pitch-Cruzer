import type { NoteEvent, Syllable } from '../lib/analysis';
import { foldToOctave, midiToNote, scalePitchClasses, type MusicalKey } from '../lib/music';

export interface TrailPoint { t: number; midi: number }

/**
 * Scrolling "note highway": the original singer's notes are bars, your voice is the line.
 * Time runs left→right with the playhead fixed near the left; higher notes are higher up.
 */
export class PitchLane {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private low = 48;
  private high = 72;
  trail: TrailPoint[] = [];
  flexibleOctave = true;
  windowSeconds = 8;

  constructor(private canvas: HTMLCanvasElement, private notes: NoteEvent[], private syllables: Syllable[], range: [number, number] | null, private key: MusicalKey | null) {
    this.ctx = canvas.getContext('2d')!;
    if (range) { this.low = range[0] - 3; this.high = range[1] + 3; }
    if (this.high - this.low < 14) { const mid = (this.high + this.low) / 2; this.low = Math.floor(mid - 7); this.high = Math.ceil(mid + 7); }
    this.resize();
  }

  setLyrics(syllables: Syllable[]): void { this.syllables = syllables; }

  resize(): void {
    const ratio = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(200, rect.width);
    this.height = Math.max(120, rect.height);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    // Phones get a closer zoom so short notes stay readable.
    this.windowSeconds = this.width < 520 ? 4.5 : this.width < 800 ? 6 : 8;
  }

  /** Target note (MIDI) sung by the original artist at a song time. */
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

  displayMidi(midi: number, time: number): number {
    if (!this.flexibleOctave) return midi;
    const target = this.targetAt(time) ?? this.nearestNote(time);
    return target ? foldToOctave(midi, target.midi) : midi;
  }

  private nearestNote(time: number): NoteEvent | null {
    let best: NoteEvent | null = null;
    let distance = 3;
    for (const note of this.notes) {
      const d = Math.min(Math.abs(note.start - time), Math.abs(note.end - time));
      if (d < distance) { distance = d; best = note; }
      if (note.start > time + 3) break;
    }
    return best;
  }

  draw(now: number): void {
    const { ctx, width, height } = this;
    const style = getComputedStyle(this.canvas);
    const color = (name: string) => style.getPropertyValue(name).trim();
    const leftPad = 38;
    const lead = this.windowSeconds * 0.22;
    const t0 = now - lead;
    const t1 = t0 + this.windowSeconds;
    const x = (t: number) => leftPad + ((t - t0) / (t1 - t0)) * (width - leftPad);
    const rowHeight = height / (this.high - this.low + 1);
    const y = (midi: number) => height - (midi - this.low + 0.5) * rowHeight;

    ctx.clearRect(0, 0, width, height);
    const scale = this.key ? new Set(scalePitchClasses(this.key)) : null;
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let midi = this.low; midi <= this.high; midi += 1) {
      const pc = ((midi % 12) + 12) % 12;
      const inScale = scale ? scale.has(pc) : true;
      ctx.fillStyle = inScale ? color('--lane-row') : 'transparent';
      ctx.fillRect(leftPad, y(midi) - rowHeight / 2, width - leftPad, rowHeight - 1);
      if (pc === 0 || (rowHeight >= 13 && inScale)) {
        ctx.fillStyle = pc === 0 ? color('--text') : color('--muted');
        ctx.fillText(midiToNote(midi), 4, y(midi));
      }
    }

    // Original singer's notes.
    const active = this.targetAt(now);
    for (const note of this.notes) {
      if (note.end < t0) continue;
      if (note.start > t1) break;
      const left = x(note.start), right = x(note.end);
      const top = y(Math.round(note.midi)) - rowHeight * 0.42;
      const past = note.end < now;
      ctx.fillStyle = note === active ? color('--accent') : past ? color('--lane-past') : color('--lane-note');
      roundRect(ctx, left, top, Math.max(3, right - left - 1), rowHeight * 0.84, Math.min(6, rowHeight / 2));
      if (right - left > 26) {
        ctx.fillStyle = note === active ? color('--on-accent') : color('--lane-note-text');
        ctx.fillText(midiToNote(note.midi), left + 4, y(Math.round(note.midi)));
      }
    }

    // Syllables written above their note.
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    const taken: Array<{ left: number; right: number; top: number }> = [];
    for (const syllable of this.syllables) {
      if (syllable.end < t0 || syllable.text === '♪') continue;
      if (syllable.start > t1) break;
      const midi = syllable.midi ?? null;
      const top = Math.max(14, midi === null ? height - 4 : y(Math.round(midi)) - rowHeight * 0.5 - 2);
      const left = x(syllable.start);
      const right = left + ctx.measureText(syllable.text).width;
      // Skip labels that would collide with one already drawn (fast runs of short syllables).
      if (taken.some(box => Math.abs(box.top - top) < 13 && left < box.right + 3 && right > box.left - 3)) continue;
      taken.push({ left, right, top });
      ctx.fillStyle = syllable.start <= now && now < syllable.end ? color('--accent') : color('--text');
      ctx.fillText(syllable.text, left, top);
    }

    // Your voice.
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    let previous: { px: number; py: number; t: number } | null = null;
    for (const point of this.trail) {
      if (point.t < t0 || point.t > now + 0.05) { previous = null; continue; }
      const midi = this.displayMidi(point.midi, point.t);
      const target = this.targetAt(point.t);
      const error = target ? Math.abs(midi - target.midi) : null;
      const px = x(point.t), py = y(midi);
      ctx.strokeStyle = error === null ? color('--voice') : error <= 0.5 ? color('--good') : error <= 1.2 ? color('--close') : color('--off');
      if (previous && point.t - previous.t < 0.15) {
        ctx.beginPath();
        ctx.moveTo(previous.px, previous.py);
        ctx.lineTo(px, py);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(px, py, 1.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      previous = { px, py, t: point.t };
    }

    ctx.strokeStyle = color('--text');
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x(now), 0);
    ctx.lineTo(x(now), height);
    ctx.stroke();
    ctx.globalAlpha = 1;
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
