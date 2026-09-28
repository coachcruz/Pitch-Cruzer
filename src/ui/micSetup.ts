import { isBluetoothMic, type LiveMic, type MicChoice } from '../lib/mic';
import { prefs, toast } from './dom';

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


/** Playing through speakers (not headphones): the mic then cancels the music's echo. */
export const onSpeakers = (): boolean => prefs.get('speakers', false);

const isMac = () => /Mac/.test(navigator.platform || navigator.userAgent) && !/iPhone|iPad/.test(navigator.userAgent);

/** Why the mic couldn't start, in plain words, with what to do about it. */
export function micErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  const macPrivacy = isMac() ? ' On a Mac, also check System Settings → Privacy & Security → Microphone: your browser must be switched on (then quit and reopen the browser).' : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The microphone is blocked for this site. Allow it: click the icon left of the address (Safari: Settings for this website → Microphone → Allow).' + macPrivacy;
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Plug one in, or check that the built-in one is switched on in your sound settings.';
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'The microphone is busy or blocked by the system. Close other apps that use it (Zoom, FaceTime, another tab) and try again.' + macPrivacy;
  }
  return 'The microphone couldn’t start.' + macPrivacy;
}

/** The mic is on but hears nothing at all: what to check. */
export function silentMicMessage(): string {
  return isMac()
    ? 'The mic is on but hears nothing. On a Mac: System Settings → Sound → Input — pick the MacBook microphone and raise Input volume — and Privacy & Security → Microphone must allow your browser.'
    : 'The mic is on but hears nothing. Check the mic isn’t muted, and that the right one is picked below.';
}
