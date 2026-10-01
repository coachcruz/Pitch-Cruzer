import { afterEach, describe, expect, it, vi } from 'vitest';
import { isIOS } from '../src/ui/micSetup';

const setUA = (userAgent: string, maxTouchPoints = 0) => {
  vi.stubGlobal('navigator', { userAgent, platform: '', maxTouchPoints });
};

afterEach(() => vi.unstubAllGlobals());

describe('isIOS: knowing when Mic Mode lives in Control Center', () => {
  it('is true on iPhone', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    expect(isIOS()).toBe(true);
  });

  it('is true on iPad, including the Mac-like iPadOS user agent', () => {
    setUA('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    expect(isIOS()).toBe(true);
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 5);
    expect(isIOS()).toBe(true);
  });

  it('is false on a real Mac and on other platforms', () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 0);
    expect(isIOS()).toBe(false);
    setUA('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36');
    expect(isIOS()).toBe(false);
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36');
    expect(isIOS()).toBe(false);
  });
});
