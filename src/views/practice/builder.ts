import type { LyricLine } from '../../lib/analysis';
import { assembleSpan, lineFeedback, stitchVocal, turnPlan, type KeptLine, type TurnPlan } from '../../lib/assemble';
import { decodeAudio, downloadBlob, encodeWav } from '../../lib/audio';
import { buildLineId, clearBuild, listBuildLines, saveBuildLine, type StoredBuildLine, type StoredSong } from '../../lib/library';
import type { LiveMic } from '../../lib/mic';
import { encodeMp3 } from '../../lib/mp3';
import { Timeline, type Player, type Range } from '../../lib/player';
import { pitchTrackFor, type SongBuffers } from '../../lib/prepare';
import { scoreTake, type TakeScore } from '../../lib/score';
import { el, escapeHtml, prefs, toast } from '../../ui/dom';
import { safeName } from './text';
import { roundTrip } from '../../lib/sync';

/**
 * Build my song: Echo, line by line, into a finished recording. You pick a line in the Karaoke lyrics,
 * listen to the artist sing it, then sing it back: the artist's last words of the line before cue you
 * in, and hand over to you right where your line starts. Then your score and one coaching note (or
 * praise when it's earned) — keep it and go on, or try again. Kept lines are saved on this device, so
 * a song can be built over several sittings. "Put my song together" joins your kept lines —
 * cross-faded, at even loudness — over the music (see lib/assemble).
 */

export interface BuilderHost {
  root: HTMLElement;
  song: StoredSong;
  buffers: SongBuffers;
  player: Player;
  mic: LiveMic;
  levels: { lead: number; music: number; monitor: number };
  enableMic: () => Promise<boolean>;
  forgiveOctave: () => boolean;
  /** Your lines (in a duet, not your partner's). */
  isMine: (line: LyricLine) => boolean;
  /** Before the builder plays: the staff shows the live voice line from scratch. */
  beforePlay: () => void;
  /** Mix and monitor back to what the settings say. */
  restoreMix: () => void;
  beep: (when: number, accent: boolean) => void;
  /** Show this song moment (the lyrics scroll to it) while stopped. */
  show: (time: number) => void;
  /** Switch to the Karaoke lyrics, where lines are picked. */
  openKaraoke: () => void;
  /** The current line or the kept lines changed: the lyrics re-mark them. */
  linesChanged: () => void;
  /** The builder started or stopped something (the controls update). */
  changed: () => void;
}

type Phase = 'ready' | 'listening' | 'recording' | 'scoring' | 'result' | 'hearing' | 'assembling';

interface Attempt { voice: AudioBuffer; offset: number; range: Range; score: TakeScore }

const sung = (line: LyricLine) => line.words.filter(word => !word.aside && word.text !== '♪');

export class SongBuilder {
  private phase: Phase = 'ready';
  private lines: LyricLine[] = [];
  private index = 0;
  private kept = new Map<string, StoredBuildLine>();
  private attempt: Attempt | null = null;
  private recordOrigin = 0;
  private recordRange: Range = { start: 0, end: 0 };
  private cancelled = false;
  private result: { url: string; blob: Blob; label: string } | null = null;
  private opts = {
    music: prefs.get('build.music', true),
    hear: prefs.get('build.hear', false),
    highlight: prefs.get('build.highlight', true)
  };
  private panel: HTMLElement;

