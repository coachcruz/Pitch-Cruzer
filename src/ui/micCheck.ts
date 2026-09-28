import { LiveMic, listMics } from '../lib/mic';
import { midiToNote } from '../lib/music';
import { escapeHtml, prefs } from './dom';
import { chosenMic, micErrorMessage, micWarning, onSpeakers, rawMic, silentMicMessage } from './micSetup';

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
      <label class="check small"><input type="checkbox" data-mc="speakers"> I’m on speakers, not headphones <small>(headphones give the cleanest takes)</small></label>
    </div>`;
  const $ = <T extends HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  const state = $('.mcState'), msg = $('.mcMsg'), meter = $<HTMLElement>('.mcMeter span'), note = $('.mcNote');
  const select = $<HTMLSelectElement>('[data-mc="input"]'), raw = $<HTMLInputElement>('[data-mc="raw"]'), speakers = $<HTMLInputElement>('[data-mc="speakers"]');
  const startButton = $<HTMLButtonElement>('[data-mc="start"]');
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
