import { diagEntries, diagReset, onDiag, diag } from '../lib/diag';
import { deleteSong, exportSong, importSong, keepStoragePersistent, listSongs, saveSong, type StoredSong } from '../lib/library';
import * as lalal from '../lib/lalal';
import { downloadBlob } from '../lib/audio';
import { formatTime, keyName } from '../lib/music';
import { classifyLink, LANGUAGE_CHOICES, lyricsOptionsFrom, prepareSong, STEPS, type LyricsSource, type SongInput, type StepId } from '../lib/prepare';
import { PageRecorder, shareErrorMessage } from '../lib/pageRecorder';
import { showRecordingReview } from '../ui/recordingReview';
import { cleanSongTitle, EmbeddedVideo, searchYouTube, youtubeId, youtubeSearchAvailable } from '../lib/youtube';
import { LYRICS_READY, session } from '../session';
import { el, escapeHtml, prefs, toast } from '../ui/dom';

type LalalState = 'checking' | 'ready' | 'missing' | 'offline' | 'error';
let lalalState: LalalState = 'checking';
let lalalMinutes: number | null = null;

/**
 * Where a song can come from: YouTube plays (and is recorded) inside the app; Suno links download
 * directly. Anything else (Spotify, Apple Music, Amazon…): download the song, then upload the file.
 */
type SourceId = 'youtube' | 'suno';
const SOURCES: Array<{ id: SourceId; label: string; hint: string; search: (q: string) => string }> = [
  { id: 'youtube', label: '▶ YouTube', hint: 'Plays right here — record it without leaving the app', search: q => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q) },
  { id: 'suno', label: 'Suno', hint: 'Opens Suno — paste the song’s link back here and it’s downloaded directly', search: q => 'https://suno.com/search?q=' + encodeURIComponent(q) }
];

/** Streaming services that can't be recorded in the app — their songs are downloaded, then uploaded. */
const LINK_NAMES: Record<string, string> = { spotify: 'Spotify', apple: 'Apple Music', soundcloud: 'SoundCloud', other: 'That site' };