  constructor(private host: BuilderHost) {
    this.panel = el(host.root, '#builder');
    this.panel.addEventListener('click', event => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (target) void this.act(target.dataset.act!);
    });
    this.panel.addEventListener('change', event => {
      const input = event.target as HTMLInputElement;
      const option = input.dataset.opt as keyof SongBuilder['opts'] | undefined;
      if (!option) return;
      this.opts[option] = input.checked;
      prefs.set('build.' + option, input.checked);
      this.render();
    });
  }

  get isOpen(): boolean { return !this.panel.classList.contains('hidden'); }
  /** Playing, recording, scoring or joining — the practice controls step back meanwhile. */
  get active(): boolean { return this.phase !== 'ready' && this.phase !== 'result'; }
  /** Something would be lost by leaving now (see lib/update). */
  get busy(): boolean { return this.active || (this.phase === 'result' && this.attempt !== null); }

  /** For the Karaoke lyrics: the line being built, and the kept lines with their scores. */
  get marks(): { current: string; kept: Map<string, number> } | null {
    if (!this.isOpen || !this.line) return null;
    const kept = new Map<string, number>();
    for (const line of this.lines) {
      const stored = this.kept.get(this.keyOf(line));
      if (stored) kept.set(line.id, stored.score);
    }
    return { current: this.line.id, kept };
  }

  async open(): Promise<void> {
    this.lines = this.host.song.analysis.lines.filter(line => this.host.isMine(line) && sung(line).length > 0);
    if (!this.lines.length) { toast('This song has no lyric lines yet — the builder goes line by line. Fix the lyrics first (⋯ → Fix lyrics).', 'error'); return; }
    this.panel.classList.remove('hidden');
    this.host.root.querySelector('#stage')?.classList.add('withBuilder');
    this.host.openKaraoke();
    this.kept.clear();
    for (const line of await listBuildLines(this.host.song.id).catch(() => [])) this.kept.set(line.id, line);
    const firstOpen = this.lines.findIndex(line => !this.kept.has(this.keyOf(line)));
    this.goTo(firstOpen < 0 ? 0 : firstOpen);
  }

  close(): void {
    if (this.active) { this.cancelled = true; this.host.player.stop(true); }
    this.panel.classList.add('hidden');
    this.host.root.querySelector('#stage')?.classList.remove('withBuilder');
    this.attempt = null;
    this.phase = 'ready';
    this.host.changed();
    this.host.linesChanged();
  }

  /** A line tapped in the lyrics: build that one. False if it isn't a line you sing. */
  pick(line: LyricLine): boolean {
    const index = this.lines.findIndex(item => item.id === line.id);
    if (index < 0) return false;
    if (!this.active) this.goTo(index);
    return true;
  }

  /** The practice screen's player finished (or was stopped): true if it was the builder's. */
  playerEnded(): boolean {
    if (this.phase === 'recording') { void this.finishRecording(); return true; }
    if (this.phase === 'listening' || this.phase === 'hearing') {
      this.phase = this.attempt ? 'result' : 'ready';
      this.host.restoreMix();
      this.render();
      this.host.changed();
      return true;
    }
    return false;
  }

  /** Every frame: light up the words of the line as they're sung. */
  update(now: number): void {
    if (!this.isOpen || !this.opts.highlight) return;
    const playing = this.phase === 'listening' || this.phase === 'recording' || this.phase === 'hearing';
    this.panel.querySelectorAll<HTMLElement>('.bWord').forEach(word => {
      const start = Number(word.dataset.s), end = Number(word.dataset.e);
      word.classList.toggle('sung', playing && now >= start);
      word.classList.toggle('now', playing && now >= start && now < end + 0.1);
    });
  }

  private keyOf(line: LyricLine): string { return buildLineId(this.host.song.id, line.start); }
  private get line(): LyricLine { return this.lines[this.index]; }
  private plan(): TurnPlan { return turnPlan(this.host.song.analysis.lines, this.line, this.host.song.analysis.duration); }

  private goTo(index: number): void {
    if (this.active) return;
    this.index = Math.max(0, Math.min(this.lines.length - 1, index));
    this.attempt = null;
    this.phase = 'ready';
    this.host.show(this.plan().start);
    this.render();
    this.host.linesChanged();
  }

  private async act(action: string): Promise<void> {
    if (action === 'close') this.close();
    else if (action === 'listen') await this.listen();
    else if (action === 'sing' || action === 'retry') await this.record();
    else if (action === 'hear') await this.hear();
    else if (action === 'stop') { this.cancelled = this.phase === 'recording'; this.host.player.stop(true); }
    else if (action === 'keep') await this.keep();
    else if (action === 'prev') this.goTo(this.index - 1);
    else if (action === 'next') this.goTo(this.index + 1);
    else if (action === 'assemble') await this.assemble();
    else if (action === 'download' && this.result) downloadBlob(this.result.blob, safeName(this.host.song.title) + ' - my version' + this.result.label + '.mp3');
    else if (action === 'startOver') {
      if (!confirm('Forget all the lines you kept for this song and start over?')) return;
      await clearBuild(this.host.song.id);
      this.kept.clear();
      this.goTo(0);
    }
  }

  // ------------------------------------------------------------------ playing
  /** The music at the settings' level — or full, if the settings have it off (the builder's Music box is what counts here). */
  private musicLevel(): number {
    if (!this.host.buffers.instrumental && !this.host.buffers.backing) return 0;
    return this.host.levels.music > 5 ? this.host.levels.music / 100 : 1;
  }

  /** The artist sings the line (with the cue before it). Music off: the artist's voice alone. */
  private async listen(): Promise<void> {
    const { player } = this.host;
    const plan = this.plan();
    this.host.beforePlay();
    player.setLevel('lead', 1);
    player.setLevel('music', this.opts.music ? this.musicLevel() : 0);
    player.setLevel('voice', 0);
    this.phase = 'listening';
    this.render();
    this.host.changed();
    await player.play([{ start: plan.start, end: plan.end }], 1);
  }

  /** Your turn: the artist's cue, then you sing the line (music under it, or quiet). */
  private async record(): Promise<void> {
    const { player, mic } = this.host;
    if (!(await this.host.enableMic())) return;
    if (!mic.canRecord) { toast('This browser can’t record here. Try Chrome, Edge or Safari.', 'error'); return; }
    const plan = this.plan();
    const range = { start: plan.start, end: plan.end };
    this.host.beforePlay();
    player.setLevel('lead', plan.cueFrom === null ? 0 : 1);
    player.setLevel('music', this.opts.music ? this.musicLevel() : 0);
    player.setLevel('voice', 0);
    mic.setMonitor(this.opts.hear ? Math.max(0.6, this.host.levels.monitor / 100) : 0);
    this.cancelled = false;
    this.attempt = null;
    this.recordRange = range;
    this.phase = 'recording';
    this.render();
    this.host.changed();
    mic.startRecording();
    const origin = await player.play([range], 1, { leadIn: 0.15 });
    this.recordOrigin = origin;
    const lineAt = origin + (plan.lineStart - plan.start);
    if (plan.cueFrom !== null) player.handOver('lead', lineAt);   // the artist's cue stops where your line starts
    else if (!this.opts.music) {
      // No cue and no music: three beeps count you in.
      [1.8, 1.2, 0.6].forEach((before, i) => { if (lineAt - before > player.ctx.currentTime) this.host.beep(lineAt - before, i === 0); });
    }
  }

  private async finishRecording(): Promise<void> {
    const { player, mic } = this.host;
    const result = mic.stopRecording();
    this.host.restoreMix();
    const range = this.recordRange;
    if (this.cancelled || !result || result.samples.length < result.sampleRate * 0.5) {
      if (!this.cancelled) toast('No audio was recorded from the mic.', 'error');
      this.phase = 'ready';
      this.render();
      this.host.changed();
      return;
    }
    this.phase = 'scoring';
    this.render();
    // What you sang at clock time T answers music you heard at T − output latency − input latency.
    const latency = roundTrip(player.ctx);   // measured by the Sync check (Bluetooth!), or what the browser reports
    const voice = player.ctx.createBuffer(1, result.samples.length, result.sampleRate);
    voice.copyToChannel(result.samples, 0);
    const offset = result.startTime - this.recordOrigin - latency;
    const analysis = this.host.song.analysis;
    const line = this.line;
    const track = await pitchTrackFor(voice);
    const score = scoreTake(track, offset, new Timeline([range], 1), analysis.notes, analysis.lines, this.host.forgiveOctave(),
      time => time >= line.start - 0.1 && time <= line.end + 0.1);
    this.attempt = { voice, offset, range, score };
    this.phase = 'result';
    this.render();
    this.host.changed();
  }

  private async hear(): Promise<void> {
    if (!this.attempt) return;
    const { player } = this.host;
    this.host.beforePlay();
    player.setLevel('lead', 0);
    player.setLevel('music', this.opts.music ? this.musicLevel() : 0);
    player.setLevel('voice', 1);
    this.phase = 'hearing';
    this.render();
    this.host.changed();
    await player.play([this.attempt.range], 1, { voice: { buffer: this.attempt.voice, offset: this.attempt.offset } });
  }

  private async keep(): Promise<void> {
    const attempt = this.attempt;
    if (!attempt) return;
    const line = this.line;
    const kept: StoredBuildLine = {
      id: this.keyOf(line), songId: this.host.song.id, start: line.start, end: line.end,
      text: sung(line).map(word => word.text).join(' '), score: attempt.score.score,
      voice: encodeWav([attempt.voice.getChannelData(0)], attempt.voice.sampleRate),
      songTimeAtStart: attempt.range.start + attempt.offset, createdAt: Date.now()
    };
    try { await saveBuildLine(kept); } catch { toast('This device is out of space — the line couldn’t be kept.', 'error'); return; }
    this.kept.set(kept.id, kept);
    const next = this.lines.findIndex((item, i) => i > this.index && !this.kept.has(this.keyOf(item)));
    if (next >= 0) this.goTo(next);
    else if (this.index < this.lines.length - 1) this.goTo(this.index + 1);
    else { this.attempt = null; this.phase = 'ready'; this.render(); this.host.linesChanged(); toast('That was the last line — put your song together below.'); }
  }

  // ------------------------------------------------------------------ putting it together
  /** The kept lines of this song (a line whose lyrics changed since is matched by its start time). */
  private keptLines(): StoredBuildLine[] {
    return this.lines.map(line => this.kept.get(this.keyOf(line))).filter((line): line is StoredBuildLine => Boolean(line));
  }

  private async assemble(): Promise<void> {
    const { song, buffers } = this.host;
    const stored = this.keptLines();
    if (!stored.length) return;
    const span = assembleSpan(stored, this.lines.length, song.analysis.duration);
    this.phase = 'assembling';
    this.render();
    this.host.changed();
    try {
      const kept: KeptLine[] = await Promise.all(stored.map(async line => {
        const buffer = await decodeAudio(await line.voice.arrayBuffer());
        return { start: line.start, end: line.end, samples: buffer.getChannelData(0), sampleRate: buffer.sampleRate, songTimeAtStart: line.songTimeAtStart };
      }));
      const sampleRate = buffers.lead.sampleRate;
      const from = Math.floor(span.start * sampleRate), to = Math.ceil(span.end * sampleRate);
      const vocal = stitchVocal(kept, song.analysis.duration, sampleRate).slice(from, to);
      const length = vocal.length;
      const offline = new OfflineAudioContext(2, length, sampleRate);
      // The music under your voice: the instrumental and backing vocals (not separated: none).
      const music = [buffers.instrumental, buffers.backing].filter((buffer): buffer is AudioBuffer => buffer !== null);
      const musicGain = offline.createGain();
      musicGain.gain.value = this.musicLevel() * 0.8;
      musicGain.connect(offline.destination);
      for (const buffer of music) {
        const node = offline.createBufferSource();
        node.buffer = buffer;
        node.connect(musicGain);
        node.start(0, span.start);
      }
      const voiceBuffer = offline.createBuffer(1, length, sampleRate);
      voiceBuffer.copyToChannel(vocal, 0);
      const voice = offline.createBufferSource();
      voice.buffer = voiceBuffer;
      voice.connect(offline.destination);
      voice.start(0);
      const rendered = await offline.startRendering();
      const channels = [rendered.getChannelData(0), rendered.getChannelData(1)];
      let peak = 0;
      for (const channel of channels) for (let i = 0; i < channel.length; i += 1) peak = Math.max(peak, Math.abs(channel[i]));
      const scale = peak > 0.98 ? 0.98 / peak : 1;
      // Part of a song: fade in and out, so it doesn't start or stop mid-note.
      const fadeIn = span.whole ? 0 : Math.round(0.4 * sampleRate), fadeOut = span.whole ? 0 : Math.round(1.5 * sampleRate);
      for (const channel of channels) {
        for (let i = 0; i < channel.length; i += 1) {
          const edge = Math.min(1, fadeIn ? i / fadeIn : 1, fadeOut ? (channel.length - 1 - i) / fadeOut : 1);
          channel[i] *= scale * edge;
        }
      }
      const blob = await encodeMp3(channels, sampleRate, 192);
      if (this.result) URL.revokeObjectURL(this.result.url);
      this.result = { blob, url: URL.createObjectURL(blob), label: span.whole ? '' : ' (part)' };
      if (!span.whole) toast('Put together the part you’ve sung so far. The whole song comes once every line is kept.');
      else if (!music.length) toast('This song wasn’t separated, so there’s no music track to put under your voice — it’s your voice alone.');
    } catch (error) {
      console.error(error);
      toast('Couldn’t put the song together' + (error instanceof Error ? ': ' + error.message : '.'), 'error');
    }
    this.phase = 'ready';
    this.render();
    this.host.changed();
  }

  // ------------------------------------------------------------------ the panel
  private render(): void {
    const line = this.line;
    if (!line) return;
    const phase = this.phase;
    const busy = this.active;
    const keptHere = this.kept.get(this.keyOf(line));
    const keptCount = this.keptLines().length;
    const all = keptCount === this.lines.length;
    const tone = (score: number) => (score >= 70 ? 'good' : score >= 45 ? 'close' : 'off');
    const plan = this.plan();
    const cueWords = plan.cueFrom === null ? '' : this.host.song.analysis.lines.flatMap(sung)
      .filter(word => word.start >= plan.cueFrom! - 0.01 && word.end <= plan.lineStart + 0.05).map(word => word.text).join(' ');
    const words = sung(line).map(word => `<span class="bWord" data-s="${word.start.toFixed(3)}" data-e="${word.end.toFixed(3)}">${escapeHtml(word.text)}</span>`).join(' ');
    const option = (key: keyof SongBuilder['opts'], label: string, hint: string) =>
      `<label class="check small" title="${escapeHtml(hint)}"><input type="checkbox" data-opt="${key}" ${this.opts[key] ? 'checked' : ''} ${busy ? 'disabled' : ''}> ${label}</label>`;

    let body = '';
    if (phase === 'listening' || phase === 'hearing') body = `<p class="bStatus">${phase === 'listening' ? 'Listening to the artist…' : 'Your take…'}</p><div class="bBar"><button class="btn" data-act="stop">■ Stop</button></div>`;
    else if (phase === 'recording') body = `<p class="bStatus live">${plan.cueFrom === null ? 'Get ready — your turn after the count-in' : 'Your turn comes right after the artist’s cue'}</p><div class="bBar"><button class="btn" data-act="stop">■ Stop</button></div>`;
    else if (phase === 'scoring') body = '<p class="bStatus">Checking how it went…</p>';
    else if (phase === 'assembling') body = '<p class="bStatus">Putting your song together…</p>';
    else if (phase === 'result' && this.attempt) {
      const feedback = lineFeedback(this.attempt.score);
      body = `<div class="bResult"><span class="bScore ${tone(this.attempt.score.score)}">${this.attempt.score.score}%</span>
          <div><strong>${escapeHtml(feedback.headline)}</strong><p>${escapeHtml(feedback.note)}</p></div></div>
        <div class="bBar">
          <button class="btn primary" data-act="keep">Keep &amp; next</button>
          <button class="btn" data-act="retry">Try again</button>
          <button class="btn" data-act="hear">Hear my take</button>
          <button class="btn" data-act="listen">Original</button>
        </div>`;
    } else {
      body = `${keptHere ? `<p class="bMeta">Kept at ${keptHere.score}%. Sing it again to replace it, or pick another line.</p>` : ''}
        <div class="bBar">
          <button class="btn" data-act="listen">▶ Listen</button>
          <button class="btn primary" data-act="sing">● Sing</button>
          <span class="bNav">
            <button class="btn" data-act="prev" ${this.index === 0 ? 'disabled' : ''} title="Previous line" aria-label="Previous line">◀</button>
            <button class="btn" data-act="next" ${this.index === this.lines.length - 1 ? 'disabled' : ''} title="Next line" aria-label="Next line">▶</button>
          </span>
        </div>`;
    }

    this.panel.innerHTML = `
      <div class="bHead"><h2>Build my song</h2>
        <span class="bMeta">Line ${this.index + 1} of ${this.lines.length} · ${keptCount} kept</span>
        <button class="btn bClose" data-act="close" aria-label="Close the builder" ${busy ? 'disabled' : ''}>✕</button></div>
      <p class="bLine ${this.opts.highlight ? 'highlight' : ''}">${words}</p>
      <p class="bMeta">${cueWords ? `Cue: the artist sings “…${escapeHtml(cueWords)}”, then it’s you.` : this.opts.music ? 'Cue: the music counts you in.' : 'Cue: three beeps count you in.'}</p>
      ${body}
      <div class="bOpts">
        ${option('music', 'Music', 'Off: hear the artist alone, and sing in the quiet')}
        ${option('hear', 'Hear myself', 'Hear your own mic while you sing')}
        ${option('highlight', 'Highlight words', 'Light up the words as they’re sung')}
      </div>
      <div class="bFoot">
        <p class="bMeta">Tap any line in the lyrics to pick it.</p>
        <div class="bBar">
          <button class="btn ${all ? 'primary' : ''}" data-act="assemble" ${keptCount && !busy ? '' : 'disabled'}>${all ? 'Put my song together' : 'Put together what I’ve sung'}</button>
          ${keptCount ? `<button class="btn" data-act="startOver" ${busy ? 'disabled' : ''}>Start over</button>` : ''}
        </div>
        ${this.result ? `<audio controls src="${this.result.url}"></audio><div class="bBar"><button class="btn" data-act="download">⬇ Download</button></div>` : ''}
      </div>`;
    this.update(-1);
  }
}
