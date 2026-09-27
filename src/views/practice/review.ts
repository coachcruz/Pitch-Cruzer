import { decodeAudio, downloadBlob, encodeWav } from '../../lib/audio';
import { deleteTake, listTakes, saveSong, saveTake, type StoredSong, type StoredTake } from '../../lib/library';
import { Timeline, type Player, type Range } from '../../lib/player';
import { pitchTrackFor, type SongBuffers } from '../../lib/prepare';
import { coachingTip, mixdown, scoreTake, type TakeScore } from '../../lib/score';
import type { TrailPoint } from '../../ui/lane';
import { session } from '../../session';
import { el, escapeHtml, prefs, toast } from '../../ui/dom';
import { bestLine, lineText, safeName } from './text';

/** A take being reviewed: the recorded voice, where it sits against the song, and its score. */
export interface Review {
  voice: AudioBuffer;
  offset: number;
  baseOffset: number;
  ranges: Range[];
  repeats: number;
  timeline: Timeline;
  score: TakeScore;
  label: string;
  savedId?: string;
  singer?: string;
}

/** What the review needs from the practice screen. */
export interface ReviewHost {
  root: HTMLElement;
  song: StoredSong;
  buffers: SongBuffers;
  player: Player;
  levels: { lead: number; music: number; voice: number };
  forgiveOctave: () => boolean;
  /** Which song moments are scored (duet: only your lines). */
  counts: (sourceTime: number) => boolean;
  /** Plays the take with the song from `from` (timeline seconds). */
  playTake: (review: Review, from: number) => Promise<void>;
  stop: () => void;
  isPlayingTake: () => boolean;
  /** Shows a take's pitch line on the staff (null = back to the live line). */
  showTrail: (trail: TrailPoint[] | null) => void;
  /** Scores changed (lines get colored by how close you were). */
  changed: () => void;
}

/**
 * The review window: it opens the moment you stop recording with your score, what to work on,
 * listen-back, sync nudge, save (with your name) and download — plus everyone's saved takes as a
 * leaderboard.
 */
export class TakeReview {
  current: Review | null = null;
  private track: Awaited<ReturnType<typeof pitchTrackFor>> | null = null;
  private dialog: HTMLDialogElement;
  private panel: HTMLElement;

  constructor(private host: ReviewHost) {
    this.dialog = el<HTMLDialogElement>(host.root, '#reviewDialog');
    this.panel = el(host.root, '#review');
    this.dialog.addEventListener('close', () => { if (host.isPlayingTake()) host.stop(); });
    el(host.root, '#reviewDialogClose').addEventListener('click', () => this.dialog.close());
  }

  /** Opens the window: the take being reviewed (shown when there is one, or one is being scored) and the leaderboard. */
  open(withTake = Boolean(this.current)): void {
    this.panel.classList.toggle('hidden', !withTake);
    if (!this.dialog.open) this.dialog.showModal();
    void this.renderTakes();
  }

  close(): void { this.dialog.close(); }

  /** Forget the current take (e.g. the lyrics changed underneath it). */
  clear(): void {
    this.current = null;
    this.panel.classList.add('hidden');
  }

  /** Scores a fresh recording and shows it. */
  async fromRecording(voice: AudioBuffer, offset: number, ranges: Range[], repeats: number, label: string): Promise<void> {
    this.panel.innerHTML = '<p>Scoring your take…</p>';
    this.open(true);
    await this.build(voice, offset, ranges, repeats, label);
  }

  /** Re-scores the current take (after changing octave forgiveness, sync or duet parts). */
  rescore(): void {
    if (!this.current || !this.track) return;
    this.current.score = this.score(this.current.offset, this.current.timeline);
    this.render();
    this.host.changed();
  }

  refreshPlayButton(): void {
    const button = this.host.root.querySelector<HTMLButtonElement>('#reviewPlay');
    if (button) button.textContent = this.host.isPlayingTake() ? '■ Stop' : '▶ Listen to my take';
  }

  private score(offset: number, timeline: Timeline): TakeScore {
    const analysis = this.host.song.analysis;
    return scoreTake(this.track!, offset, timeline, analysis.notes, analysis.lines, this.host.forgiveOctave(), this.host.counts);
  }

  private async build(voice: AudioBuffer, offset: number, ranges: Range[], repeats: number, label: string, saved?: StoredTake): Promise<void> {
    const timeline = new Timeline(ranges, repeats);
    this.track = await pitchTrackFor(voice);
    this.current = { voice, offset, baseOffset: saved ? saved.offsetSeconds : offset, ranges, repeats, timeline, score: this.score(offset, timeline), label, savedId: saved?.id, singer: saved?.singer };
    this.render();
    this.host.changed();
  }

