import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageRecorder } from '../src/lib/pageRecorder';

/** A browser: its user agent, Chromium's userAgentData (if it has it), and screen sharing. */
function browser(userAgent: string, userAgentData?: { mobile: boolean; brands: Array<{ brand: string }> }) {
  vi.stubGlobal('window', { AudioContext: class {} });
  vi.stubGlobal('navigator', { userAgent, userAgentData, mediaDevices: { getDisplayMedia: () => undefined } });
}
afterEach(() => vi.unstubAllGlobals());

describe('recording a video’s sound: said up front where it can’t work', () => {
  it('works in Chrome and Edge on a computer', () => {
    browser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      { mobile: false, brands: [{ brand: 'Google Chrome' }, { brand: 'Chromium' }] });
    expect(PageRecorder.canShareTabAudio()).toBe(true);
    browser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
      { mobile: false, brands: [{ brand: 'Microsoft Edge' }, { brand: 'Chromium' }] });
    expect(PageRecorder.canShareTabAudio()).toBe(true);
  });

  it('doesn’t in Safari on a Mac or iPhone, Firefox, or Chrome on a phone', () => {
    browser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15');
    expect(PageRecorder.canShareTabAudio()).toBe(false);
    browser('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1');
    expect(PageRecorder.canShareTabAudio()).toBe(false);
    browser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0');
    expect(PageRecorder.canShareTabAudio()).toBe(false);
    browser('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36',
      { mobile: true, brands: [{ brand: 'Google Chrome' }, { brand: 'Chromium' }] });
    expect(PageRecorder.canShareTabAudio()).toBe(false);
    browser('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1');
    expect(PageRecorder.canShareTabAudio()).toBe(false);
  });
});
