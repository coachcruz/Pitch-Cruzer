import { LiveMic } from '../lib/mic';
import { midiToFrequency, midiToNote, NOTE_NAMES, voiceTypeNames, voiceTypesFor } from '../lib/music';
import { el, prefs, toast } from '../ui/dom';

/** A simple, friendly tuner: sing a note and see it, or pick a target and match it. */
export function renderTuner(root: HTMLElement): () => void {
  root.innerHTML = `
  <section class="card tuner">
    <div class="cardHead"><h2>Tuner</h2><span class="hint small">Warm up, find your range, or match a single note</span></div>
    <div class="tunerNote"><strong id="tNote">—</strong><span id="tHz">Sing any note</span></div>
    <div class="cents"><div class="zone"></div><div id="tNeedle" class="needle"></div></div>
    <div class="centsLabels"><span>Flat (too low)</span><span>In tune</span><span>Sharp (too high)</span></div>
    <p id="tHint" class="tip center">Turn on the mic and sing “ahh”.</p>
    <div class="row center wrap">
      <button id="tMic" class="btn primary big">🎤 Start mic</button>
      <label class="inline">Target
        <select id="tTarget"><option value="">Any note</option></select></label>
      <button id="tTone" class="btn">Play target</button>
    </div>
    <div class="rangeBox"><span>Your range so far</span><strong id="tRange">—</strong><button id="tReset" class="btn ghost small">Reset</button></div>
    <p id="tVoice" class="hint center">Sing your lowest and highest comfortable notes to see your voice type.</p>
  </section>

  <section class="card warmup">
    <div class="cardHead"><h2>Range warm-up</h2><span class="hint small">1–2 minutes · listen, then match each note</span></div>
    <p class="hint">Practicing across a whole octave improves pitch accuracy more than sticking to a few comfortable notes.
      The app plays a note, you sing it back and hold it, then it moves up a scale and back down.</p>
    <div class="row wrap">
      <label class="inline">Start on
        <select id="wStart">
          <option value="range">Middle of my range</option>
          <option value="43">Low voice (G2)</option>
          <option value="48">Middle voice (C3)</option>
          <option value="55">High voice (G3)</option>
          <option value="60">Higher voice (C4)</option>
        </select></label>
      <button id="wGo" class="btn primary">▶ Start warm-up</button>
      <button id="wStop" class="btn hidden">■ Stop</button>
    </div>
    <div id="wNotes" class="wNotes" aria-live="polite"></div>
    <p id="wStatus" class="tip center hidden"></p>
  </section>`;

  const ctx = new AudioContext();
  const mic = new LiveMic(ctx);
  const target = el<HTMLSelectElement>(root, '#tTarget');
  for (let midi = 23; midi <= 84; midi += 1) {
    const option = document.createElement('option');
    option.value = String(midi);
    option.textContent = midiToNote(midi) + (NOTE_NAMES[midi % 12] === 'C' ? '  (C)' : '');
    target.appendChild(option);
  }
  target.value = prefs.get('tuner.target', '');
  target.addEventListener('change', () => prefs.set('tuner.target', target.value));

  let low: number | null = null;
  let high: number | null = null;
  let stable: number[] = [];
  let frame = 0;
  const note = el(root, '#tNote'), hz = el(root, '#tHz'), needle = el(root, '#tNeedle'), hint = el(root, '#tHint'), rangeOut = el(root, '#tRange');
  const micButton = el<HTMLButtonElement>(root, '#tMic');
  const voiceOut = el(root, '#tVoice');

  // ---------------------------------------------------------------- range warm-up
  const SCALE = [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0];
  type Result = 'pending' | 'hit' | 'close' | 'miss';
  let warm: { notes: number[]; index: number; phase: 'listen' | 'sing'; phaseStart: number; holdStart: number | null; held: number[]; results: Result[] } | null = null;
  const wNotes = el(root, '#wNotes'), wStatus = el(root, '#wStatus'), wGo = el<HTMLButtonElement>(root, '#wGo'), wStop = el<HTMLButtonElement>(root, '#wStop');
  const wStart = el<HTMLSelectElement>(root, '#wStart');
  wStart.value = prefs.get('warmup.start', 'range');
  wStart.addEventListener('change', () => prefs.set('warmup.start', wStart.value));

  const renderWarmup = () => {
    if (!warm) return;
    wNotes.innerHTML = warm.notes.map((midi, i) => `<span class="wNote ${warm!.results[i]}${i === warm!.index ? ' current' : ''}">${midiToNote(midi)}</span>`).join('');
  };
  const beginNote = () => {
    if (!warm) return;
    const midi = warm.notes[warm.index];
    target.value = String(midi);
    warm.phase = 'listen';
    warm.phaseStart = performance.now();
    warm.holdStart = null;
    warm.held = [];
    void playTone(midi, 1);
    wStatus.textContent = '👂 Listen: ' + midiToNote(midi);
    renderWarmup();
  };
  const finishWarmup = (stopped: boolean) => {
    if (!warm) return;
    const done = warm;
    warm = null;
    wGo.classList.remove('hidden');
    wStop.classList.add('hidden');
    if (stopped) { wStatus.textContent = 'Warm-up stopped.'; return; }
    const hits = done.results.filter(result => result === 'hit' || result === 'close');
    const matched = done.notes.filter((_, i) => done.results[i] === 'hit' || done.results[i] === 'close');
    const solid = matched.length ? midiToNote(Math.min(...matched)) + ' to ' + midiToNote(Math.max(...matched)) : null;
    wStatus.textContent = '🎉 You matched ' + hits.length + ' of ' + done.notes.length + ' notes' + (solid ? ' — solid from ' + solid : '') + '. ' +
      (hits.length >= 12 ? 'Great work! Next time start a few notes higher or lower to stretch your range.' : 'Nice start — repeat it a couple of times and watch the greens grow.');
  };
  const nextNote = (result: Result) => {
    if (!warm) return;
    warm.results[warm.index] = result;
    warm.index += 1;
    if (warm.index >= warm.notes.length) { renderWarmup(); finishWarmup(false); return; }
    beginNote();
  };
  /** Called every frame with the sung pitch (or null). */
  const warmupStep = (midi: number | null) => {
    if (!warm) return;
    const now = performance.now();
    if (warm.phase === 'listen') {
      if (now - warm.phaseStart < 1100) return;
      warm.phase = 'sing';
      warm.phaseStart = now;
      wStatus.textContent = '🎤 Your turn: sing ' + midiToNote(warm.notes[warm.index]) + ' and hold it';
      return;
    }
    const goal = warm.notes[warm.index];
    if (midi !== null && Math.abs(midi - goal) <= 0.5) {
      warm.holdStart ??= now;
      warm.held.push(Math.abs(midi - goal) * 100);
      if (now - warm.holdStart >= 600) {
        const avg = warm.held.reduce((a, b) => a + b, 0) / warm.held.length;
        nextNote(avg <= 25 ? 'hit' : 'close');
      }
    } else {
      warm.holdStart = null;
      warm.held = [];
    }
    if (warm && warm.phase === 'sing' && now - warm.phaseStart > 5000) nextNote('miss');
  };
  wGo.addEventListener('click', async () => {
    if (!mic.active) {
      try { await mic.start(false); micButton.textContent = '■ Stop mic'; }
      catch { toast('Microphone blocked. Allow the mic for this site and try again.', 'error'); return; }
    }
    let start = Number(wStart.value);
    if (wStart.value === 'range') start = low !== null && high !== null && high - low >= 5 ? Math.round((low + high) / 2) - 6 : 48;
    warm = { notes: SCALE.map(step => start + step), index: 0, phase: 'listen', phaseStart: 0, holdStart: null, held: [], results: SCALE.map(() => 'pending') };
    wGo.classList.add('hidden');
    wStop.classList.remove('hidden');
    wStatus.classList.remove('hidden');
    beginNote();
  });
  wStop.addEventListener('click', () => finishWarmup(true));

  const loop = () => {
    frame = requestAnimationFrame(loop);
    if (!mic.active) return;
    const { midi } = mic.read();
    if (midi === null) { warmupStep(null); stable = []; needle.style.left = '50%'; needle.className = 'needle idle'; return; }
    warmupStep(midi);
    const goal = target.value ? Number(target.value) : Math.round(midi);
    const cents = Math.round((midi - goal) * 100);
    note.textContent = midiToNote(midi);
    hz.textContent = midiToFrequency(midi).toFixed(1) + ' Hz · ' + (cents > 0 ? '+' : '') + cents + '¢' + (target.value ? ' from ' + midiToNote(goal) : '');
    needle.style.left = Math.max(2, Math.min(98, 50 + (Math.max(-100, Math.min(100, cents)) / 100) * 48)) + '%';
    const off = Math.abs(cents);
    needle.className = 'needle ' + (off <= 15 ? 'good' : off <= 40 ? 'close' : 'off');
    hint.textContent = off <= 15 ? '✓ Locked in!' : cents < 0 ? '↑ A little higher' : '↓ A little lower';
    if (off > 150 && target.value) hint.textContent = cents < 0 ? '↑ Go up about ' + Math.round(off / 100) + ' notes' : '↓ Come down about ' + Math.round(off / 100) + ' notes';
    stable.push(Math.round(midi));
    if (stable.length > 12) stable.shift();
    if (stable.length >= 12 && stable.every(value => value === stable[0])) {
      low = low === null ? stable[0] : Math.min(low, stable[0]);
      high = high === null ? stable[0] : Math.max(high, stable[0]);
      rangeOut.textContent = midiToNote(low) + ' – ' + midiToNote(high) + (high - low >= 12 ? ' (' + ((high - low) / 12).toFixed(1) + ' octaves)' : '');
      // Only suggest a voice type once there's enough range to say something meaningful.
      voiceOut.textContent = high - low >= 7 ? 'Sits in: ' + voiceTypeNames(voiceTypesFor(low, high)) : 'Sing your lowest and highest comfortable notes to see your voice type.';
    }
  };

  micButton.addEventListener('click', async () => {
    if (mic.active) { mic.stop(); micButton.textContent = '🎤 Start mic'; note.textContent = '—'; hz.textContent = 'Sing any note'; return; }
    try {
      await mic.start(false);
      micButton.textContent = '■ Stop mic';
    } catch {
      toast('Microphone blocked. Allow the mic for this site and try again.', 'error');
    }
  });
  const playTone = async (midi: number, seconds = 1.2) => {
    await ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = midiToFrequency(midi);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + seconds);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + seconds + 0.05);
  };
  el(root, '#tTone').addEventListener('click', () => void playTone(target.value ? Number(target.value) : 57));
  el(root, '#tReset').addEventListener('click', () => { low = high = null; rangeOut.textContent = '—'; voiceOut.textContent = 'Sing your lowest and highest comfortable notes to see your voice type.'; });
  loop();

  return () => {
    cancelAnimationFrame(frame);
    mic.stop();
    void ctx.close();
  };
}
