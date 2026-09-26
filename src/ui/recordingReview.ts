import { formatTime } from '../lib/music';
import { trimmedWav, type Recording } from '../lib/tabcapture';
import { el } from './dom';

export interface ReviewActions {
  use: (wav: Blob) => void;
  redo: () => void;
  discard: () => void;
}

/**
 * Check a tab recording before spending LALAL minutes on it: play it, trim the start/end
 * (pre-set to cut silence), record again, or prepare it.
 */
export function showRecordingReview(container: HTMLElement, recording: Recording, actions: ReviewActions): () => void {
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
      <div class="row wrap">
        <button id="capPlay" class="btn">▶ Play</button>
        <span id="capPos" class="mono">0:00</span>
        <button id="capRedo" class="btn ghost">↺ Record again</button>
        <button id="capDiscard" class="btn ghost">Discard</button>
        <button id="capUse" class="btn primary">Prepare this song</button>
      </div>
      <details id="capTrim" class="capTrim">
        <summary>✂ Trim <span id="capTrimLabel"></span></summary>
        <canvas id="capWave" aria-label="Waveform — click to play from a spot"></canvas>
        <div class="trimRow">
          <label>Start <input id="trimStart" type="range" min="0" max="${duration.toFixed(2)}" step="0.05"><output id="trimStartOut"></output></label>
          <button id="trimStartHere" class="chip ghost">Start at playhead</button>
        </div>
        <div class="trimRow">
          <label>End <input id="trimEnd" type="range" min="0" max="${duration.toFixed(2)}" step="0.05"><output id="trimEndOut"></output></label>
          <button id="trimEndHere" class="chip ghost">End at playhead</button>
        </div>
        <button id="trimReset" class="chip ghost">Reset to automatic trim</button>
      </details>
    </div>`;

  const canvas = el<HTMLCanvasElement>(container, '#capWave');
  const startInput = el<HTMLInputElement>(container, '#trimStart');
  const endInput = el<HTMLInputElement>(container, '#trimEnd');
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
    g.globalAlpha = 0.55;
    g.fillStyle = style.getPropertyValue('--bg').trim();
    g.fillRect(0, 0, x(start), height);
    g.fillRect(x(end), 0, width - x(end), height);
    g.globalAlpha = 1;
    g.fillStyle = style.getPropertyValue('--accent-2').trim();
    g.fillRect(x(start) - 1, 0, 2, height);
    g.fillRect(x(end) - 1, 0, 2, height);
    g.fillStyle = style.getPropertyValue('--text').trim();
    g.fillRect(x(playhead()), 0, 1.5, height);
  };

  const render = () => {
    startInput.value = String(start);
    endInput.value = String(end);
    el(container, '#trimStartOut').textContent = formatTime(start);
    el(container, '#trimEndOut').textContent = formatTime(end);
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
  canvas.addEventListener('click', event => {
    const rect = canvas.getBoundingClientRect();
    void play(((event.clientX - rect.left) / rect.width) * duration);
  });
  startInput.addEventListener('input', () => { start = Math.min(Number(startInput.value), end - 1); if (!source) playFrom = start; render(); });
  endInput.addEventListener('input', () => { end = Math.max(Number(endInput.value), start + 1); render(); });
  el(container, '#trimStartHere').addEventListener('click', () => { start = Math.min(playhead(), end - 1); render(); });
  el(container, '#trimEndHere').addEventListener('click', () => { end = Math.max(playhead(), start + 1); stopPlayback(); render(); });
  el(container, '#trimReset').addEventListener('click', () => { start = recording.suggestedStart; end = recording.suggestedEnd; render(); });
  el(container, '#capTrim').addEventListener('toggle', () => requestAnimationFrame(render));

  const close = () => {
    stopPlayback();
    void ctx?.close();
    ctx = null;
    container.innerHTML = '';
  };
  el(container, '#capUse').addEventListener('click', () => { const wav = trimmedWav(recording, start, end); close(); actions.use(wav); });
  el(container, '#capRedo').addEventListener('click', () => { close(); actions.redo(); });
  el(container, '#capDiscard').addEventListener('click', () => { close(); actions.discard(); });

  playFrom = start;
  render();
  return close;
}