  private render(): void {
    const review = this.current;
    if (!review) return;
    const { host } = this;
    const s = review.score;
    const grade = s.score >= 85 ? 'Superstar' : s.score >= 70 ? 'Great' : s.score >= 50 ? 'Nice work' : s.score >= 30 ? 'Getting there' : 'Keep going';
    const cents = s.meanCents === null ? '—' : (Math.abs(s.meanCents) < 10 ? 'centered' : Math.abs(Math.round(s.meanCents)) + '¢ ' + (s.meanCents < 0 ? 'flat' : 'sharp'));
    const best = bestLine(s);
    const syncMs = Math.round((review.offset - review.baseOffset) * 1000);
    this.panel.innerHTML = `
      <div class="cardHead"><h2>Your take · ${escapeHtml(review.label)}</h2><button id="reviewDiscard" class="btn ghost small">${review.savedId ? 'Done' : 'Discard'}</button></div>
      <div class="scoreRow">
        <div class="bigScore"><strong>${s.score}</strong><span>${grade}</span></div>
        <div class="stats">
          <div><span>On the note</span><b>${s.onPitchWhenSinging}%</b></div>
          <div><span>Sang along</span><b>${s.coverage}%</b></div>
          <div><span>Average</span><b>${cents}</b></div>
          <div title="How evenly you hold each note (separate from hitting it)"><span>Steadiness</span><b>${s.steadiness === null ? '—' : s.steadiness + '%'}</b></div>
        </div>
      </div>
      <p id="progressNote" class="progressNote hidden"></p>
      ${s.vibrato.verdict ? `<p class="vibratoNote">〰 ${escapeHtml(s.vibrato.verdict)}</p>` : ''}
      ${best && best.percent >= 35 ? `<p class="bestLine">⭐ Your best line: <b>“${escapeHtml(lineText(best.line))}”</b> — ${best.percent}% <button id="playBest" class="chip">▶ Hear yourself</button></p>` : ''}
      <p class="tip">💡 ${escapeHtml(coachingTip(s))}</p>
      <div class="row wrap">
        <button id="reviewPlay" class="btn primary">▶ Listen to my take</button>
        <label class="inline">My voice <input id="voiceLevel" type="range" min="0" max="150" value="${host.levels.voice}"></label>
        <label class="inline" title="If your voice sounds early or late against the music, nudge it here">Sync <input id="syncOffset" type="range" min="-300" max="300" step="10" value="${syncMs}"><output id="syncOut">${syncMs} ms</output></label>
      </div>
      <div class="row wrap">
        <input id="singerName" class="textInput" placeholder="Singer name" value="${escapeHtml(review.singer ?? prefs.get('singer', ''))}" maxlength="40">
        <button id="saveTake" class="btn">${review.savedId ? 'Update saved take' : 'Save take'}</button>
        <button id="downloadMix" class="btn ghost">Download mix (WAV)</button>
        <button id="downloadVoice" class="btn ghost">Download my voice only</button>
      </div>
      <p class="hint small">In 🎤 Karaoke each line is now marked by how close you were — tap one to hear the original again.</p>`;
    void this.renderProgress();
    const panel = this.panel;

    panel.querySelector('#playBest')?.addEventListener('click', async () => {
      if (!best) return;
      const timeline = review.timeline;
      const piece = timeline.pieces.find(item => (!timeline.hasTurns || item.turn) && best.line.start >= item.sourceStart - 0.5 && best.line.start < item.sourceStart + item.duration);
      if (!piece) return;
      await host.playTake(review, piece.timelineStart + Math.max(0, best.line.start - 0.3 - piece.sourceStart));
      this.refreshPlayButton();
      window.setTimeout(() => { if (host.isPlayingTake()) host.stop(); }, (best.line.end - best.line.start + 1.2) * 1000);
    });
    el(panel, '#reviewDiscard').addEventListener('click', () => {
      if (!review.savedId && !confirm('Discard this take without saving it?')) return;
      if (host.isPlayingTake()) host.stop();
      this.clear();
      host.showTrail(null);
      host.changed();
      this.dialog.close();
    });
    el(panel, '#reviewPlay').addEventListener('click', async () => {
      if (host.isPlayingTake()) { host.stop(); return; }
      await host.playTake(review, 0);
      this.refreshPlayButton();
    });
    const voiceLevel = el<HTMLInputElement>(panel, '#voiceLevel');
    voiceLevel.addEventListener('input', () => {
      host.levels.voice = Number(voiceLevel.value);
      if (host.isPlayingTake()) host.player.setLevel('voice', host.levels.voice / 100);
    });
    const sync = el<HTMLInputElement>(panel, '#syncOffset');
    sync.addEventListener('input', () => { el(panel, '#syncOut').textContent = sync.value + ' ms'; });
    sync.addEventListener('change', () => {
      review.offset = review.baseOffset + Number(sync.value) / 1000;
      if (host.isPlayingTake()) host.stop();
      this.rescore();
    });
    el(panel, '#downloadMix').addEventListener('click', async () => {
      toast('Mixing your take…');
      const blob = await mixdown(host.buffers, review.timeline, { lead: host.levels.lead / 100, music: host.levels.music / 100, voice: host.levels.voice / 100 }, review.voice, review.offset);
      downloadBlob(blob, safeName(host.song.title + ' - ' + (el<HTMLInputElement>(panel, '#singerName').value || 'my take')) + '.wav');
    });
    el(panel, '#downloadVoice').addEventListener('click', () => {
      downloadBlob(encodeWav([review.voice.getChannelData(0)], review.voice.sampleRate), safeName(host.song.title + ' - my voice') + '.wav');
    });
    el(panel, '#saveTake').addEventListener('click', async () => {
      const singer = el<HTMLInputElement>(panel, '#singerName').value.trim() || 'Me';
      prefs.set('singer', singer);
      try {
        if (!session.saved) { await saveSong(host.song); session.saved = true; }
        const take: StoredTake = {
          id: review.savedId ?? crypto.randomUUID(),
          songId: host.song.id,
          singer,
          createdAt: Date.now(),
          score: review.score.score,
          label: review.label,
          voice: encodeWav([review.voice.getChannelData(0)], review.voice.sampleRate),
          sampleRate: review.voice.sampleRate,
          segments: review.ranges,
          offsetSeconds: review.offset
        };
        await saveTake(take);
        review.savedId = take.id;
        review.singer = singer;
        toast('Take saved for ' + singer + '.');
        this.render();
        void this.renderTakes();
      } catch { toast('Could not save the take (storage may be full).', 'error'); }
    });
  }

