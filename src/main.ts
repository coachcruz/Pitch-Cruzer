import './styles.css';
import { renderHome } from './views/home';
import { renderPractice } from './views/practice';
import { renderTuner } from './views/tuner';
import { keepUpToDate } from './lib/update';
import { session } from './session';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root not found');

app.innerHTML = `
  <header class="appbar">
    <a class="brand" href="#/"><span class="logo" aria-hidden="true">♪</span> Pitch Cruzer</a>
    <nav>
      <a href="#/" data-nav="home">Songs</a>
      <a href="#/tuner" data-nav="tuner">Tuner</a>
    </nav>
  </header>
  <main id="view" class="view"></main>`;

const view = app.querySelector<HTMLElement>('#view')!;
let dispose: (() => void) | null = null;

function navigate(hash: string): void {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function route(): void {
  dispose?.();
  dispose = null;
  session.busy = null;
  const hash = location.hash || '#/';
  const song = hash.match(/^#\/song\/([\w-]+)/);
  app!.querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach(link => {
    link.classList.toggle('active', (link.dataset.nav === 'tuner') === hash.startsWith('#/tuner') && !song);
  });
  window.scrollTo(0, 0);
  if (song) dispose = renderPractice(view, song[1]);
  else if (hash.startsWith('#/tuner')) dispose = renderTuner(view);
  else dispose = renderHome(view, navigate);
}

window.addEventListener('hashchange', route);
route();
keepUpToDate();

// Old versions of the app installed a caching service worker that could serve a stale page.
// Replace it with the current one (network-first, never caches API calls or models).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
