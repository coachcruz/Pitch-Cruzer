import { isTagLine, noteIndexAt, type LyricLine, type SongAnalysis } from '../../lib/analysis';
import { foldToOctave } from '../../lib/music';
import { escapeHtml } from '../../ui/dom';

/** Live pitch verdict for one frame, tallied while you sing — shown once per line, not per word. */
export type PitchVerdict = 'perfect' | 'blue' | 'red' | 'silent';

/** A finished line's verdict: the whole line's pitch, judged once. */
export type LineVerdict = 'perfect' | 'good' | 'ok' | 'bad' | 'silent';

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
  const mean = (tally.perfect + tally.blue * 0.5) / (voiced + tally.silent);
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

interface LineEntry {
  id: string;
  start: number;
  end: number;
  mine: boolean;
  el: HTMLElement;
  /** Cue dot elements with their beat times. */
  cues: { el: HTMLElement; beat: number }[];
  /** Word elements in order (non-aside only). */
  wordEls: HTMLElement[];
}

/** Vocal windows are independent of pitch: an unvoiced word must still finish its page. */
export function vocalWindow(line: LyricLine): { start: number; end: number } {
  const words = line.words.filter(word => !word.aside && Number.isFinite(word.start) && Number.isFinite(word.end));
  return words.length ? { start: Math.min(...words.map(w => w.start)), end: Math.max(...words.map(w => w.end)) }
    : { start: line.start, end: line.end };
}

export function karaokePageAt(pages: LyricLine[][], time: number): number {
  let page = 0;
  while (page < pages.length - 1 && time >= Math.max(...pages[page].map(line => vocalWindow(line).end))) page++;
  return page;
}

interface WordEntry {
  el: HTMLElement;
  /** First note index this word is stapled to (null: unbound). */
  noteIndex: number | null;
  /** The word's vocal onset — when this word fills. */
  wordStart: number;
  /** The note's start time (for pitch reference). */
  noteStart: number;
  /** The note's end time. */
  noteEnd: number;
  /** Expected MIDI for pitch grading (null: spoken/aside). */
  midi: number | null;
  lastFill: number;
}

/**
 * The Karaoke view: static pages of lyrics (4 lines each) — no scrolling. Each word fills
 * whole the moment its note sounds, judged word by word as you sing. The page flips when
 * its last word is done. Pitch is tallied per line and each line gets its verdict color
 * when finished: purple with a shine for perfect, green/blue/red, yellow for silent.
 *
 * Word timing comes from the note binding: each word is stapled to the artist's note
 * (via its timestamp-anchored noteIndex), and the note's start time is when the word fills.
 * Nothing here guesses at timing — the notes are the authority.
 */
export class Karaoke {
  /** Lines per static page. */
  private static readonly PAGE_SIZE = 4;

  private pages: LyricLine[][] = [];
  private pageIndex = -1;
  private words: WordEntry[] = [];
  /** Note index → the word stapled to it. */
  private byNoteIndex = new Map<number, WordEntry>();
  /** Cached per-line DOM refs — built once per page, never queried per frame. */
  private lines: LineEntry[] = [];
  private finishedWords = new Set<HTMLElement>();
  /** Pitch frames tallied per line for verdicts. */
  private tallies = new Map<string, { perfect: number; blue: number; red: number; silent: number }>();
  private finishedLines = new Set<string>();
  private lastTime = NaN;
  private sectionCoach: ((sectionId: string) => void) | undefined;
  private state: KaraokeState | null = null;

  constructor(
    private list: HTMLElement,
    private analysis: SongAnalysis,
    private handlers: { tap: (line: LyricLine) => void; toggleSinger: (line: LyricLine) => void }
  ) {
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
    this.state = state;
    this.sectionCoach = state.onSectionCoach;
    this.pageIndex = -1;
    this.lastTime = NaN;
    // Static centered pages: no scrolling, no tilt.
    this.list.classList.add('karaokeStatic');
    // Group sung lines into pages.
    const sung = this.analysis.lines.filter(l => !isTagLine(l));
    this.pages = [];
    for (let i = 0; i < sung.length; i += Karaoke.PAGE_SIZE) {
      this.pages.push(sung.slice(i, i + Karaoke.PAGE_SIZE));
    }
    this.tallies = new Map();
    this.finishedLines = new Set();
    this.finishedWords = new Set();
    this.showPage(0);
  }

