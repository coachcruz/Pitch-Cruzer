import { isTagLine, noteAt, type LyricLine, type NoteEvent, type SongAnalysis } from '../../lib/analysis';
import { foldToOctave } from '../../lib/music';
import { escapeHtml } from '../../ui/dom';
import { syllablesHtml } from './text';

/** Live pitch verdict for one syllable, painted while you sing. */
export type PitchVerdict = 'perfect' | 'blue' | 'red' | 'silent';

/**
 * How the sung pitch compares to the expected note. One comparison, one set of colors, everywhere:
 * the staff trail, the karaoke words and take scoring all ask this same question. "Perfect" is a
 * quarter tone. Blue means close but not quite there — or the right note in the wrong octave, but
 * only when octave forgiveness is on (without it, a wrong octave is red, like the staff). Red is a
 * different note altogether. Silent is no voice heard over the word. Returns null inside a short
 * grace at the word's attack, so late entries aren't punished instantly.
 */
export function pitchVerdict(sung: number | null, expected: number, intoWord: number, flexibleOctave = false): PitchVerdict | null {
  if (sung === null) return intoWord >= 0.15 ? 'silent' : null;
  const compared = flexibleOctave ? foldToOctave(sung, expected) : sung;
  const err = Math.abs(compared - expected);
  if (err <= 0.5) return 'perfect';
  if (err <= 1.0) return 'blue';
  return 'red';
}

/**
 * Sung syllables begin with a consonant transition (~30–120 ms) before the pitch stabilizes,
 * but note onsets mark stable pitch. The lyric highlight fires at the acoustic onset — a fixed
 * perceptual lead — so words light up as they're sung, not a consonant late. Grading is
 * untouched: it reads the pitch, which starts at the note.
 */
export const HIGHLIGHT_LEAD = 0.07;

/** The moment a syllable's highlight fires: its note onset pulled back to the acoustic onset. */
export function highlightStart(start: number): number { return start - HIGHLIGHT_LEAD; }

/**
 * Safety net for the word highlight: syllable starts are note onsets by construction now —
 * every syllable is bound to a run of the measured notes — so this usually changes nothing. It
 * stays for songs bound by older versions and odd cases, pulling the highlight to a nearby onset
 * when one is close so the lyrics light up with the singer.
 */
export function snapToNoteOnset(start: number, end: number, notes: NoteEvent[]): number {
  let best = start, bestDist = 0.25;
  for (const note of notes) {
    const dist = Math.abs(note.start - start);
    if (dist < bestDist && note.start < end - 0.05) { best = note.start; bestDist = dist; }
  }
  return best;
}

export interface KaraokeState {
  inSelection: (time: number) => boolean;
  /** Per-line score (0–100) from the take being reviewed. */
  scores: Map<string, number> | null;
  /** Duet: who sings each line (absent = not a duet). */
  singer: ((line: LyricLine) => 'me' | 'partner') | null;
  /** Duet: the singers' names (absent = not a duet; defaults to You/Them). */
  singerNames?: { me: string; partner: string } | null;
  /** Tap a line's score: show coaching for the whole section that line is in. */
  onSectionCoach?: (sectionId: string) => void;
  /** Picking lines: the first line tapped. */
  anchor: LyricLine | null;
  /** Silent count-in dots before lines (beat times). */
  cues: Map<string, number[]>;
  /** Build my song: the line being built, and the kept lines with their scores. */
  building?: { current: string; kept: Map<string, number> } | null;
}

interface SylEntry {
  el: HTMLElement;
  row: HTMLElement;
  /** Highlight start, snapped to the vocal's note onset. */
  start: number;
  end: number;
  /** The note the singer is supposed to sing (null: spoken/aside, no verdict). */
  midi: number | null;
}

/**
 * The Karaoke view: big lyrics that roll upward on their own at an even speed and light up word by
 * word as they're sung. Scrolling by hand pauses the roll for a few seconds. With the mic on, each
 * word also reacts to the live pitch: green for on pitch, blue for close or the right note in the
 * wrong octave, red for a wrong note, yellow when no voice is heard — and a line sung perfectly
 * all the way through glows purple.
 */
