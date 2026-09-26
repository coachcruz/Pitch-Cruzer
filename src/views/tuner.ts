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

  const loop = () => {
    frame = requestAnimationFrame(loop);
    if (!mic.active) return;
    const { midi } = mic.read();
    if (midi === null) { stable = []; needle.style.left = '50%'; needle.className = 'needle idle'; return; }
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
  el(root, '#tTone').addEventListener('click', async () => {
    const midi = target.value ? Number(target.value) : 57;
    await ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = midiToFrequency(midi);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.25);
  });
  el(root, '#tReset').addEventListener('click', () => { low = high = null; rangeOut.textContent = '—'; voiceOut.textContent = 'Sing your lowest and highest comfortable notes to see your voice type.'; });
  loop();

  return () => {
    cancelAnimationFrame(frame);
    mic.stop();
    void ctx.close();
  };
}
