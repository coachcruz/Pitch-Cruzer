import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadTrack, uploadFile } from '../src/lib/lalal';

afterEach(() => vi.unstubAllGlobals());

describe('separation cancellation', () => {
  it('does not send an upload after cancellation', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController(); controller.abort();
    await expect(uploadFile(new Blob(['audio']), 'song.mp3', () => undefined, controller.signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not start a proxy download when the direct download was cancelled', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => {
      controller.abort();
      throw controller.signal.reason;
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(downloadTrack('https://example.test/stem', controller.signal)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
