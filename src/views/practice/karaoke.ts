import { isTagLine, noteIndexAt, nextNoteIndexAt, type LyricLine, type SongAnalysis } from '../../lib/analysis';
import { foldToOctave } from '../../lib/music';
import { escapeHtml } from '../../ui/dom';
import { syllablesHtml } from './text';

/** Live pitch verdict for one frame, tallied while you sing — shown once per line, not per word. */
export type PitchVerdict = 'perfect' | 'blue' | 'red' | 'silent';

/** A finished line's verdict: the whole line's pitch, judged once. */
export type LineVerdict = 'perfect' | 'good' | 'ok' | 'bad' | 'silent';

/**
 * How the sung pitch compares to the expected note. One comparison, one set of colors, everywhere:
 * the staff trail, the karaoke words and take scoring all ask this same question. "Perfect" is a
 * quarter tone. Blue means close but not quite there — or the right note in the wrong octave, but
 * only when octave forgiveness is on (without it, a wrong octave is red, like the staff). Red is a
 * different note altogether. Silent is no voice heard over the word. Returns null inside a short
 * grace at the word's attack, so late entries aren't punished instantly.
 */

/**
 * The liquid fill for one syllable: 0 before its note run starts, 1 after it ends,
 * sweeping continuously across the run in between. Because the run is the syllable's full
 * bound note span (not the currently sounding note), the wipe never restarts mid-word —
 * it's one unbroken line through the song, slower through longer notes.
 */
export function fillForRun(runStart: number, runEnd: number, time: number): number {
  return Math.max(0, Math.min(1, (time - runStart) / Math.max(0.05, runEnd - runStart)));
}

export function pitchVerdict(sung: number | null, expected: number, intoWord: number, flexibleOctave = false): PitchVerdict | null {
  if (sung === null) return intoWord >= 0.15 ? 'silent' : null;
  const compared = flexibleOctave ? foldToOctave(sung, expected) : sung;
  const err = Math.abs(compared - expected);
  if (err <= 0.5) return 'perfect';
  if (err <= 1.0) return 'blue';
  return 'red';
}

/**
 * Judges a finished line from its pitch tally: frames of each verdict while its notes sounded.
 * Purple only when every voiced frame was perfect; green/blue/red by mean score; yellow when the
 * line was mostly sung in silence. Null when the mic was off — no judgment without a singer.
 */
export function lineVerdict(tally: { perfect: number; blue: number; red: number; silent: number }): LineVerdict | null {
  const voiced = tally.perfect + tally.blue + tally.red;
  if (voiced + tally.silent === 0) return null;
  if (tally.silent > voiced) return 'silent';
  const mean = (tally.perfect + tally.blue * 0.5) / voiced;
  if (mean === 1) return 'perfect';
  if (mean >= 0.75) return 'good';
  if (mean >= 0.4) return 'ok';
  return 'bad';
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
  /** Structural binding: first/last note indices this syllable is stapled to (null: unbound). */
  noteIndex: number | null;
  noteEnd: number | null;
  /** The note the singer is supposed to sing (null: spoken/aside, no verdict). */
  midi: number | null;
}

/**
 * The Karaoke view: big lyrics that roll upward on their own and fill like liquid as they're
 * sung — the fill follows the sounding note, so longer notes fill slower. Nothing here reads
 * lyric timestamps: the active line is the line holding the sounding note's syllable, found
 * through the structural note binding. Pitch is tallied silently while you sing and each line
 * is judged once when it's done: purple with a shine for a perfect line, green/blue/red for
 * the rest, yellow when no voice was heard. Scrolling by hand pauses the roll for a few seconds.
 */
