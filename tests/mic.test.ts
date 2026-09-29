import { describe, expect, it } from 'vitest';
import { isBluetoothMic, type LiveMic } from '../src/lib/mic';
import { micWarning } from '../src/ui/micSetup';

/** Just what micWarning reads from a live mic. */
const mic = (state: { inputLabel?: string; filtering?: string[]; fellBack?: boolean }) =>
  ({ inputLabel: '', filtering: [], fellBack: false, ...state }) as unknown as LiveMic;

describe('microphone: telling you when the device gets in the way', () => {
  it('knows a Bluetooth mic by its name', () => {
    expect(isBluetoothMic('AirPods Pro')).toBe(true);
    expect(isBluetoothMic('Galaxy Buds2')).toBe(true);
    expect(isBluetoothMic('Bluetooth Headset')).toBe(true);
    expect(isBluetoothMic('USB Audio CODEC')).toBe(false);
    expect(isBluetoothMic('iPhone Microphone')).toBe(false);
  });

  it('says nothing when the mic is fine', () => {
    expect(micWarning(mic({ inputLabel: 'USB Audio CODEC' }))).toBe('');
  });

  it('explains how to turn Voice Isolation off when the phone filters the mic anyway', () => {
    const warning = micWarning(mic({ inputLabel: 'iPhone Microphone', filtering: ['voice isolation', 'noise suppression'] }));
    expect(warning).toContain('voice isolation, noise suppression');
    expect(warning).toContain('Control Center → Mic Mode → Standard');
  });

  it('warns about a Bluetooth mic, and a picked mic that isn’t connected', () => {
    expect(micWarning(mic({ inputLabel: 'AirPods Pro' }))).toMatch(/Bluetooth mic \(AirPods Pro\)/);
    expect(micWarning(mic({ inputLabel: 'iPhone Microphone', fellBack: true }))).toMatch(/isn’t connected — using iPhone Microphone/);
  });

  it('puts the filtering first when several things are wrong', () => {
    expect(micWarning(mic({ inputLabel: 'AirPods Pro', filtering: ['voice isolation'] }))).toMatch(/^Your device is filtering/);
  });
});
