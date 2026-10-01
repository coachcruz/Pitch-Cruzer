import { LiveMic, listMics } from '../lib/mic';
import { midiToNote } from '../lib/music';
import { escapeHtml, prefs } from './dom';
import { chosenMic, isIOS, micErrorMessage, micWarning, onSpeakers, rawMic, silentMicMessage } from './micSetup';
import { measureRoundTrip, saveSync, savedSync } from '../lib/sync';

/**
 * Mic check: all the microphone settings in one place, with a live check that the mic hears you —
 * a level meter and the note you're singing. Shown while a song is being prepared (so the mic is
 * sorted before the song starts) and from the practice settings. It uses its own audio, so it can
 * run while nothing else plays; `changed` runs when a setting changes.
 */
export function mountMicCheck(host: HTMLElement, changed: () => void = () => undefined): { stop: () => void } {
  const ctx = new AudioContext();
  const mic = new LiveMic(ctx);
  let frame = 0;
  let heardFor = 0;       // frames with a clear sung note
  let quietSince = 0;     // when the mic started hearing nothing at all
  let stopped = false;

  host.innerHTML = `
    <div class="micCheck">
      <div class="mcHead"><strong>Mic check</strong><span class="mcState">Not started</span></div>
      <div class="mcRow">
        <button class="btn" data-mc="start">🎤 Start mic check</button>
        <div class="mcMeter" aria-hidden="true"><span></span></div>
        <span class="mcNote mono">—</span>
      </div>
      <p class="mcMsg hint small">Sing or hum a note: you should see the bar move and your note appear.</p>
      <label class="inline">Microphone <select data-mc="input"><option value="">Automatic (the device picks)</option></select></label>
      <label class="check small"><input type="checkbox" data-mc="raw"> Singing mic <small>(ask the device for no filters like Voice Isolation — they squash singing)</small></label>
      ${isIOS() ? '<p class="hint small">iPhone: Mic Mode must be <strong>Standard</strong> — Voice Isolation ducks the music. While the mic is on: Control Center → Mic Mode → Standard.</p>' : ''}
      <label class="check small"><input type="checkbox" data-mc="speakers"> I’m on speakers, not headphones <small>(headphones give the cleanest takes)</small></label>
      <div class="mcSync">
        <button class="btn" data-mc="sync">⏱ Sync check</button>
        <span class="mcSyncState hint small"></span>
        <button class="btn small hidden" data-mc="syncForget">Forget</button>
      </div>
      <p class="hint small">Bluetooth headphones play late. Clap along with 8 clicks and your recordings, scores and the staff are lined up for the delay.</p>
    </div>`;
  const $ = <T extends HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  const state = $('.mcState'), msg = $('.mcMsg'), meter = $<HTMLElement>('.mcMeter span'), note = $('.mcNote');
  const select = $<HTMLSelectElement>('[data-mc="input"]'), raw = $<HTMLInputElement>('[data-mc="raw"]'), speakers = $<HTMLInputElement>('[data-mc="speakers"]');
  const startButton = $<HTMLButtonElement>('[data-mc="start"]');
  const syncButton = $<HTMLButtonElement>('[data-mc="sync"]'), syncState = $('.mcSyncState'), syncForget = $<HTMLButtonElement>('[data-mc="syncForget"]');
  const showSync = () => {
    const sync = savedSync();
    const otherMic = sync && mic.active && mic.inputLabel && sync.mic && sync.mic !== mic.inputLabel;
    syncState.textContent = !sync ? 'Not measured — using what the browser reports.'
      : 'Sync: ' + sync.ms + ' ms' + (otherMic ? ' — measured with ' + sync.mic + '; check again for this mic.' : sync.mic ? ' (' + sync.mic + ')' : '');
    syncForget.classList.toggle('hidden', !sync);
  };
  showSync();
  raw.checked = rawMic();
  speakers.checked = onSpeakers();

  const say = (text: string, tone: 'ok' | 'warn' | 'info' = 'info') => {
    msg.textContent = text;
    msg.className = 'mcMsg hint small ' + tone;
  };
  const fillMics = async () => {
    const mics = await listMics();
    const chosen = chosenMic();
    select.innerHTML = '<option value="">Automatic (the device picks)</option>'
      + mics.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join('');
    const match = chosen && (mics.find(item => item.id === chosen.id) ?? mics.find(item => item.label === chosen.label));
    select.value = match ? match.id : '';
  };

  const start = async () => {
    try {
      await mic.start(speakers.checked, chosenMic(), raw.checked);
    } catch (error) {
      state.textContent = 'Not working';
      say(micErrorMessage(error), 'warn');
      return;
    }
    if (stopped) { mic.stop(); return; }
    heardFor = 0;
    quietSince = performance.now();
    startButton.textContent = 'Restart';
    state.textContent = 'Listening · ' + (mic.inputLabel || 'microphone');
    const warning = micWarning(mic);
    say(warning || 'Sing or hum a note…', warning ? 'warn' : 'info');
    void fillMics();
    showSync();
    cancelAnimationFrame(frame);
    loop();
  };

  const loop = () => {
    if (stopped || !mic.active) return;
    frame = requestAnimationFrame(loop);
    const reading = mic.read();
    meter.style.width = Math.round(reading.level * 100) + '%';
    note.textContent = reading.midi === null ? '—' : midiToNote(reading.midi);
    if (reading.level > 0.01) quietSince = performance.now();
    if (reading.midi !== null) heardFor += 1;
    if (heardFor === 20) {
      state.textContent = '✓ Your mic is working';
      if (!micWarning(mic)) say('Heard you clearly through ' + (mic.inputLabel || 'the mic') + '. You’re set.', 'ok');
    } else if (heardFor === 0 && performance.now() - quietSince > 4000) {
      state.textContent = 'Hearing nothing';
      say(silentMicMessage(), 'warn');
      quietSince = performance.now();
    }
  };

  const click = (at: number, accent: boolean) => {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = accent ? 1500 : 1000;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.5, at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.1);
  };
  /** Plays 8 clicks, records the answers (claps, or the clicks heard back on speakers), measures the delay. */
  const syncCheck = async () => {
    if (!mic.active) await start();
    if (!mic.active) return;
    if (!mic.canRecord) { syncState.textContent = 'This browser can’t record here, so it can’t measure.'; return; }
    syncButton.disabled = true;
    syncState.textContent = 'Clap sharply on each click…';
    if (ctx.state !== 'running') await ctx.resume();
    mic.startRecording();
    const first = ctx.currentTime + 1.2;
    const clicks = Array.from({ length: 8 }, (_, k) => first + k * 0.6);
    clicks.forEach((at, k) => click(at, k === 0));
    await new Promise(resolve => window.setTimeout(resolve, (clicks[clicks.length - 1] - ctx.currentTime + 1.2) * 1000));
    const recording = mic.stopRecording();
    syncButton.disabled = false;
    if (stopped) return;
    const found = recording ? measureRoundTrip(recording.samples, recording.sampleRate, recording.startTime, clicks) : null;
    if (found === null) { syncState.textContent = 'Couldn’t hear a steady answer to the clicks — clap sharply on each one and try again.'; return; }
    saveSync({ ms: Math.round(found * 1000), mic: mic.inputLabel, at: Date.now() });
    changed();
    showSync();
  };
  syncButton.addEventListener('click', () => void syncCheck());
  syncForget.addEventListener('click', () => { saveSync(null); changed(); showSync(); });
  startButton.addEventListener('click', () => void start());
  select.addEventListener('change', () => {
    const option = select.selectedOptions[0];
    prefs.set('micInput', select.value ? { id: select.value, label: option?.textContent ?? '' } : null);
    changed();
    if (mic.active) void start();
  });
  raw.addEventListener('change', () => { prefs.set('micRaw', raw.checked); changed(); if (mic.active) void start(); });
  speakers.addEventListener('change', () => { prefs.set('speakers', speakers.checked); changed(); if (mic.active) void start(); });
  void fillMics();

  return {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(frame);
      mic.stop();
      void ctx.close().catch(() => undefined);
    }
  };
}
