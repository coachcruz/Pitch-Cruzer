import { deleteSong, listSongs, saveSong, type StoredSong } from '../lib/library';
import * as lalal from '../lib/lalal';
import { formatTime, keyName } from '../lib/music';
import { classifyLink, LANGUAGE_CHOICES, lyricsOptionsFrom, prepareSong, STEPS, type SongInput, type StepId } from '../lib/prepare';
import { TabRecorder } from '../lib/tabcapture';
import { session } from '../session';
import { el, escapeHtml, prefs, toast } from '../ui/dom';

type LalalState = 'checking' | 'ready' | 'missing' | 'offline' | 'error';
let lalalState: LalalState = 'checking';
let lalalMinutes: number | null = null;

const STREAMING_NAMES: Record<string, string> = {
  youtube: 'YouTube', spotify: 'Spotify', apple: 'Apple Music', soundcloud: 'SoundCloud', other: 'This site'
};

export function renderHome(root: HTMLElement, navigate: (hash: string) => void): () => void {
  root.innerHTML = `
  <section class="hero">
    <h1>Sing it. See it. <span class="accent">Own it.</span></h1>
    <p>Add any song. Pitch Cruzer takes the singer out (or turns them down), writes out the lyrics like karaoke,
      shows the exact note for every syllable, and lets you practice just the parts you want — alone or with friends.</p>
  </section>

  <section class="card addSong" aria-labelledby="addTitle">
    <div class="cardHead">
      <h2 id="addTitle">Add a song</h2>
      <span id="lalalBadge" class="badge">Checking vocal separator…</span>
    </div>

    <div class="tabs" role="tablist">
      <button role="tab" class="tab active" data-tab="upload" aria-selected="true">Upload a file</button>
      <button role="tab" class="tab" data-tab="link" aria-selected="false">Paste a link</button>
      <button role="tab" class="tab" data-tab="tab" aria-selected="false">Record a browser tab</button>
    </div>

    <div class="tabPanel" data-panel="upload">
      <label class="dropZone" id="dropZone">
        <input id="fileInput" type="file" accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.aiff,.aif,.mp4,.mov,.mkv,.webm">
        <strong>Choose a song file</strong>
        <span>or drop it here · MP3, WAV, M4A, FLAC, video…</span>
      </label>
    </div>

    <div class="tabPanel hidden" data-panel="link">
      <form id="linkForm" class="linkRow">
        <input id="linkInput" type="url" inputmode="url" placeholder="Paste a Suno, YouTube, Spotify, Apple Music or audio-file link" required>
        <button class="btn primary" type="submit">Get song</button>
      </form>
      <div id="linkHelp" class="hint">Suno links and direct audio-file links are downloaded automatically.
        YouTube, Spotify and Apple Music don't allow downloads, so we'll record the song while it plays in another tab.</div>
      <div id="linkRecord" class="notice hidden"></div>
    </div>

    <div class="tabPanel hidden" data-panel="tab">
      <ol class="steps">
        <li>Open the song in another tab (YouTube, Spotify, Apple Music, Suno…). <span class="links">
          <a href="https://www.youtube.com/" target="_blank" rel="noopener">YouTube ↗</a>
          <a href="https://open.spotify.com/" target="_blank" rel="noopener">Spotify ↗</a>
          <a href="https://music.apple.com/" target="_blank" rel="noopener">Apple Music ↗</a>
          <a href="https://suno.com/" target="_blank" rel="noopener">Suno ↗</a></span></li>
        <li>Press <b>Start recording</b>, pick that tab, and keep <b>“Share tab audio”</b> switched on.</li>
        <li>Play the song from the start. Press <b>Stop</b> when it ends (or when you have the part you want).</li>
      </ol>
      <div class="recordRow">
        <button id="tabStart" class="btn primary">Start recording</button>
        <button id="tabStop" class="btn danger hidden">Stop &amp; prepare</button>
        <span id="tabTime" class="mono">0:00</span>
        <span class="meter"><span id="tabLevel"></span></span>
      </div>
      <div id="tabHelp" class="hint">Works in Chrome and Edge on a computer. Your recording is used only to prepare this song.</div>
    </div>

    <div class="options">
      <label class="check"><input id="useSeparation" type="checkbox" checked> Separate the singer from the music <small>(LALAL.AI — needed to turn the artist down)</small></label>
      <label class="check"><input id="keepSong" type="checkbox"> Keep this song on this device <small>(so you never have to prepare it again)</small></label>
      <div class="optionRow">
        <label class="inline">Lyrics language
          <select id="lyricsLang">${LANGUAGE_CHOICES.map(choice => `<option value="${choice.value}">${choice.label}</option>`).join('')}</select></label>
        <label class="inline">Lyrics accuracy
          <select id="lyricsQuality"><option value="best">Best (≈250 MB download, first time only)</option><option value="fast">Faster (≈80 MB)</option></select></label>
      </div>
    </div>
  </section>

  <section id="progressCard" class="card hidden" aria-live="polite">
    <div class="cardHead"><h2 id="progressTitle">Preparing your song…</h2><button id="cancelPrep" class="btn ghost small">Cancel</button></div>
    <ol id="stepList" class="stepList"></ol>
    <div id="prepError" class="errorBox hidden"></div>
  </section>

  <section class="card">
    <div class="cardHead"><h2>My songs</h2><span class="hint small">Saved on this device</span></div>
    <div id="songList" class="songList"><p class="empty">No saved songs yet.</p></div>
  </section>`;

  const lalalBadge = el(root, '#lalalBadge');
  const useSeparation = el<HTMLInputElement>(root, '#useSeparation');
  const keepSong = el<HTMLInputElement>(root, '#keepSong');
  keepSong.checked = prefs.get('keepSong', true);
  keepSong.addEventListener('change', () => prefs.set('keepSong', keepSong.checked));
  const lyricsLang = el<HTMLSelectElement>(root, '#lyricsLang');
  const lyricsQuality = el<HTMLSelectElement>(root, '#lyricsQuality');
  lyricsLang.value = prefs.get('lyricsLang', 'auto');
  lyricsQuality.value = prefs.get('lyricsQuality', 'best');
  lyricsLang.addEventListener('change', () => prefs.set('lyricsLang', lyricsLang.value));
  lyricsQuality.addEventListener('change', () => prefs.set('lyricsQuality', lyricsQuality.value));

  const addCard = el(root, '.addSong');
  const progressCard = el(root, '#progressCard');
  const stepList = el(root, '#stepList');
  const prepError = el(root, '#prepError');
  let abort: AbortController | null = null;
  let disposed = false;
  const recorder = new TabRecorder();
  let meterTimer: number | null = null;

  // ------------------------------------------------ LALAL status
  const renderLalal = () => {
    const labels: Record<LalalState, string> = {
      checking: 'Checking vocal separator…',
      ready: lalalMinutes === null ? 'Vocal separator ready' : 'Vocal separator ready · ' + lalalMinutes.toFixed(0) + ' min left',
      missing: 'Vocal separator not set up',
      offline: 'Server offline',
      error: 'Vocal separator error'
    };
    lalalBadge.textContent = labels[lalalState];
    lalalBadge.className = 'badge ' + (lalalState === 'ready' ? 'ok' : lalalState === 'checking' ? '' : 'warn');
    lalalBadge.title = lalalState === 'missing'
      ? 'Add LALAL_API_KEY in Netlify → Site settings → Environment variables, then redeploy.'
      : '';
    if (lalalState !== 'ready' && lalalState !== 'checking') {
      useSeparation.checked = false;
      useSeparation.closest('label')!.querySelector('small')!.textContent =
        lalalState === 'missing' ? '(not set up yet — add LALAL_API_KEY on Netlify. Without it the artist can’t be turned down)' : '(unavailable right now)';
    }
  };
  if (lalalState === 'checking' || lalalState === 'error') {
    lalal.minutesLeft().then(minutes => { lalalMinutes = minutes; lalalState = 'ready'; })
      .catch((error: lalal.LalalError) => { lalalState = error.code === 'missing_key' ? 'missing' : error.code === 'no_server' ? 'offline' : 'error'; })
      .finally(() => { if (!disposed) renderLalal(); });
  }
  renderLalal();

  // ------------------------------------------------ tabs
  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(tab => tab.addEventListener('click', () => {
    root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(other => {
      other.classList.toggle('active', other === tab);
      other.setAttribute('aria-selected', String(other === tab));
    });
    root.querySelectorAll<HTMLElement>('[data-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.panel !== tab.dataset.tab));
  }));

  // ------------------------------------------------ preparing
  const renderSteps = (states: Partial<Record<StepId, { fraction: number; detail?: string }>>, skipSeparation: boolean) => {
    stepList.innerHTML = STEPS.map(step => {
      const state = states[step.id];
      const skipped = skipSeparation && ['upload', 'separate', 'download'].includes(step.id);
      const status = skipped ? 'skipped' : !state ? 'waiting' : state.fraction >= 1 ? 'done' : 'active';
      const pct = state ? Math.round(state.fraction * 100) : 0;
      return `<li class="step ${status}"><span class="dot"></span><div><strong>${escapeHtml(step.label)}</strong>
        ${status === 'active' ? `<div class="bar"><span style="width:${pct}%"></span></div>` : ''}
        ${state?.detail && !skipped ? `<small>${escapeHtml(state.detail)}</small>` : skipped ? '<small>Skipped — using the full mix</small>' : ''}</div></li>`;
    }).join('');
  };

  const start = async (input: SongInput) => {
    const separate = useSeparation.checked;
    abort = new AbortController();
    addCard.classList.add('busy');
    progressCard.classList.remove('hidden');
    prepError.classList.add('hidden');
    el(root, '#progressTitle').textContent = 'Preparing your song…';
    const states: Partial<Record<StepId, { fraction: number; detail?: string }>> = {};
    renderSteps(states, !separate);
    progressCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const prepared = await prepareSong(input, separate, lyricsOptionsFrom(lyricsLang.value, lyricsQuality.value), (step, fraction, detail) => {
        states[step] = { fraction, detail: detail ?? states[step]?.detail };
        if (!disposed) renderSteps(states, !separate);
      }, abort.signal);
      if (abort.signal.aborted || disposed) return;
      session.song = prepared.song;
      session.buffers = prepared.buffers;
      session.saved = false;
      if (keepSong.checked) {
        try { await saveSong(prepared.song); session.saved = true; }
        catch { toast('Could not save the song on this device (storage full?). You can still practice it now.', 'error'); }
      }
      navigate('#/song/' + prepared.song.id);
    } catch (error) {
      if (disposed) return;
      const message = error instanceof Error ? error.message : 'Something went wrong.';
      el(root, '#progressTitle').textContent = 'That didn’t work';
      const canFallback = separate && input.kind !== 'link';
      prepError.innerHTML = `<p>${escapeHtml(message)}</p><div class="row">
        <button class="btn" data-act="retry">Try again</button>
        ${canFallback ? '<button class="btn" data-act="nosplit">Continue without separating</button>' : ''}
        <button class="btn ghost" data-act="close">Close</button></div>`;
      prepError.classList.remove('hidden');
      prepError.querySelector('[data-act="retry"]')?.addEventListener('click', () => void start(input));
      prepError.querySelector('[data-act="nosplit"]')?.addEventListener('click', () => { useSeparation.checked = false; void start(input); });
      prepError.querySelector('[data-act="close"]')?.addEventListener('click', () => progressCard.classList.add('hidden'));
    } finally {
      addCard.classList.remove('busy');
    }
  };

  el(root, '#cancelPrep').addEventListener('click', () => {
    abort?.abort();
    progressCard.classList.add('hidden');
    addCard.classList.remove('busy');
  });

  // ------------------------------------------------ upload
  const fileInput = el<HTMLInputElement>(root, '#fileInput');
  const takeFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) { toast('That file is over 200 MB.', 'error'); return; }
    void start({ kind: 'file', file, name: file.name });
  };
  fileInput.addEventListener('change', () => { takeFile(fileInput.files?.[0]); fileInput.value = ''; });
  const dropZone = el(root, '#dropZone');
  dropZone.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
  dropZone.addEventListener('drop', event => {
    event.preventDefault();
    dropZone.classList.remove('over');
    takeFile(event.dataTransfer?.files?.[0]);
  });

  // ------------------------------------------------ tab recording
  const tabStart = el<HTMLButtonElement>(root, '#tabStart');
  const tabStop = el<HTMLButtonElement>(root, '#tabStop');
  const setRecording = (on: boolean) => {
    tabStart.classList.toggle('hidden', on);
    tabStop.classList.toggle('hidden', !on);
    root.querySelectorAll<HTMLButtonElement>('.recordStart').forEach(button => button.classList.toggle('hidden', on));
    root.querySelectorAll<HTMLButtonElement>('.linkStop').forEach(button => button.classList.toggle('hidden', !on));
    if (meterTimer !== null) window.clearInterval(meterTimer);
    let warned = false;
    meterTimer = on ? window.setInterval(() => {
      root.querySelectorAll<HTMLElement>('#tabTime, .linkTime').forEach(node => { node.textContent = formatTime(recorder.seconds); });
      if (!warned && recorder.seconds > 6 && recorder.peak < 0.02) {
        warned = true;
        toast('No sound from that tab yet. Is the song playing? If you picked a window or screen, stop and pick the browser TAB with “Share tab audio” on.', 'error');
      }
      root.querySelectorAll<HTMLElement>('#tabLevel, .linkLevel').forEach(node => { node.style.width = Math.round(recorder.level * 100) + '%'; });
    }, 200) : null;
  };
  const startTab = async () => {
    if (!TabRecorder.supported()) { toast('This browser can’t record tab audio. Use Chrome or Edge on a computer, or upload a file.', 'error'); return; }
    try {
      recorder.seconds = 0;
      await recorder.start();
      recorder.onEnded = () => void stopTab();
      setRecording(true);
      toast('Recording… play the song in the other tab.');
    } catch (error) {
      setRecording(false);
      const name = error instanceof Error ? error.name : '';
      const message = name === 'NotAllowedError' ? 'Recording was cancelled (or screen sharing is blocked for this browser in your system settings).'
        : name === 'NotSupportedError' || name === 'TypeError' ? 'This browser can’t record tab audio. Use Chrome or Edge on a computer, or upload a file.'
        : name === 'NotReadableError' || name === 'AbortError' ? 'The browser couldn’t start sharing that tab. Close other screen-sharing apps and try again.'
        : error instanceof Error ? error.message : 'Recording failed.';
      toast(message + (name ? ' [' + name + ']' : ''), 'error');
    }
  };
  const stopTab = async () => {
    if (tabStop.classList.contains('hidden')) return;
    setRecording(false);
    const blob = await recorder.stop();
    if (!blob) { toast('No sound was captured. Make sure the song was playing and “Share tab audio” was on.', 'error'); return; }
    void start({ kind: 'recording', blob, name: 'Recorded song ' + new Date().toLocaleDateString() + '.wav' });
  };
  tabStart.addEventListener('click', () => void startTab());
  tabStop.addEventListener('click', () => void stopTab());

  // ------------------------------------------------ links
  const linkRecord = el(root, '#linkRecord');
  el<HTMLFormElement>(root, '#linkForm').addEventListener('submit', event => {
    event.preventDefault();
    const url = el<HTMLInputElement>(root, '#linkInput').value.trim();
    const kind = classifyLink(url);
    linkRecord.classList.add('hidden');
    if (kind === 'invalid') { toast('That doesn’t look like a link.', 'error'); return; }
    if (kind === 'suno' || kind === 'direct') {
      if (!useSeparation.checked && lalalState !== 'ready') {
        toast('Links are downloaded by the server, which needs the LALAL.AI key. Upload the file instead.', 'error');
        return;
      }
      useSeparation.checked = true;
      void start({ kind: 'link', url });
      return;
    }
    const name = STREAMING_NAMES[kind] ?? 'This site';
    linkRecord.innerHTML = `<p><b>${name} doesn’t allow downloading songs</b> — so let’s record it while it plays:</p>
      <div class="recordRow">
        <a class="btn" href="${escapeHtml(url)}" target="_blank" rel="noopener">1 · Open song ↗</a>
        <button class="btn primary recordStart">2 · Start recording that tab</button>
        <button class="btn danger linkStop hidden">3 · Stop &amp; prepare</button>
        <span class="mono linkTime">0:00</span><span class="meter"><span class="linkLevel"></span></span>
      </div>
      <p class="hint">In the picker choose the tab you just opened and keep “Share tab audio” on. Then press play in that tab.</p>`;
    linkRecord.classList.remove('hidden');
    el(linkRecord, '.recordStart').addEventListener('click', () => void startTab());
    el(linkRecord, '.linkStop').addEventListener('click', () => void stopTab());
  });

  // ------------------------------------------------ library
  const songList = el(root, '#songList');
  const renderLibrary = async () => {
    let songs: StoredSong[] = [];
    try { songs = await listSongs(); } catch { /* storage unavailable */ }
    if (disposed) return;
    if (!songs.length) { songList.innerHTML = '<p class="empty">No saved songs yet. Songs you add with “Keep this song” checked show up here.</p>'; return; }
    songList.innerHTML = songs.map(song => {
      const a = song.analysis;
      const meta = [formatTime(a.duration), a.key ? keyName(a.key) : null, a.sections.length + ' sections', a.separated ? null : 'full mix']
        .filter(Boolean).join(' · ');
      return `<div class="songItem"><button class="songOpen" data-open="${song.id}"><strong>${escapeHtml(song.title)}</strong><small>${escapeHtml(meta)}</small></button>
        <button class="btn ghost small" data-delete="${song.id}" aria-label="Delete ${escapeHtml(song.title)}">Delete</button></div>`;
    }).join('');
    songList.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(button => button.addEventListener('click', () => navigate('#/song/' + button.dataset.open)));
    songList.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach(button => button.addEventListener('click', async () => {
      if (!confirm('Delete this song and its takes from this device?')) return;
      await deleteSong(button.dataset.delete!);
      void renderLibrary();
    }));
  };
  void renderLibrary();

  return () => {
    disposed = true;
    abort?.abort();
    if (meterTimer !== null) window.clearInterval(meterTimer);
    if (!tabStop.classList.contains('hidden')) void recorder.stop();
  };
}