  /** Render one page of lines into the list. */
  private showPage(index: number): void {
    if (index < 0 || index >= this.pages.length) return;
    this.pageIndex = index;
    const state = this.state!;
    const page = this.pages[index];
    let lastSection: string | null = null;
    this.list.innerHTML = page.map(line => {
      const section = this.analysis.sections.find(item => line.start >= item.start && line.start < item.end);
      const header = section && section.id !== lastSection ? `<div class="lyricsSection">${escapeHtml(section.label)}</div>` : '';
      lastSection = section?.id ?? lastSection;
      const score = state.scores?.get(line.id);
      const kept = state.building?.kept.get(line.id);
      const who = line.words.every(word => word.aside) ? undefined : state.singer?.(line);
      const names = state.singerNames ?? { me: 'You', partner: 'Them' };
      const classes = ['lyricLine', 'karaokePage',
        state.inSelection(line.start + 0.01) ? '' : 'outside',
        state.anchor?.id === line.id ? 'anchor' : '',
        state.building?.current === line.id ? 'building' : '',
        kept === undefined ? '' : 'kept',
        score === undefined ? '' : score >= 70 ? 'good' : score >= 40 ? 'ok' : 'bad',
        who === 'partner' ? 'partner' : '',
        isTagLine(line) ? 'tagLine' : line.words.every(word => word.aside) ? 'asideLine' : ''].filter(Boolean).join(' ');
      return header + `<div class="${classes}" data-line="${escapeHtml(line.id)}" role="button" tabindex="0">
        ${state.cues.has(line.id) ? `<span class="cueDots" aria-hidden="true">${'<i></i>'.repeat(state.cues.get(line.id)!.length)}</span>` : ''}
        <span class="lineText">${this.wordsHtml(line)}</span>
        ${who ? `<button class="who" title="Tap to switch who sings this line — now ${escapeHtml(who === 'me' ? names.me : names.partner)}">${escapeHtml(who === 'me' ? names.me : names.partner)}</button>` : ''}
        ${score === undefined ? '' : `<button class="lineScore" data-coach="${escapeHtml(section?.id ?? '')}" title="How this section went — tap for coaching" type="button">${score}%</button>`}
        ${kept === undefined ? '' : `<span class="keptScore" title="Kept for your song">✓ ${kept}%</span>`}</div>`;
    }).join('') || '<p class="empty">No sung lines were found.</p>';

    // Index words by their note binding.
    this.words = [];
    this.byNoteIndex = new Map();
    const notes = this.analysis.notes;
    for (const el of this.list.querySelectorAll<HTMLElement>('.kword')) {
      const rawN = el.dataset.n;
      const noteIndex = rawN === undefined || rawN === '' ? null : Number(rawN);
      const note = noteIndex !== null ? notes[noteIndex] : null;
      const rawM = el.dataset.m;
      const entry: WordEntry = {
        el,
        noteIndex,
        wordStart: el.dataset.ws !== undefined && el.dataset.ws !== '' ? Number(el.dataset.ws) : NaN,
        noteStart: note ? note.start : NaN,
        noteEnd: note ? note.end : NaN,
        midi: rawM === undefined || rawM === '' ? null : Number(rawM),
        lastFill: -1,
      };
      this.words.push(entry);
      if (noteIndex !== null && !this.byNoteIndex.has(noteIndex)) {
        this.byNoteIndex.set(noteIndex, entry);
      }
    }

    // Cache per-line DOM refs once — update() must not query the DOM per frame.
    this.lines = [];
    for (const lineEl of this.list.querySelectorAll<HTMLElement>('.lyricLine[data-line]')) {
      const lineId = lineEl.dataset.line;
      if (!lineId) continue;
      const beats = this.state?.cues.get(lineId) ?? [];
      const dots = [...lineEl.querySelectorAll<HTMLElement>('.cueDots i')];
      const data = page.find(line => line.id === lineId)!;
      this.lines.push({
        id: lineId,
        ...vocalWindow(data),
        mine: state.singer?.(data) !== 'partner',
        el: lineEl,
        cues: dots.map((el, i) => ({ el, beat: beats[i] ?? Infinity })),
        wordEls: [...lineEl.querySelectorAll<HTMLElement>('.kword:not(.aside)')],
      });
    }
  }