export class Karaoke {
  private current: HTMLElement | null = null;
  private cueRows: Array<{ row: HTMLElement; dots: number[]; entry: number }> = [];
  private lastTime = NaN;
  private handScrollUntil = 0;
  /** While picking lines, the list stays where the person scrolls it. */
  holdScroll = false;
  private syls: SylEntry[] = [];
  /** Note index → the syllable stapled to it. The showtime path follows notes, never timestamps. */
  private byNoteIndex = new Map<number, SylEntry>();
  private sylsByRow = new Map<HTMLElement, SylEntry[]>();
  private finishedRows = new Set<HTMLElement>();
  /** Pitch frames tallied for the current line's verdict. */
  private tally = { perfect: 0, blue: 0, red: 0, silent: 0 };
  private lastNoteTime = NaN;
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
      // The line's entry is its first bound note's start — structure, not a stored timestamp.
      const firstBound = line?.words.flatMap(word => word.syllables).find(syl => syl.noteIndex !== null);
      const entry = firstBound?.noteIndex !== null && firstBound?.noteIndex !== undefined
        ? this.analysis.notes[firstBound.noteIndex]?.start ?? NaN : NaN;
      return row && Number.isFinite(entry) ? [{ row, dots, entry }] : [];
    });
    // Index the syllables by note: the showtime path follows notes, never timestamps.
    this.syls = [];
    this.byNoteIndex = new Map();
    this.sylsByRow = new Map();
    this.resetJudgment();
    for (const el of this.list.querySelectorAll<HTMLElement>('.syl')) {
      const row = el.closest<HTMLElement>('.lyricLine');
      if (!row) continue;
      const rawN = el.dataset.n, rawNe = el.dataset.ne, raw = el.dataset.m;
      const noteIndex = rawN === undefined || rawN === '' ? null : Number(rawN);
      const noteEnd = rawNe === undefined || rawNe === '' ? null : Number(rawNe);
      const midi = raw === undefined || raw === '' ? null : Number(raw);
      const entry: SylEntry = { el, row, noteIndex, noteEnd, midi };
      this.syls.push(entry);
      if (noteIndex !== null && noteEnd !== null) {
        for (let i = noteIndex; i <= noteEnd; i += 1) {
          if (!this.byNoteIndex.has(i)) this.byNoteIndex.set(i, entry);
        }
      }
      const group = this.sylsByRow.get(row) ?? [];
      group.push(entry);
      this.sylsByRow.set(row, group);
    }
  }

  /** The line is done: fill it fully and judge it once, from the whole line's pitch. */
  private finishRow(row: HTMLElement): void {
    if (this.finishedRows.has(row)) return;
    this.finishedRows.add(row);
    for (const entry of this.sylsByRow.get(row) ?? []) entry.el.style.setProperty('--fill', '1');
    const verdict = lineVerdict(this.tally);
    if (verdict) row.classList.add('lv-' + verdict);
    this.tally = { perfect: 0, blue: 0, red: 0, silent: 0 };
  }

  /** Seeked back (or re-rendered): clear every judgment and start the slate fresh. */
  private resetJudgment(): void {
    this.list.querySelectorAll('.lv-perfect,.lv-good,.lv-ok,.lv-bad,.lv-silent').forEach(row => {
      row.classList.remove('lv-perfect', 'lv-good', 'lv-ok', 'lv-bad', 'lv-silent');
    });
    for (const entry of this.syls) entry.el.style.setProperty('--fill', '0');
    this.finishedRows = new Set();
    this.tally = { perfect: 0, blue: 0, red: 0, silent: 0 };
    this.current = null;
  }

  /**
   * Called every frame while the Karaoke view is showing. `sung` is the live mic pitch
   * (vibrato-centered, null when nothing is heard) — undefined when the mic is off, in which
   * case nothing is tallied and lines get no verdict. `flexibleOctave` is the "Forgive octave"
   * setting, so the line verdicts match take scoring.
   *
   * The showtime path follows notes, never lyric timestamps: the sounding note's syllable
   * decides the active line, the note's span drives the liquid fill, and the pitch tally
   * judges each line once when it's done.
   */
  update(time: number, playing: boolean, sung?: number | null, flexibleOctave = false): void {
    // Silent count-in: the dots over the coming line light up on the beats before it.
    for (const cue of this.cueRows) {
      const showing = time >= cue.dots[0] - 1.5 && time < cue.entry + 0.2;
      cue.row.classList.toggle('show', showing);
      if (showing) cue.row.querySelectorAll('i').forEach((dot, k) => dot.classList.toggle('on', time >= cue.dots[k]));
    }
    const rows = [...this.list.querySelectorAll<HTMLElement>('.lyricLine')];
    if (!rows.length) return;
    // Seeked back: fresh slate.
    if (time < this.lastNoteTime - 0.5) this.resetJudgment();
    this.lastNoteTime = time;

    // What's being sung: the sounding note → its syllable → its line.
    const notes = this.analysis.notes;
    const sounding = noteIndexAt(notes, time);
    let row: HTMLElement | null = sounding !== null ? this.byNoteIndex.get(sounding)?.row ?? null : null;
    if (!row) {
      // Rest: read ahead to the next sung line so the singer sees what's coming.
      const next = nextNoteIndexAt(notes, time);
      row = (next !== null ? this.byNoteIndex.get(next)?.row : undefined) ?? this.current;
    }
    if (!row) return;

    if (row !== this.current) {
      if (this.current) this.finishRow(this.current);
      const index = rows.indexOf(row);
      rows.forEach((node, i) => node.classList.toggle('past', i < index));
      this.current = row;
    }

    // Liquid fill: one continuous wipe through the whole song. Each syllable fills across
    // its FULL bound note run (first note's start to last note's end), so the sweep never
    // restarts mid-word — longer notes fill slower, exactly as sung. Past syllables read 1,
    // future ones 0, all from the same clock.
    for (const entry of this.syls) {
      let fill = 0;
      if (entry.noteIndex !== null && entry.noteEnd !== null) {
        fill = fillForRun(notes[entry.noteIndex].start, notes[entry.noteEnd].end, time);
      }
      entry.el.style.setProperty('--fill', fill.toFixed(3));
    }

    // Pitch tally for the line verdict (mic on only): judged per frame, shown once at line end.
    // The expected pitch is the artist's note sounding now — the same lookup take scoring and
    // the staff use.
    if (sung !== undefined && sounding !== null) {
      const note = notes[sounding];
      const entry = this.byNoteIndex.get(sounding);
      if (entry && entry.midi !== null) {
        const verdict = pitchVerdict(sung, note.midi, time - note.start, flexibleOctave);
        if (verdict === 'perfect') this.tally.perfect += 1;
        else if (verdict === 'blue') this.tally.blue += 1;
        else if (verdict === 'red') this.tally.red += 1;
        else if (verdict === 'silent') this.tally.silent += 1;
      }
    }

    // The last line never triggers a row change: finish it once its notes are done.
    if (row === rows[rows.length - 1] && !this.finishedRows.has(row)) {
      const lastNote = notes[notes.length - 1];
      if (!lastNote || time >= lastNote.end) this.finishRow(row);
    }

    // Scroll: the active row eases to a third of the way down. Stopped: follow only when the
    // position changes, so the list can be browsed.
    if (performance.now() >= this.handScrollUntil && !this.holdScroll && (playing || time !== this.lastTime)) {
      const target = row.offsetTop - this.list.clientHeight * 0.36;
      this.list.scrollTop += (target - this.list.scrollTop) * 0.15;
    }
    this.lastTime = time;
  }

  /** Forget the scroll position (e.g. after switching views) so the next update re-centers. */
  refollow(): void {
    this.current = null;
    this.lastTime = NaN;
  }
}
