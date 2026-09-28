import { session } from '../session';

/**
 * Keeps the app on the version that's live. An app opened from the home screen can stay in memory
 * for days, still showing an old version after a new one is published. The page asks the server
 * which version is live — when you come back to the app, when you change screens, and every few
 * minutes — and reloads itself onto a new one, but never in the middle of something: while a song
 * is being prepared, its lyrics are being written, a song couldn't be saved on the device (it lives only
 * in this page until it is), or the current screen says it's busy
 * (`session.busy`: playing, recording…), the reload waits until that's done.
 */

const CHECK_EVERY_MS = 10 * 60 * 1000;
const RETRY_BUSY_MS = 30 * 1000;

/** The build's main script ("assets/index-<hash>.js"): it changes with every published version. */
export function versionOf(html: string): string | null {
  return /assets\/index-[\w-]+\.js/.exec(html)?.[0] ?? null;
}

function runningVersion(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]');
  return script ? versionOf(script.getAttribute('src') ?? '') : null;
}

export function keepUpToDate(): void {
  const running = runningVersion();
  if (!running) return; // the dev server: nothing is published
  let pending = false;
  let checking = false;
  let retry: number | null = null;

  const busy = () => session.lyricsJobs.size > 0 || (session.song !== null && !session.saved) || (session.busy?.() ?? false);
  const reloadWhenFree = () => {
    if (retry !== null) { window.clearTimeout(retry); retry = null; }
    if (!busy()) { location.reload(); return; }
    retry = window.setTimeout(reloadWhenFree, RETRY_BUSY_MS);
  };
  const check = async () => {
    if (pending) { reloadWhenFree(); return; }
    if (checking || !navigator.onLine) return;
    checking = true;
    try {
      const response = await fetch('./?version-check=' + Date.now(), { cache: 'no-store' });
      const live = response.ok ? versionOf(await response.text()) : null;
      if (live && live !== running) { pending = true; reloadWhenFree(); }
    } catch { /* offline: try again later */ } finally {
      checking = false;
    }
  };

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check(); });
  window.addEventListener('pageshow', event => { if (event.persisted) void check(); });
  window.addEventListener('hashchange', () => void check());
  window.setInterval(() => void check(), CHECK_EVERY_MS);
}