  /** Words as individual fillable spans (word-level fill, not letter-by-letter). */
  private wordsHtml(line: LyricLine): string {
    return line.words.map(word => {
      if (word.aside) return `<span class="kword aside">${escapeHtml(word.text)}</span>`;
      const first = word.syllables[0];
      const n = first?.noteIndex;
      const m = first?.midi;
      return `<span class="kword" data-n="${n ?? ''}" data-m="${m ?? ''}" data-ws="${word.start}">${escapeHtml(word.text)}</span>`;
    }).join(' ');
  }

  /**
   * Called every frame while the Karaoke view is showing. `sung` is the live mic pitch
   * (null when nothing heard) — undefined when the mic is off.
   *
   * Static pages: words fill whole when their note sounds. The page flips when done.
   * Pitch is tallied per word and each line is judged once when its words are all sung.
   */
  update(time: number, playing: boolean, sung?: number | null, flexibleOctave = false): void {
    if (!this.pages.length) return;
    // Seeked back: reset to the page containing this time.
    if (time < this.lastTime - 0.05) {
      this.finishedWords = new Set();
      this.finishedLines = new Set();
      this.tallies = new Map();
      this.showPage(karaokePageAt(this.pages, time));
    }
    const elapsed = Number.isFinite(this.lastTime) ? Math.max(0, Math.min(0.1, time - this.lastTime)) : 0;
    this.lastTime = time;
    // Finish visible rows before replacing their DOM at a page boundary.
    this.finishLines(time);
    const page = karaokePageAt(this.pages, time);
    if (page !== this.pageIndex) this.showPage(page);

    const notes = this.analysis.notes;

    // Word fill: a word is filled (1) once its vocal onset passes, empty (0) before.
    // Word-level — the whole word engulfs at once, no letter-by-letter wipe.
    // Uses word.start (vocal onset), not the note start.
    for (const entry of this.words) {
      if (this.finishedWords.has(entry.el)) continue;
      const fill = Number.isNaN(entry.wordStart)
        ? 0
        : time >= entry.wordStart ? 1 : 0;
      if (fill !== entry.lastFill) {
        entry.lastFill = fill;
        entry.el.style.setProperty('--fill', String(fill));
        entry.el.classList.toggle('sung', fill === 1);
      }
    }

    // Cue dots: light up each dot as its beat time passes (cached refs, no DOM queries).
    for (const line of this.lines) {
      for (const cue of line.cues) {
        cue.el.classList.toggle('on', time >= cue.beat);
      }
    }

    // Pitch tally per line: while a line's notes sound, compare mic pitch to expected.
    if (playing && sung !== undefined && elapsed > 0) {
      const sounding = noteIndexAt(notes, time);
      if (sounding !== null) {
        const line = this.lines.find(line => line.mine && time >= line.start && time < line.end);
        const lineId = line?.id;
        if (lineId && !this.finishedLines.has(lineId)) {
          const note = notes[sounding];
          const verdict = pitchVerdict(sung, note.midi, time - note.start, flexibleOctave);
          const tally = this.tallies.get(lineId) ?? { perfect: 0, blue: 0, red: 0, silent: 0 };
          if (verdict) tally[verdict] += elapsed;
          this.tallies.set(lineId, tally);
        }
      }
    }

    this.finishLines(time);
  }

  private finishLines(time: number): void {
    for (const line of this.lines) {
      if (this.finishedLines.has(line.id)) continue;
      if (!line.wordEls.length) continue;
      if (time >= line.end) {
        this.finishedLines.add(line.id);
        const verdict = lineVerdict(this.tallies.get(line.id) ?? { perfect: 0, blue: 0, red: 0, silent: 0 });
        if (verdict) line.el.classList.add('lv-' + verdict);
      }
    }
  }

  /** Forget state (e.g. after switching views) so the next update starts fresh. */
  refollow(): void {
    this.lastTime = NaN;
  }
}