  /** Compare this take with your earlier ones on the same part — seeing progress builds confidence. */
  private async renderProgress(): Promise<void> {
    const current = this.current;
    if (!current || !session.saved) return;
    const singer = current.singer ?? prefs.get('singer', '');
    const earlier = (await listTakes(this.host.song.id).catch(() => [] as StoredTake[]))
      .filter(take => take.id !== current.savedId && take.label === current.label && (!singer || take.singer === singer))
      .sort((a, b) => b.createdAt - a.createdAt);
    const note = this.host.root.querySelector<HTMLElement>('#progressNote');
    if (!note || this.current !== current) return;
    const score = current.score.score;
    if (!earlier.length) note.textContent = '🌱 Your first saved take on this part — save it to track your progress.';
    else {
      const last = earlier[0].score;
      const best = Math.max(...earlier.map(take => take.score));
      note.textContent = score > last ? '📈 Up ' + (score - last) + ' points from your last take (' + last + ')' + (score > best ? ' — a new personal best!' : '.')
        : score === last ? '➡️ Same as your last take — nice and consistent.'
        : '💪 Your best here is ' + best + '. You’ve done it before — you can do it again.';
    }
    note.classList.remove('hidden');
  }

  /** Everyone's saved takes on this song, best first. */
  async renderTakes(): Promise<void> {
    const list = el(this.host.root, '#takesList');
    if (!session.saved) return;
    let takes: StoredTake[] = [];
    try { takes = await listTakes(this.host.song.id); } catch { return; }
    if (!takes.length) { list.innerHTML = '<p class="empty">Save a take to start your leaderboard — pass the mic around!</p>'; return; }
    list.innerHTML = '<ol class="board">' + takes.map((take, index) => `<li>
      <span class="rank">${index === 0 ? '🏆' : index + 1}</span>
      <span class="who"><b>${escapeHtml(take.singer)}</b><small>${escapeHtml(take.label)} · ${new Date(take.createdAt).toLocaleDateString()}</small></span>
      <span class="pts">${take.score}</span>
      <button class="btn ghost small" data-open-take="${take.id}">Open</button>
      <button class="btn ghost small" data-delete-take="${take.id}" aria-label="Delete take">✕</button></li>`).join('') + '</ol>';
    list.querySelectorAll<HTMLButtonElement>('[data-open-take]').forEach(button => button.addEventListener('click', async () => {
      const take = takes.find(item => item.id === button.dataset.openTake);
      if (!take) return;
      if (this.host.player.state !== 'stopped') this.host.stop();
      const voice = await decodeAudio(await take.voice.arrayBuffer());
      this.panel.classList.remove('hidden');
      await this.build(voice, take.offsetSeconds, take.segments, 1, take.label, take);
      this.dialog.scrollTop = 0;
    }));
    list.querySelectorAll<HTMLButtonElement>('[data-delete-take]').forEach(button => button.addEventListener('click', async () => {
      if (!confirm('Delete this take?')) return;
      await deleteTake(button.dataset.deleteTake!);
      void this.renderTakes();
    }));
  }
}