export class Karaoke {
  private current: HTMLElement | null = null;
  private cueRows: Array<{ row: HTMLElement; dots: number[]; entry: number }> = [];
  private lastTime = NaN;
  private handScrollUntil = 0;
  /** While picking lines, the list stays where the person scrolls it. */
  holdScroll = false;
  private syls: SylEntry[] = [];
  private byEl = new Map<HTMLElement, SylEntry>();
  private sylsByRow = new Map<HTMLElement, SylEntry[]>();
  private verdicts = new Map<HTMLElement, PitchVerdict>();
  private locked = new Set<HTMLElement>();
  private finishedRows = new Set<HTMLElement>();
  private pitchOn = false;
  private pitchTime = NaN;
  private sectionCoach: ((sectionId: string) => void) | undefined;

  constructor(
    private list: HTMLElement,
    private analysis: SongAnalysis,
    private handlers: { tap: (line: LyricLine) => void; toggleSinger: (line: LyricLine) => void }
  ) {
    const pause = () => { this.handScrollUntil = performance.now() + 4000; };
    ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(type => list.addEventListener(type, pause, { passive: true }));
    list.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>('[data-line]');
      const line = row && this.analysis.lines.find(item => item.id === row.dataset.line);
      if (!line) return;
      const coach = target.closest<HTMLElement>('[data-coach]');
      if (coach?.dataset.coach && this.sectionCoach) { this.sectionCoach(coach.dataset.coach); return; }
      if (target.closest('.who')) this.handlers.toggleSinger(line);
      else this.handlers.tap(line);
    });
  }

  render(state: KaraokeState): void {
    this.current = null;
    this.lastTime = NaN;
    this.sectionCoach = state.onSectionCoach;
    let lastSection: string | null = null;
    this.list.innerHTML = this.analysis.lines.map(line => {
      const section = this.analysis.sections.find(item => line.start >= item.start && line.start < item.end);
      const header = section && section.id !== lastSection ? `<div class="lyricsSection">${escapeHtml(section.label)}</div>` : '';
      lastSection = section?.id ?? lastSection;
      const score = state.scores?.get(line.id);
      const kept = state.building?.kept.get(line.id);
      const who = line.words.every(word => word.aside) ? undefined : state.singer?.(line);
      const names = state.singerNames ?? { me: 'You', partner: 'Them' };
      const classes = ['lyricLine',
        state.inSelection(line.start + 0.01) ? '' : 'outside',
        state.anchor?.id === line.id ? 'anchor' : '',
        state.building?.current === line.id ? 'building' : '',
        kept === undefined ? '' : 'kept',
        score === undefined ? '' : score >= 70 ? 'good' : score >= 40 ? 'ok' : 'bad',
        who === 'partner' ? 'partner' : '',
        isTagLine(line) ? 'tagLine' : line.words.every(word => word.aside) ? 'asideLine' : ''].filter(Boolean).join(' ');
      return header + `<div class="${classes}" data-line="${line.id}" role="button" tabindex="0">
        ${state.cues.has(line.id) ? `<span class="cueDots" aria-hidden="true">${'<i></i>'.repeat(state.cues.get(line.id)!.length)}</span>` : ''}
        <span class="lineText">${syllablesHtml(line)}</span>
        ${who ? `<button class="who" title="Tap to switch who sings this line — now ${escapeHtml(who === 'me' ? names.me : names.partner)}">${escapeHtml(who === 'me' ? names.me : names.partner)}</button>` : ''}
        ${score === undefined ? '' : `<button class="lineScore" data-coach="${section?.id ?? ''}" title="How this section went — tap for coaching" type="button">${score}%</button>`}
        ${kept === undefined ? '' : `<span class="keptScore" title="Kept for your song">✓ ${kept}%</span>`}</div>`;
    }).join('') || '<p class="empty">No sung lines were found.</p>';
    this.cueRows = [...state.cues.entries()].flatMap(([id, dots]) => {
      const row = this.list.querySelector<HTMLElement>(`[data-line="${id}"] .cueDots`);
      const line = this.analysis.lines.find(item => item.id === id);
      return row && line ? [{ row, dots, entry: line.start }] : [];
    });
    // Index the syllables for the pitch layer (fresh slate: new DOM, no verdicts yet).
    this.syls = [];
    this.byEl = new Map();
    this.sylsByRow = new Map();
    this.resetPitch();
    for (const el of this.list.querySelectorAll<HTMLElement>('.syl')) {
      const row = el.closest<HTMLElement>('.lyricLine');
      if (!row) continue;
      const start = Number(el.dataset.s), end = Number(el.dataset.e);
      const raw = el.dataset.m;
      const midi = raw === undefined || raw === '' ? null : Number(raw);
      const entry: SylEntry = { el, row, start: snapToNoteOnset(start, end, this.analysis.notes), end, midi };
      this.syls.push(entry);
      this.byEl.set(el, entry);
      const group = this.sylsByRow.get(row) ?? [];
      group.push(entry);
      this.sylsByRow.set(row, group);
    }
  }

  private setVerdict(el: HTMLElement, verdict: PitchVerdict | null): void {
    const prev = this.verdicts.get(el);
    if (prev === verdict) return;
    if (prev) el.classList.remove('pitch-' + prev);
    if (verdict) {
      el.classList.add('pitch-' + verdict);
      this.verdicts.set(el, verdict);
    } else {
      this.verdicts.delete(el);
    }
  }

  /** A syllable's window has passed: keep its final color and stop judging it. */
  private lockSyl(entry: SylEntry): void {
    this.locked.add(entry.el);
    if (!this.verdicts.has(entry.el) && entry.midi !== null) this.setVerdict(entry.el, 'silent');
  }

  /** The line is done: lock every syllable, and glow purple if all of them were perfect. */
  private finishLine(row: HTMLElement): void {
    let judged = 0, perfect = 0;
    for (const entry of this.sylsByRow.get(row) ?? []) {
      if (entry.midi === null) continue;
      if (!this.locked.has(entry.el)) this.lockSyl(entry);
      judged += 1;
      if (this.verdicts.get(entry.el) === 'perfect') perfect += 1;
    }
    if (judged > 0 && perfect === judged) row.classList.add('linePerfect');
  }

  private resetPitch(): void {
    for (const el of this.verdicts.keys()) {
      const verdict = this.verdicts.get(el)!;
      el.classList.remove('pitch-' + verdict);
    }
    this.verdicts = new Map();
    this.locked = new Set();
    this.finishedRows = new Set();
    this.pitchOn = false;
    this.pitchTime = NaN;
    this.list.querySelectorAll('.linePerfect').forEach(row => row.classList.remove('linePerfect'));
  }

  /** Live pitch layer: paint the current line's words from the mic, lock each word as it passes. */
  private updatePitch(time: number, row: HTMLElement, sung: number | null | undefined, flexibleOctave: boolean): void {
    if (sung === undefined) {
      if (this.pitchOn) this.resetPitch();
      return;
    }
    this.pitchOn = true;
    if (time < this.pitchTime - 0.5) this.resetPitch();   // jumped back: fresh slate
    this.pitchTime = time;
    for (const entry of this.sylsByRow.get(row) ?? []) {
      if (entry.midi === null || this.locked.has(entry.el)) continue;
      if (time > entry.end + 0.15) { this.lockSyl(entry); continue; }
      if (time < entry.start - 0.1) continue;
      // The expected pitch is the artist's note sounding now — the same lookup take scoring
      // and the staff use — not the note the word's time window overlapped when the lyrics were
      // written. Lyric timestamps can be off by ~100-200 ms (transcription), which used to pull
      // the wrong note in here and grade a right note wrong.
      const target = noteAt(this.analysis.notes, time);
      if (!target) continue;
      this.setVerdict(entry.el, pitchVerdict(sung, target.midi, time - entry.start, flexibleOctave));
    }
  }

  /**
   * Called every frame while the Karaoke view is showing. `sung` is the live mic pitch
   * (vibrato-centered, null when nothing is heard) — undefined when the mic is off, in which
   * case no pitch colors are painted. `flexibleOctave` is the "Forgive octave" setting, so the
   * live colors match take scoring.
   */
  update(time: number, playing: boolean, sung?: number | null, flexibleOctave = false): void {
    // Silent count-in: the dots over the coming line light up on the beats before it.
    for (const cue of this.cueRows) {
      const showing = time >= cue.dots[0] - 1.5 && time < cue.entry + 0.2;
      cue.row.classList.toggle('show', showing);
      if (showing) cue.row.querySelectorAll('i').forEach((dot, k) => dot.classList.toggle('on', time >= cue.dots[k]));
    }
    const rows = [...this.list.querySelectorAll<HTMLElement>('.lyricLine')];
    const lines = this.analysis.lines;
    if (!rows.length || rows.length !== lines.length) return;
    // Bad data must never silently kill the view: lines with broken times are skipped, and if
    // none qualifies, fall back to the nearest line by start instead of leaving every word white.
    let index = lines.findIndex(line => Number.isFinite(line.end) && time < line.end);
    if (index < 0) {
      let best = 0, bestDist = Infinity;
      lines.forEach((line, i) => {
        if (!Number.isFinite(line.start)) return;
        const dist = Math.abs(line.start - time);
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      index = best;
    }
    const row = rows[index];
    if (row !== this.current) {
      if (this.current) {
        this.finishLine(this.current);
        this.finishedRows.add(this.current);
      }
      rows.forEach((node, i) => node.classList.toggle('past', i < index));
      this.current?.querySelectorAll('.syl').forEach(node => node.classList.remove('now'));
      this.current = row;
    }
    // Light up the words of the current line as they're sung (snapped to the vocal's note onsets,
    // firing at the acoustic onset via the highlight lead).
    row.querySelectorAll<HTMLElement>('.syl').forEach(node => {
      const entry = this.byEl.get(node);
      const start = highlightStart(entry?.start ?? Number(node.dataset.s));
      const end = entry?.end ?? Number(node.dataset.e);
      node.classList.toggle('sung', time >= start);
      node.classList.toggle('now', time >= start && time < end + 0.05);
    });
    this.updatePitch(time, row, sung, flexibleOctave);
    // The last line never triggers a line change: finish it once every word is judged.
    if (!this.finishedRows.has(row)) {
      const entries = this.sylsByRow.get(row) ?? [];
      if (entries.length && entries.every(entry => entry.midi === null || this.locked.has(entry.el))) {
        this.finishLine(row);
        this.finishedRows.add(row);
      }
    }
    // Stopped: follow only when the position changes, so the list can be browsed.
    if (performance.now() < this.handScrollUntil || this.holdScroll || (!playing && time === this.lastTime)) return;
    this.lastTime = time;
    // Glide at an even speed from one line's start to the next, so the roll never jumps or stalls;
    // the line being sung sits about a third of the way down. A line with a broken start is
    // skipped — never a wall the scroll dies on.
    let from = -1;
    for (let i = 0; i < lines.length; i += 1) {
      const start = lines[i].start;
      if (Number.isFinite(start) && start <= time) from = i;
    }
    const a = rows[Math.max(0, from)], b = rows[from + 1];
    const nextStart = b ? lines[from + 1].start : NaN;
    const progress = from < 0 || !Number.isFinite(nextStart) ? 0 : Math.max(0, Math.min(1, (time - lines[from].start) / Math.max(0.1, nextStart - lines[from].start)));
    const y = a.offsetTop + (b ? (b.offsetTop - a.offsetTop) * progress : 0);
    this.list.scrollTop = y - this.list.clientHeight * 0.36;
  }

  /** Forget the scroll position (e.g. after switching views) so the next update re-centers. */
  refollow(): void {
    this.current = null;
    this.lastTime = NaN;
  }
}
