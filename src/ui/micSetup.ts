import { isBluetoothMic, listMics, type LiveMic, type MicChoice } from '../lib/mic';
import { escapeHtml, prefs, toast } from './dom';

/**
 * Which microphone the app listens to, and telling you when the device gets in the way: an iPhone
 * with its Mic Mode on Voice Isolation filters a sung voice (and can duck the music), and a Bluetooth
 * mic lags and drops to phone-call quality. Shared by Practice and the Tuner.
 */

/** The mic picked in the settings (null: the device's default). */
export const chosenMic = (): MicChoice | null => prefs.get<MicChoice | null>('micInput', null);
/** Ask the device for the plain voice, without phone filters (Voice Isolation, noise suppression…). */
export const rawMic = (): boolean => prefs.get('micRaw', true);

/** What to know about the mic now in use, most important first ('' when all is well). */
export function micWarning(mic: LiveMic): string {
  const label = mic.inputLabel;
  const filtering = mic.filtering;
  if (filtering.length) {
    return 'Your device is filtering the mic (' + filtering.join(', ') + '), which squashes singing. '
      + 'On iPhone: while the mic is on, open Control Center → Mic Mode → Standard.';
  }
  if (isBluetoothMic(label)) return 'This is a Bluetooth mic (' + label + '): it lags behind the music and sounds like a phone call. Plug in a wired or USB mic and pick it under Microphone.';
  if (mic.fellBack) return 'The mic you picked isn’t connected — using ' + (label || 'the default mic') + ' instead.';
  return '';
}

let announced = '';
/** After the mic starts: say which mic it is (once per change), or what's wrong with it. */
export function announceMic(mic: LiveMic): void {
  const warning = micWarning(mic);
  const key = mic.inputLabel + '|' + warning;
  if (key === announced) return;
  announced = key;
  if (warning) toast('🎤 ' + warning, 'error');
  else if (mic.inputLabel) toast('🎤 Listening through ' + mic.inputLabel);
}

/**
 * A "Microphone" picker: fills `select` with the device's mics, and shows in `status` which one is in
 * use and any warning. `changed` runs after a new mic is picked.
 */
export function micPicker(select: HTMLSelectElement, status: HTMLElement, mic: LiveMic, changed: () => void) {
  const refresh = async () => {
    const mics = await listMics();
    const chosen = chosenMic();
    select.innerHTML = '<option value="">Automatic (the device picks)</option>'
      + mics.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join('');
    const match = chosen && (mics.find(item => item.id === chosen.id) ?? mics.find(item => item.label === chosen.label));
    select.value = match ? match.id : '';
    if (chosen && !match) select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(chosen.id)}" selected>${escapeHtml(chosen.label)} (not connected)</option>`);
    const warning = mic.active ? micWarning(mic) : '';
    status.textContent = mic.active ? 'In use: ' + (mic.inputLabel || 'microphone') + (warning ? ' — ' + warning : '')
      : mics.length ? '' : 'Turn the mic on once to see your microphones here.';
    status.classList.toggle('warn', Boolean(warning));
  };
  select.addEventListener('change', () => {
    const option = select.selectedOptions[0];
    prefs.set('micInput', select.value ? { id: select.value, label: option?.textContent?.replace(/ \(not connected\)$/, '') ?? '' } : null);
    changed();
  });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => void refresh());
  return { refresh };
}
