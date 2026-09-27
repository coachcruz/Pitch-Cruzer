import { isTagLine, type LyricLine, type SongAnalysis } from '../../lib/analysis';
import { escapeHtml } from '../../ui/dom';
import { syllablesHtml } from './text';

export interface KaraokeState {
  inSelection: (time: number) => boolean;
  /** Per-line score (0–100) from the take being reviewed. */
  scores: Map<string, number> | null;
  /** Duet: who sings each line (absent = not a duet). */
  singer: ((line: LyricLine) => 'me' | 'partner') | null;
  /** Picking lines: the first line tapped. */
  anchor: LyricLine | null;
}

/**
 * The Karaoke view: big lyrics that roll upward on their own at an even speed and light up word by
 * word as they're sung. Scrolling by hand pauses the roll for a few seconds.
 */
export class Karaoke {
  private current: HTMLElement | null = null;
  private lastTime = NaN;
  private handScrollUntil = 0;
  /** While picking lines, the list stays where the person scrolls it. */
  holdScroll = false;

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
      if (target.closest('.who')) this.handlers.toggleSinger(line);
      else this.handlers.tap(line);
    });
  }

  render(state: KaraokeState): void {
    this.current = null;
    this.lastTime = NaN;
    let lastSection: string | null = null;
    this.list.innerHTML = this.analysis.lines.map(line => {
      const section = this.analysis.sections.find(item => line.start >= item.start && line.start < item.end);
      const header = section && section.id !== lastSection ? `<div class="lyricsSection">${escapeHtml(section.label)}</div>` : '';
      lastSection = section?.id ?? lastSection;
      const score = state.scores?.get(line.id);
      const who = line.words.every(word => word.aside) ? undefined : state.singer?.(line);
      const classes = ['lyricLine',
        state.inSelection(line.start + 0.01) ? '' : 'outside',
        state.anchor?.id === line.id ? 'anchor' : '',
        score === undefined ? '' : score >= 70 ? 'good' : score >= 40 ? 'ok' : 'bad',
        who === 'partner' ? 'partner' : '',
        isTagLine(line) ? 'tagLine' : line.words.every(word => word.aside) ? 'asideLine' : ''].filter(Boolean).join(' ');
      return header + `<div class="${classes}" data-line="${line.id}" role="button" tabindex="0">
        <span class="lineText">${syllablesHtml(line)}</span>
        ${who ? `<button class="who" title="Tap to switch who sings this line">${who === 'me' ? 'You' : 'Them'}</button>` : ''}
        ${score === undefined ? '' : `<span class="lineScore">${score}%</span>`}</div>`;
    }).join('') || '<p class="empty">No sung lines were found.</p>';
  }

  /** Called every frame while the Karaoke view is showing. */
  update(time: number, playing: boolean): void {
    const rows = [...this.list.querySelectorAll<HTMLElement>('.lyricLine')];
    const lines = this.analysis.lines;
    if (!rows.length || rows.length !== lines.length) return;
    let index = lines.findIndex(line => time < line.end);
    if (index < 0) index = lines.length - 1;
    const row = rows[index];
    if (row !== this.current) {
      rows.forEach((node, i) => node.classList.toggle('past', i < index));
      this.current?.querySelectorAll('.syl').forEach(node => node.classList.remove('now'));
      this.current = row;
    }
    // Light up the words of the current line as they're sung.
    row.querySelectorAll<HTMLElement>('.syl').forEach(node => {
      const start = Number(node.dataset.s), end = Number(node.dataset.e);
      node.classList.toggle('sung', time >= start);
      node.classList.toggle('now', time >= start && time < end + 0.05);
    });
    // Stopped: follow only when the position changes, so the list can be browsed.
    if (performance.now() < this.handScrollUntil || this.holdScroll || (!playing && time === this.lastTime)) return;
    this.lastTime = time;
    // Glide at an even speed from one line's start to the next, so the roll never jumps or stalls;
    // the line being sung sits about a third of the way down.
    let from = -1;
    for (let i = 0; i < lines.length && lines[i].start <= time; i += 1) from = i;
    const a = rows[Math.max(0, from)], b = rows[from + 1];
    const progress = from < 0 || !b ? 0 : Math.max(0, Math.min(1, (time - lines[from].start) / Math.max(0.1, lines[from + 1].start - lines[from].start)));
    const y = a.offsetTop + (b ? (b.offsetTop - a.offsetTop) * progress : 0);
    this.list.scrollTop = y - this.list.clientHeight * 0.36;
  }

  /** Forget the scroll position (e.g. after switching views) so the next update re-centers. */
  refollow(): void {
    this.current = null;
    this.lastTime = NaN;
  }
}
