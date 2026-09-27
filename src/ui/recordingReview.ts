import { formatTime } from '../lib/music';
import { trimmedWav, type Recording } from '../lib/tabcapture';
import { el } from './dom';

export interface ReviewActions {
  /** `title`: the song's name — used to name it and to look up its real lyrics. */
  use: (wav: Blob, title: string) => void;
  redo: () => void;
  discard: () => void;
}

/**
 * Check a tab recording before spending LALAL minutes on it: play it, trim the start/end
 * (pre-set to cut silence), record again, or prepare it.
 */
export function showRecordingReview(container: HTMLElement, recording: Recording, actions: ReviewActions, title = ''): () => void {
  const duration = recording.samples.length / recording.sampleRate;
  let start = recording.suggestedStart;
  let end = recording.suggestedEnd;
  let ctx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let playFrom = 0;
  let playStartedAt = 0;
  let frame = 0;

  container.innerHTML = `
    <div class="capReview">
      <div class="capHead"><strong>Your recording</strong><span id="capLength" class="hint small"></span></div>
      <label class="capName">Song name <input id="capTitle" class="textInput" placeholder="Song name and artist — used to find the real lyrics" maxlength="120"></label>
      <div class="row wrap">
        <button id="capPlay" class="btn">▶ Play</button>
        <span id="capPos" class="mono">0:00</span>
        <button id="capRedo" class="btn ghost">↺ Record again</button>
        <button id="capDiscard" class="btn ghost">Discard</button>
        <button id="capUse" class="btn primary">Prepare this song</button>
      </div>
      <details id="capTrim" class="capTrim" open>
        <summary>✂ Trim <span id="capTrimLabel"></span></summary>
        <p class="hint small">Drag the two handles. Only the highlighted part between them is used. Tap the waveform to listen from a spot.</p>
        <div id="trimTrack" class="trimTrack">
          <canvas id="capWave" aria-hidden="true"></canvas>
          <div id="trimRange" class="trimRange"></div>
          <button id="handleStart" class="trimHandle start" role="slider" aria-label="Trim start" aria-valuemin="0" aria-valuemax="${duration.toFixed(1)}"><span id="handleStartTime"></span></button>
          <button id="handleEnd" class="trimHandle end" role="slider" aria-label="Trim end" aria-valuemin="0" aria-valuemax="${duration.toFixed(1)}"><span id="handleEndTime"></span></button>
        </div>
        <div class="row wrap trimTools">
          <button id="trimStartHere" class="chip ghost">⇤ Start at playhead</button>
          <button id="trimEndHere" class="chip ghost">End at playhead ⇥</button>
          <button id="trimReset" class="chip ghost">Reset to automatic trim</button>
        </div>
      </details>
    </div>`;

  const canvas = el<HTMLCanvasElement>(container, '#capWave');
  const track = el(container, '#trimTrack');
  const handleStart = el<HTMLButtonElement>(container, '#handleStart');
  const handleEnd = el<HTMLButtonElement>(container, '#handleEnd');
  const rangeBox = el(container, '#trimRange');
  const MIN_KEEP = 1;
  const playButton = el<HTMLButtonElement>(container, '#capPlay');
  const position = el(container, '#capPos');

  // Waveform peaks, computed once per pixel column when the trim panel is drawn.
  let peaks: Float32Array | null = null;
  const computePeaks = (columns: number) => {
    peaks = new Float32Array(columns);
    const per = Math.max(1, Math.floor(recording.samples.length / columns));
    for (let c = 0; c < columns; c += 1) {
      let peak = 0;
      const from = c * per;
      for (let i = from; i < from + per && i < recording.samples.length; i += 8) peak = Math.max(peak, Math.abs(recording.samples[i]));
      peaks[c] = peak;
    }
  };

  const playhead = () => (source && ctx ? playFrom + (ctx.currentTime - playStartedAt) : playFrom);

  const draw = () => {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width) return;
    if (canvas.width !== Math.round(width * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      computePeaks(Math.round(width));
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    const style = getComputedStyle(canvas);
    g.clearRect(0, 0, width, height);
    const x = (t: number) => (t / duration) * width;
    g.fillStyle = style.getPropertyValue('--accent').trim();
    peaks?.forEach((peak, column) => {
      const h = Math.max(1, peak * height * 0.95);
      g.globalAlpha = column >= x(start) && column <= x(end) ? 0.9 : 0.25;
      g.fillRect(column, (height - h) / 2, 1, h);
    });
    // Dim the parts that will be cut off.
    g.globalAlpha = 0.6;
    g.fillStyle = style.getPropertyValue('--bg').trim();
    g.fillRect(0, 0, x(start), height);
    g.fillRect(x(end), 0, width - x(end), height);
    g.globalAlpha = 1;
    g.fillStyle = style.getPropertyValue('--text').trim();
    g.fillRect(x(playhead()), 0, 1.5, height);
  };

  const render = () => {
    const pct = (t: number) => ((t / duration) * 100).toFixed(3) + '%';
    handleStart.style.left = pct(start);
    handleEnd.style.left = pct(end);
    rangeBox.style.left = pct(start);
    rangeBox.style.width = (((end - start) / duration) * 100).toFixed(3) + '%';
    el(container, '#handleStartTime').textContent = formatTime(start);
    el(container, '#handleEndTime').textContent = formatTime(end);
    handleStart.setAttribute('aria-valuenow', start.toFixed(1));
    handleStart.setAttribute('aria-valuetext', formatTime(start));
    handleEnd.setAttribute('aria-valuenow', end.toFixed(1));
    handleEnd.setAttribute('aria-valuetext', formatTime(end));
    el(container, '#capTrimLabel').textContent = '(' + formatTime(start) + ' – ' + formatTime(end) + ')';
    el(container, '#capLength').textContent = 'keeping ' + formatTime(end - start) + ' of ' + formatTime(duration);
    position.textContent = formatTime(playhead() - start < 0 ? 0 : playhead() - start) + ' / ' + formatTime(end - start);
    draw();
  };

  const stopPlayback = () => {
    if (source) {
      playFrom = playhead();
      source.onended = null;
      try { source.stop(); } catch { /* already stopped */ }
      source = null;
    }
    cancelAnimationFrame(frame);
    playButton.textContent = '▶ Play';
    render();
  };

  const play = async (from: number) => {
    stopPlayback();
    ctx ??= new AudioContext();
    await ctx.resume();
    const buffer = ctx.createBuffer(1, recording.samples.length, recording.sampleRate);
    buffer.copyToChannel(recording.samples, 0);
    playFrom = Math.min(Math.max(from, start), end - 0.05);
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0, playFrom, end - playFrom);
    playStartedAt = ctx.currentTime;
    source.onended = () => { playFrom = start; source = null; stopPlayback(); };
    playButton.textContent = '❚❚ Pause';
    const tick = () => { render(); frame = requestAnimationFrame(tick); };
    tick();
  };

  playButton.addEventListener('click', () => (source ? stopPlayback() : void play(playFrom >= end - 0.1 ? start : playFrom)));
  // Dual-handle trim: drag either handle (touch, mouse or pen); tap the waveform to listen from there.
  const timeAt = (clientX: number) => {
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
  };
  const setStart = (value: number) => { start = Math.max(0, Math.min(value, end - MIN_KEEP)); if (!source) playFrom = start; render(); };
  const setEnd = (value: number) => { end = Math.min(duration, Math.max(value, start + MIN_KEEP)); render(); };
  const dragHandle = (handle: HTMLElement, set: (value: number) => void) => {
    handle.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('dragging');
      if (source) stopPlayback();
    });
    handle.addEventListener('pointermove', event => {
      if (handle.hasPointerCapture(event.pointerId)) set(timeAt(event.clientX));
    });
    const release = (event: PointerEvent) => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      handle.releasePointerCapture(event.pointerId);
      handle.classList.remove('dragging');
    };
    handle.addEventListener('pointerup', release);
    handle.addEventListener('pointercancel', release);
    handle.addEventListener('keydown', event => {
      const step = event.shiftKey ? 1 : 0.1;
      const current = handle === handleStart ? start : end;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); set(current - step); }
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); set(current + step); }
    });
  };
  dragHandle(handleStart, setStart);
  dragHandle(handleEnd, setEnd);
  track.addEventListener('click', event => {
    if ((event.target as HTMLElement).closest('.trimHandle')) return;
    void play(timeAt(event.clientX));
  });
  el(container, '#trimStartHere').addEventListener('click', () => setStart(playhead()));
  el(container, '#trimEndHere').addEventListener('click', () => { const at = playhead(); stopPlayback(); setEnd(at); });
  el(container, '#trimReset').addEventListener('click', () => { start = recording.suggestedStart; end = recording.suggestedEnd; render(); });
  el(container, '#capTrim').addEventListener('toggle', () => requestAnimationFrame(render));

  const close = () => {
    stopPlayback();
    void ctx?.close();
    ctx = null;
    container.innerHTML = '';
  };
  const titleInput = el<HTMLInputElement>(container, '#capTitle');
  titleInput.value = title;
  el(container, '#capUse').addEventListener('click', () => {
    const name = titleInput.value.trim();
    const wav = trimmedWav(recording, start, end);
    close();
    actions.use(wav, name);
  });
  el(container, '#capRedo').addEventListener('click', () => { close(); actions.redo(); });
  el(container, '#capDiscard').addEventListener('click', () => { close(); actions.discard(); });

  playFrom = start;
  render();
  return close;
}