export function renderHome(root: HTMLElement, navigate: (hash: string) => void): () => void {
  root.innerHTML = `
  <section class="card addSong" aria-labelledby="addTitle">
    <div class="cardHead">
      <h2 id="addTitle">Add a song</h2>
      <span id="lalalBadge" class="badge">Checking vocal separator…</span>
    </div>
    <form id="searchForm" class="searchBar" role="search">
      <input id="searchInput" class="textInput" placeholder="Song and artist — or paste a link" autocomplete="off" enterkeyhint="search" aria-label="Song and artist, or a link">
      <select id="lyricsLang" aria-label="Lyrics language" title="Language of the lyrics">${LANGUAGE_CHOICES.map(choice =>
        `<option value="${choice.value}">${choice.value === 'auto' ? 'Any language' : escapeHtml(choice.label)}</option>`).join('')}</select>
      <button class="btn primary" type="submit">Search</button>
    </form>
    <div class="sources" role="radiogroup" aria-label="Where to get the song">
      ${SOURCES.map(source => `<button type="button" role="radio" data-source="${source.id}" aria-checked="false" title="${escapeHtml(source.hint)}">${source.label}</button>`).join('')}
      <label class="srcFile" title="A song file on this device — bought/downloaded from Spotify, Apple Music, Amazon… (MP3, WAV, M4A, FLAC, video). Or drop it on this card.">📁 Upload a file
        <input id="fileInput" type="file" accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.aiff,.aif,.mp4,.mov,.mkv,.webm"></label>
    </div>
    <p id="sourceHint" class="hint small"></p>

    <div id="findResults" class="findResults"></div>

    <div id="videoStage" class="videoStage hidden">
      <div id="videoHost" class="videoHost"></div>
      <div class="videoSide">
        <strong id="videoTitle" class="videoTitle"></strong>
        <div class="recordRow">
          <button id="vRecord" class="btn record">● Record the song</button>
          <button id="vStop" class="btn danger hidden">■ Stop</button>
          <button id="vRestart" class="btn ghost" title="Back to the start (while recording: throw away the take and start over)">↺ Restart</button>
          <span id="vTime" class="mono">0:00</span>
        </div>
        <div class="vu" aria-hidden="true"><span id="vMeter"></span></div>
        <p class="hint small">Plays from the start and stops by itself at the end. The first time, Chrome asks to share this tab — choose it with “Share tab audio” on.</p>
      </div>
    </div>

    <div id="serviceStage" class="notice hidden"></div>

    <div id="capReviewHost"></div>

    <details class="pasteWrap"><summary>Have the lyrics? Paste them <small>(best for your own or Suno songs)</small></summary>
      <textarea id="pasteLyrics" rows="5" placeholder="One sung line per line — they’re matched to the singer automatically."></textarea>
    </details>
  </section>

  <section id="progressCard" class="card hidden" aria-live="polite">
    <div class="cardHead"><h2 id="progressTitle">Preparing your song…</h2><button id="cancelPrep" class="btn ghost small">Cancel</button></div>
    <ol id="stepList" class="stepList"></ol>
    <div id="prepError" class="errorBox hidden"></div>
    <details class="diag"><summary>Show details <span id="diagElapsed" class="mono"></span></summary>
      <ol id="diagLog" class="diagLog"></ol>
      <button id="diagCopy" class="chip ghost">Copy details</button>
    </details>
  </section>

  <section class="card">
    <div class="cardHead"><h2>My songs</h2>
      <label class="btn ghost small" title="Open a song file you downloaded earlier">Import song file<input id="importInput" type="file" accept=".pitchcruzer" hidden></label></div>
    <p class="hint small">Songs stay on this device (they survive refreshing and closing). ⬇ downloads one as a file to keep anywhere.</p>
    <div id="songList" class="songList"><p class="empty">No songs yet.</p></div>
  </section>`;

  const lalalBadge = el(root, '#lalalBadge');
  const searchInput = el<HTMLInputElement>(root, '#searchInput');
  const pasteLyrics = el<HTMLTextAreaElement>(root, '#pasteLyrics');
  const lyricsLang = el<HTMLSelectElement>(root, '#lyricsLang');
  lyricsLang.value = prefs.get('lyricsLang', 'auto');
  lyricsLang.addEventListener('change', () => prefs.set('lyricsLang', lyricsLang.value));
  /** The song's name (typed, or the video's title) — names the song and finds its real lyrics. */
  let songTitle = '';
  const lyricsSource = (input: SongInput): LyricsSource => {
    const pasted = pasteLyrics.value.trim();
    if (pasted) return { pasted };
    const fromName = input.kind === 'link' ? '' : input.name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ');
    const lookup = songTitle || (/^recorded song/i.test(fromName) ? '' : fromName);
    return lookup ? { lookup } : {};
  };

  const addCard = el(root, '.addSong');
  const progressCard = el(root, '#progressCard');
  const stepList = el(root, '#stepList');
  const prepError = el(root, '#prepError');
  let abort: AbortController | null = null;
  let disposed = false;

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
      ? 'Add LALAL_API_KEY in Netlify → Site settings → Environment variables, then redeploy. Until then songs are prepared with the singer left in.'
      : lalalState === 'ready' ? 'The singer is separated from the music automatically' : 'Songs are prepared with the singer left in until the separator is back';
  };
  if (lalalState === 'checking' || lalalState === 'error') {
    lalal.minutesLeft().then(minutes => { lalalMinutes = minutes; lalalState = 'ready'; })
      .catch((error: lalal.LalalError) => { lalalState = error.code === 'missing_key' ? 'missing' : error.code === 'no_server' ? 'offline' : 'error'; })
      .finally(() => { if (!disposed) renderLalal(); });
  }
  renderLalal();

  // ------------------------------------------------ preparing
  // Activity log ("Show details") with timings, to see exactly where preparation is waiting.
  const diagLog = el(root, '#diagLog');
  const diagElapsed = el(root, '#diagElapsed');
  const renderDiag = () => {
    diagLog.innerHTML = diagEntries().map(entry =>
      `<li class="d-${entry.tone}"><span class="mono">${entry.at.toFixed(1)}s</span> ${escapeHtml(entry.text)}</li>`).join('');
    diagLog.scrollTop = diagLog.scrollHeight;
  };
  const stopDiag = onDiag(renderDiag);
  let prepStartedAt = 0;
  let stepStartedAt = 0;
  let currentStep: StepId | null = null;
  const elapsedTimer = window.setInterval(() => {
    if (!prepStartedAt || progressCard.classList.contains('hidden')) return;
    const total = (performance.now() - prepStartedAt) / 1000;
    const inStep = (performance.now() - stepStartedAt) / 1000;
    diagElapsed.textContent = '· ' + formatTime(total) + ' total' + (currentStep ? ' · this step ' + formatTime(inStep) : '');
  }, 500);
  el(root, '#diagCopy').addEventListener('click', () => {
    const text = diagEntries().map(entry => entry.at.toFixed(1) + 's ' + entry.text).join('\n');
    void navigator.clipboard?.writeText(text).then(() => toast('Details copied — paste them to Claude.'), () => toast('Couldn’t copy — take a screenshot instead.', 'error'));
  });

  const renderSteps = (states: Partial<Record<StepId, { fraction: number; detail?: string }>>, skipSeparation: boolean) => {
    stepList.innerHTML = STEPS.map(step => {
      const state = states[step.id];
      const skipped = skipSeparation && ['upload', 'separate', 'download'].includes(step.id);
      if (step.background) return `<li class="step later"><span class="dot"></span><div><strong>${escapeHtml(step.label)}</strong><small>Happens while you practice — the song opens as soon as the notes are found</small></div></li>`;
      const status = skipped ? 'skipped' : !state ? 'waiting' : state.fraction >= 1 ? 'done' : 'active';
      const pct = state ? Math.round(state.fraction * 100) : 0;
      return `<li class="step ${status}"><span class="dot"></span><div><strong>${escapeHtml(step.label)}</strong>
        ${status === 'active' ? `<div class="bar"><span style="width:${pct}%"></span></div>` : ''}
        ${state?.detail && !skipped ? `<small>${escapeHtml(state.detail)}</small>` : skipped ? '<small>Skipped — using the full mix</small>' : ''}</div></li>`;
    }).join('');
  };

  /** Separation is automatic — it's the core of the app. Only if the separator is down (or fails and
   * you choose to) is a song prepared with the singer left in. */
  const start = async (input: SongInput, separate = lalalState !== 'missing' && lalalState !== 'offline') => {
    if (!separate && input.kind === 'link') { toast('Links are downloaded through the vocal separator, which isn’t available right now. Upload the file instead.', 'error'); return; }
    abort = new AbortController();
    addCard.classList.add('busy');
    progressCard.classList.remove('hidden');
    prepError.classList.add('hidden');
    el(root, '#progressTitle').textContent = 'Preparing your song…';
    const states: Partial<Record<StepId, { fraction: number; detail?: string }>> = {};
    diagReset();
    prepStartedAt = stepStartedAt = performance.now();
    currentStep = null;
    diag('Started: ' + (input.kind === 'link' ? 'link' : input.kind) + (input.kind !== 'link' ? ' (' + ((input.kind === 'file' ? input.file : input.blob).size / 1048576).toFixed(1) + ' MB)' : '') + ' · separation ' + (separate ? 'on' : 'off'));
    renderSteps(states, !separate);
    progressCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const prepared = await prepareSong(input, separate, lyricsOptionsFrom(lyricsLang.value, prefs.get('lyricsQuality2', 'fast')), (step, fraction, detail) => {
        if (step !== currentStep) {
          if (currentStep) diag('Finished: ' + currentStep + ' in ' + ((performance.now() - stepStartedAt) / 1000).toFixed(1) + 's', 'ok');
          currentStep = step;
          stepStartedAt = performance.now();
          diag('Step: ' + step);
        }
        states[step] = { fraction, detail: detail ?? states[step]?.detail };
        if (!disposed) renderSteps(states, !separate);
      }, abort.signal, lyricsSource(input));
      if (abort.signal.aborted || disposed) return;
      const song = prepared.song;
      if (songTitle) song.title = songTitle;
      session.song = song;
      session.buffers = prepared.buffers;
      // Every song is kept on this device automatically (and can be downloaded as a file from My songs).
      session.saved = await saveSong(song).then(() => true, () => false);
      if (!session.saved) toast('This device is out of space, so the song isn’t saved — you can still practice it now.', 'error');
      keepStoragePersistent();
      // Open the song as soon as the notes are ready; the lyrics finish in the background and appear
      // on the practice screen when done.
      const job = prepared.lyricsJob().catch(error => console.warn('Background lyrics failed', error)).then(async () => {
        song.analysis.lyricsPending = false;
        session.lyricsJobs.delete(song.id);
        if (session.saved) await saveSong(song).catch(() => undefined);
        window.dispatchEvent(new CustomEvent(LYRICS_READY, { detail: song.id }));
      });
      session.lyricsJobs.set(song.id, job);
      pasteLyrics.value = '';
      searchInput.value = '';
      songTitle = '';
      navigate('#/song/' + song.id);
    } catch (error) {
      if (disposed) return;
      const message = error instanceof Error ? error.message : 'Something went wrong.';
      diag('Failed during ' + (currentStep ?? 'start') + ': ' + message, 'error');
      el(root, '#progressTitle').textContent = 'That didn’t work';
      const canFallback = separate && input.kind !== 'link';
      prepError.innerHTML = `<p>${escapeHtml(message)}</p><div class="row">
        <button class="btn" data-act="retry">Try again</button>
        ${canFallback ? '<button class="btn" data-act="nosplit">Continue without separating</button>' : ''}
        <button class="btn ghost" data-act="close">Close</button></div>`;
      prepError.classList.remove('hidden');
      prepError.querySelector('[data-act="retry"]')?.addEventListener('click', () => void start(input));
      prepError.querySelector('[data-act="nosplit"]')?.addEventListener('click', () => void start(input, false));
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

  // ------------------------------------------------ files: the 📁 button, or drop one anywhere on the card
  const fileInput = el<HTMLInputElement>(root, '#fileInput');
  const takeFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) { toast('That file is over 200 MB.', 'error'); return; }
    if (!songTitle) songTitle = searchInput.value.trim() && !/^https?:/i.test(searchInput.value.trim()) ? searchInput.value.trim() : '';
    void start({ kind: 'file', file, name: file.name });
  };
  fileInput.addEventListener('change', () => { takeFile(fileInput.files?.[0]); fileInput.value = ''; });
  addCard.addEventListener('dragover', event => { event.preventDefault(); addCard.classList.add('over'); });
  addCard.addEventListener('dragleave', event => { if (!addCard.contains(event.relatedTarget as Node)) addCard.classList.remove('over'); });
  addCard.addEventListener('drop', event => {
    event.preventDefault();
    addCard.classList.remove('over');
    takeFile(event.dataTransfer?.files?.[0]);
  });

  // ------------------------------------------------ YouTube, right in the page: play, record, restart
  const vRecord = el<HTMLButtonElement>(root, '#vRecord');
  const vStop = el<HTMLButtonElement>(root, '#vStop');
  const vTime = el(root, '#vTime');
  const vMeter = el(root, '#vMeter');
  const videoStage = el(root, '#videoStage');
  const findResults = el(root, '#findResults');
  const reviewHost = el(root, '#capReviewHost');
  const video = new EmbeddedVideo();
  const recorder = new PageRecorder();
  let closeReview: (() => void) | null = null;
  let warned = false;

  const renderRecorder = () => {
    vRecord.classList.toggle('hidden', recorder.recording);
    vStop.classList.toggle('hidden', !recorder.recording);
    vTime.textContent = recorder.recording ? '● ' + formatTime(recorder.seconds) : formatTime(video.time) + (video.duration ? ' / ' + formatTime(video.duration) : '');
    vMeter.style.width = Math.round(recorder.level() * 100) + '%';
  };
  const recorderTick = window.setInterval(() => {
    renderRecorder();
    if (recorder.recording && !warned && recorder.seconds > 6 && recorder.peak < 0.02) {
      warned = true;
      toast('Nothing audible is being recorded — is “Share tab audio” on?', 'error');
    }
  }, 200);

  const loadVideo = async (id: string, title = '') => {
    closeSongTab();
    videoStage.classList.remove('hidden');
    el(root, '#videoTitle').textContent = title || 'Loading…';
    try {
      await video.mount(el(root, '#videoHost'), id);
      const name = video.title || title;
      el(root, '#videoTitle').textContent = name;
      songTitle = cleanSongTitle(name);
      videoStage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      videoStage.classList.add('hidden');
      toast(error instanceof Error ? error.message : 'Couldn’t load that video.', 'error');
    }
  };

  /** Records this page while the player plays the song from the start; stops by itself at the end. */
  const recordVideo = async () => {
    closeReview?.();
    closeReview = null;
    if (!recorder.connected) {
      if (!PageRecorder.supported()) { toast('This browser can’t record here. Use Chrome or Edge on a computer — or download the song and upload the file.', 'error'); return; }
      try { await recorder.connect(); } catch (error) { toast(shareErrorMessage(error), 'error'); return; }
    }
    recorder.start();
    warned = false;
    video.restart();
    renderRecorder();
  };
  const stopRecording = () => {
    if (!recorder.recording) return;
    const recording = recorder.stop();
    video.pause();
    renderRecorder();
    if (!recording) { toast('Nothing audible was recorded. Keep “Share tab audio” on when Chrome asks.', 'error'); return; }
    closeReview = showRecordingReview(reviewHost, recording, {
      use: (wav, title) => {
        closeReview = null;
        recorder.close();
        songTitle = title;
        void start({ kind: 'recording', blob: wav, name: (title || 'Recorded song ' + new Date().toLocaleDateString()) + '.wav' });
      },
      redo: () => { closeReview = null; void recordVideo(); },
      discard: () => { closeReview = null; toast('Recording discarded.'); }
    }, songTitle);
    reviewHost.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  video.onStatus = status => {
    if (status === 'ended' && recorder.recording) stopRecording();
    renderRecorder();
  };
  vRecord.addEventListener('click', () => void recordVideo());
  vStop.addEventListener('click', stopRecording);
  el(root, '#vRestart').addEventListener('click', () => {
    if (recorder.recording) recorder.reset();
    video.restart();
  });

  // ------------------------------------------------ YouTube without in-app search, and Suno: a new tab
  /** Opens a search in a new tab; the song's link is pasted back here. The tab closes once it's used. */
  let songWindow: Window | null = null;
  const closeSongTab = () => {
    if (songWindow && !songWindow.closed) songWindow.close();
    songWindow = null;
    el(root, '#serviceStage').classList.add('hidden');
  };
  const openSongTab = (url: string, service: string) => {
    closeSongTab();
    songWindow = window.open(url, '_blank');
    const stage = el(root, '#serviceStage');
    stage.innerHTML = `<p><b>${escapeHtml(service)} is open in a new tab.</b> Copy the song’s link there and paste it here:</p>
      <form class="linkRow"><input class="textInput" type="url" placeholder="Paste the ${escapeHtml(service)} link" required><button class="btn primary">Use this song</button></form>`;
    stage.classList.remove('hidden');
    el<HTMLFormElement>(stage, 'form').addEventListener('submit', event => {
      event.preventDefault();
      handleLink(el<HTMLInputElement>(stage, 'input').value.trim());
    });
  };

  // ------------------------------------------------ the search bar: a song name, or a link
  let source: SourceId = prefs.get('source', 'youtube');
  const sourceHint = el(root, '#sourceHint');
  const renderSources = () => {
    root.querySelectorAll<HTMLButtonElement>('[data-source]').forEach(button => button.setAttribute('aria-checked', String(button.dataset.source === source)));
    sourceHint.textContent = SOURCES.find(item => item.id === source)!.hint + '. The real lyrics are looked up by the song’s name.';
  };
  root.querySelectorAll<HTMLButtonElement>('[data-source]').forEach(button => button.addEventListener('click', () => {
    source = button.dataset.source as SourceId;
    prefs.set('source', source);
    renderSources();
    if (searchInput.value.trim()) el<HTMLFormElement>(root, '#searchForm').requestSubmit();
  }));
  renderSources();

  const searchYouTubeHere = async (query: string) => {
    if (!(await youtubeSearchAvailable())) { openSongTab(SOURCES[0].search(query), 'YouTube'); return; }
    findResults.innerHTML = '<p class="hint">Searching YouTube…</p>';
    try {
      const results = await searchYouTube(query);
      if (disposed) return;
      findResults.innerHTML = results.length ? results.map(result => `<button class="result" data-video="${escapeHtml(result.id)}" data-title="${escapeHtml(result.title)}">
          <img src="${escapeHtml(result.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">
          <span><strong>${escapeHtml(result.title)}</strong><small>${escapeHtml(result.channel)}</small></span></button>`).join('')
        : '<p class="hint">Nothing found — try adding the artist’s name.</p>';
      findResults.querySelectorAll<HTMLButtonElement>('[data-video]').forEach(button => button.addEventListener('click', () => {
        findResults.querySelectorAll('.result').forEach(node => node.classList.toggle('picked', node === button));
        void loadVideo(button.dataset.video!, button.dataset.title);
      }));
    } catch (error) {
      findResults.innerHTML = '';
      toast(error instanceof Error ? error.message : 'Search failed.', 'error');
    }
  };

  /** A pasted link: YouTube plays here; Suno and audio-file links download directly. */
  const handleLink = (url: string) => {
    const kind = classifyLink(url);
    if (kind === 'invalid') { toast('That doesn’t look like a link.', 'error'); return; }
    const id = youtubeId(url);
    if (id) { void loadVideo(id); return; }
    if (kind === 'suno' || kind === 'direct') { closeSongTab(); void start({ kind: 'link', url }); return; }
    toast((LINK_NAMES[kind] ?? 'That site') + ' songs can’t be recorded here. Download the song (buy it if needed), then use 📁 Upload a file.', 'error');
  };

  el<HTMLFormElement>(root, '#searchForm').addEventListener('submit', event => {
    event.preventDefault();
    const value = searchInput.value.trim();
    if (!value) { searchInput.focus(); return; }
    findResults.innerHTML = '';
    if (/^https?:\/\//i.test(value)) { handleLink(value); return; }
    songTitle = value;
    if (source === 'youtube') { void searchYouTubeHere(value); return; }
    openSongTab(SOURCES[1].search(value), 'Suno');
  });

  // ------------------------------------------------ library: open, download as a file, delete, import
  const songList = el(root, '#songList');
  const renderLibrary = async () => {
    let songs: StoredSong[] = [];
    try { songs = await listSongs(); } catch { /* storage unavailable */ }
    if (disposed) return;
    if (!songs.length) { songList.innerHTML = '<p class="empty">No songs yet — search for one above.</p>'; return; }
    songList.innerHTML = songs.map(song => {
      const a = song.analysis;
      const meta = [formatTime(a.duration), a.key ? keyName(a.key) : null, a.separated ? null : 'singer not separated']
        .filter(Boolean).join(' · ');
      return `<div class="songItem"><button class="songOpen" data-open="${song.id}"><strong>${escapeHtml(song.title)}</strong><small>${escapeHtml(meta)}</small></button>
        <button class="iconBtn small" data-download="${song.id}" title="Download this song as a file (tracks, lyrics, notes and takes)" aria-label="Download ${escapeHtml(song.title)}">⬇</button>
        <button class="iconBtn small" data-delete="${song.id}" title="Delete from this device" aria-label="Delete ${escapeHtml(song.title)}">✕</button></div>`;
    }).join('');
    songList.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(button => button.addEventListener('click', () => navigate('#/song/' + button.dataset.open)));
    songList.querySelectorAll<HTMLButtonElement>('[data-download]').forEach(button => button.addEventListener('click', async () => {
      const song = songs.find(item => item.id === button.dataset.download);
      if (!song) return;
      downloadBlob(await exportSong(song), song.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) + '.pitchcruzer');
    }));
    songList.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach(button => button.addEventListener('click', async () => {
      if (!confirm('Delete this song and its takes from this device?')) return;
      await deleteSong(button.dataset.delete!);
      void renderLibrary();
    }));
  };
  void renderLibrary();
  const importInput = el<HTMLInputElement>(root, '#importInput');
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    try {
      const song = await importSong(file);
      toast('Imported “' + song.title + '”.');
      void renderLibrary();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Couldn’t open that file.', 'error');
    }
  });

  return () => {
    disposed = true;
    abort?.abort();
    window.clearInterval(elapsedTimer);
    window.clearInterval(recorderTick);
    stopDiag();
    video.destroy();
    closeReview?.();
    recorder.close();
  };
}
