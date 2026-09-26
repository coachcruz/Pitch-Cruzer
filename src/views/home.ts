import { diagEntries, diagReset, onDiag, diag } from '../lib/diag';
import { deleteSong, listSongs, saveSong, type StoredSong } from '../lib/library';
import * as lalal from '../lib/lalal';
import { formatTime, keyName } from '../lib/music';
import { classifyLink, LANGUAGE_CHOICES, lyricsOptionsFrom, prepareSong, STEPS, type SongInput, type StepId } from '../lib/prepare';
import { CaptureMixer, type InputId } from '../lib/tabcapture';
import { showRecordingReview } from '../ui/recordingReview';
import { session } from '../session';
import { el, escapeHtml, prefs, toast } from '../ui/dom';

type LalalState = 'checking' | 'ready' | 'missing' | 'offline' | 'error';
let lalalState: LalalState = 'checking';
let lalalMinutes: number | null = null;

const STREAMING_NAMES: Record<string, string> = {
  youtube: 'YouTube', spotify: 'Spotify', apple: 'Apple Music', soundcloud: 'SoundCloud', other: 'This site'
};

function inputRow(id: string, name: string, connectLabel: string, help: string): string {
  return `<div class="inputRow" data-input="${id}">
    <button class="power" aria-pressed="false" aria-label="${name} on/off">⏻</button>
    <div class="inputInfo"><strong>${name}</strong><small class="inputStatus">Not connected</small></div>
    <div class="vu" aria-hidden="true"><span></span></div>
    <button class="btn small connect" data-label="${connectLabel}">${connectLabel}</button>
    <small class="inputHelp">${help}</small>
  </div>`;
}

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
        <li><b>Connect</b> the song’s tab below (keep “Share tab audio” on). Its meter moves when sound arrives.</li>
        <li>Press <b>● Record</b>, play the song from the start, then <b>■ Stop</b> — play it back, trim it, and prepare it.</li>
      </ol>

      <div class="inputs" role="group" aria-label="Recording inputs">
        ${inputRow('tab', 'Song (browser tab)', 'Connect tab', 'The song playing in another tab.')}
        ${inputRow('desktop', 'Desktop audio', 'Connect screen', 'Everything your computer plays. Windows / ChromeOS: share “Entire screen” with “Share system audio”. Not available on Mac.')}
        ${inputRow('mic', 'Microphone', 'Turn on mic', 'Usually leave off — your voice would be mixed into the song.')}
      </div>

      <div class="recordRow">
        <button id="recStart" class="btn record">● Record</button>
        <button id="recStop" class="btn danger hidden">■ Stop</button>
        <button id="recRestart" class="btn ghost hidden" title="Throw away what’s recorded and start over from the same inputs">↺ Restart</button>
        <span id="recTime" class="mono">0:00</span>
        <span id="recState" class="hint small"></span>
      </div>
      <div class="hint">Meters are silent — you see the level, you don’t hear it twice. Works in Chrome and Edge on a computer.</div>
    </div>

    <div id="capturePreview" class="capturePreview hidden">
      <video id="captureVideo" muted playsinline autoplay aria-label="Live preview of the tab being recorded"></video>
      <div>
        <strong>Recording this tab</strong>
        <p class="hint">Float it to keep watching the song while you stay here. The audio keeps recording either way.</p>
        <button id="capturePip" class="btn">⧉ Float the tab</button>
      </div>
    </div>

    <div id="capReviewHost"></div>

    <div class="options">
      <label class="check"><input id="useSeparation" type="checkbox" checked> Separate the singer from the music <small>(LALAL.AI — needed to turn the artist down)</small></label>
      <label class="check"><input id="keepSong" type="checkbox"> Keep this song on this device <small>(so you never have to prepare it again)</small></label>
      <div class="optionRow">
        <label class="inline">Lyrics language
          <select id="lyricsLang">${LANGUAGE_CHOICES.map(choice => `<option value="${choice.value}">${choice.label}</option>`).join('')}</select></label>
        <label class="inline">Lyrics accuracy
          <select id="lyricsQuality"><option value="fast">Faster (≈80 MB, recommended)</option><option value="best">Best (≈250 MB, several times slower)</option></select></label>
      </div>
    </div>
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
  lyricsQuality.value = prefs.get('lyricsQuality2', 'fast');
  lyricsLang.addEventListener('change', () => prefs.set('lyricsLang', lyricsLang.value));
  lyricsQuality.addEventListener('change', () => prefs.set('lyricsQuality2', lyricsQuality.value));

  const addCard = el(root, '.addSong');
  const progressCard = el(root, '#progressCard');
  const stepList = el(root, '#stepList');
  const prepError = el(root, '#prepError');
  let abort: AbortController | null = null;
  let disposed = false;
  const mixer = new CaptureMixer();
  let meterFrame = 0;
  let timerHandle: number | null = null;

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
    diagReset();
    prepStartedAt = stepStartedAt = performance.now();
    currentStep = null;
    diag('Started: ' + (input.kind === 'link' ? 'link' : input.kind) + (input.kind !== 'link' ? ' (' + ((input.kind === 'file' ? input.file : input.blob).size / 1048576).toFixed(1) + ' MB)' : '') + ' · separation ' + (separate ? 'on' : 'off'));
    renderSteps(states, !separate);
    progressCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const prepared = await prepareSong(input, separate, lyricsOptionsFrom(lyricsLang.value, lyricsQuality.value), (step, fraction, detail) => {
        if (step !== currentStep) {
          if (currentStep) diag('Finished: ' + currentStep + ' in ' + ((performance.now() - stepStartedAt) / 1000).toFixed(1) + 's', 'ok');
          currentStep = step;
          stepStartedAt = performance.now();
          diag('Step: ' + step);
        }
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
      diag('Failed during ' + (currentStep ?? 'start') + ': ' + message, 'error');
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

  // ------------------------------------------------ tab recording: input mixer + record / stop / restart
  const capturePreview = el(root, '#capturePreview');
  const captureVideo = el<HTMLVideoElement>(root, '#captureVideo');
  const capturePip = el<HTMLButtonElement>(root, '#capturePip');
  const pipSupported = 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;
  capturePip.classList.toggle('hidden', !pipSupported);
  capturePip.addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await captureVideo.requestPictureInPicture();
    } catch {
      toast('Couldn’t float the tab. Press “⧉ Float the tab” again.', 'error');
    }
  });
  captureVideo.addEventListener('enterpictureinpicture', () => { capturePip.textContent = '⧉ Bring it back'; });
  captureVideo.addEventListener('leavepictureinpicture', () => { capturePip.textContent = '⧉ Float the tab'; });
  const syncPreview = () => {
    const stream = mixer.videoStream;
    if (stream) {
      const current = captureVideo.srcObject as MediaStream | null;
      if (current?.getVideoTracks()[0] !== stream.getVideoTracks()[0]) {
        captureVideo.srcObject = stream;
        void captureVideo.play().catch(() => undefined);
      }
      capturePreview.classList.remove('hidden');
    } else {
      if (document.pictureInPictureElement === captureVideo) void document.exitPictureInPicture().catch(() => undefined);
      captureVideo.srcObject = null;
      capturePreview.classList.add('hidden');
    }
  };

  const recStart = el<HTMLButtonElement>(root, '#recStart');
  const recStop = el<HTMLButtonElement>(root, '#recStop');
  const recRestart = el<HTMLButtonElement>(root, '#recRestart');
  const recTime = el(root, '#recTime');
  const recState = el(root, '#recState');
  const reviewHost = el(root, '#capReviewHost');
  let closeReview: (() => void) | null = null;
  const INPUTS: InputId[] = ['tab', 'desktop', 'mic'];

  const shareError = (error: unknown) => {
    const name = error instanceof Error ? error.name : '';
    const message = name === 'NotAllowedError' ? 'Sharing was cancelled (or screen sharing is blocked for this browser in your system settings).'
      : name === 'NotSupportedError' || name === 'TypeError' ? 'This browser can’t share tab audio. Use Chrome or Edge on a computer, or upload a file.'
      : name === 'NotReadableError' || name === 'AbortError' ? 'The browser couldn’t start sharing. Close other screen-sharing apps and try again.'
      : error instanceof Error ? error.message : 'Couldn’t connect that input.';
    toast(message + (name && name !== 'Error' ? ' [' + name + ']' : ''), 'error');
  };

  const renderInputs = () => {
    for (const id of INPUTS) {
      const row = el(root, `[data-input="${id}"]`);
      const state = mixer.state(id);
      row.classList.toggle('connected', state.connected);
      row.classList.toggle('muted', state.connected && !state.on);
      const power = el<HTMLButtonElement>(row, '.power');
      power.setAttribute('aria-pressed', String(state.connected && state.on));
      power.title = !state.connected ? 'Not connected' : state.on ? 'On — recorded. Click to mute' : 'Muted — not recorded. Click to turn on';
      el(row, '.inputStatus').textContent = !state.connected ? 'Not connected' : (state.on ? 'On · ' : 'Muted · ') + state.label;
      el<HTMLButtonElement>(row, '.connect').textContent = state.connected ? 'Disconnect' : el(row, '.connect').dataset.label!;
    }
    const any = mixer.hasLiveInput;
    recStart.disabled = !any;
    recStart.title = any ? '' : 'Connect and switch on at least one input first';
    syncPreview();
  };
  mixer.onChange = renderInputs;

  // Silent meters: redraw every frame while anything is connected.
  const meters = () => {
    meterFrame = requestAnimationFrame(meters);
    for (const id of INPUTS) {
      const state = mixer.state(id);
      const bar = root.querySelector<HTMLElement>(`[data-input="${id}"] .vu span`);
      if (bar) bar.style.width = Math.round(state.level * 100) + '%';
    }
  };
  meters();

  root.querySelectorAll<HTMLElement>('[data-input]').forEach(row => {
    const id = row.dataset.input as InputId;
    const connect = async () => {
      if (!CaptureMixer.supported() && id !== 'mic') { toast('This browser can’t share tab audio. Use Chrome or Edge on a computer, or upload a file.', 'error'); return; }
      try {
        if (id === 'mic') await mixer.connectMic();
        else await mixer.connectShare(id);
        if (id !== 'mic') toast('Connected. Play the song in that tab — its meter should move.');
      } catch (error) {
        if (id === 'mic') toast('Microphone blocked. Allow the mic for this site and try again.', 'error');
        else shareError(error);
      }
      renderInputs();
    };
    el(row, '.connect').addEventListener('click', () => {
      if (mixer.state(id).connected) { mixer.disconnect(id); renderInputs(); }
      else void connect();
    });
    el(row, '.power').addEventListener('click', () => {
      const state = mixer.state(id);
      if (!state.connected) void connect();
      else mixer.setOn(id, !state.on);
    });
  });

  const setRecordingUi = (on: boolean) => {
    recStart.classList.toggle('hidden', on);
    recStop.classList.toggle('hidden', !on);
    recRestart.classList.toggle('hidden', !on);
    recState.textContent = on ? 'Recording…' : '';
    recTime.classList.toggle('live', on);
    if (timerHandle !== null) window.clearInterval(timerHandle);
    let warned = false;
    timerHandle = on ? window.setInterval(() => {
      recTime.textContent = formatTime(mixer.seconds);
      if (!warned && mixer.seconds > 6 && mixer.peak < 0.02) {
        warned = true;
        toast('Nothing audible is being recorded. Is the song playing, and is its input switched on?', 'error');
      }
    }, 200) : null;
  };

  const startRecording = () => {
    closeReview?.();
    closeReview = null;
    if (!mixer.hasLiveInput) { toast('Connect the song’s tab first.', 'error'); return; }
    mixer.startRecording();
    recTime.textContent = '0:00';
    setRecordingUi(true);
  };
  const stopRecording = () => {
    if (!mixer.recording) return;
    setRecordingUi(false);
    const recording = mixer.stopRecording();
    if (!recording) { toast('Nothing audible was recorded. Check that the song was playing and its input was on.', 'error'); return; }
    closeReview = showRecordingReview(reviewHost, recording, {
      use: wav => {
        closeReview = null;
        mixer.close();
        renderInputs();
        void start({ kind: 'recording', blob: wav, name: 'Recorded song ' + new Date().toLocaleDateString() + '.wav' });
      },
      redo: () => { closeReview = null; startRecording(); },
      discard: () => { closeReview = null; toast('Recording discarded.'); }
    });
    reviewHost.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  recStart.addEventListener('click', startRecording);
  recStop.addEventListener('click', stopRecording);
  recRestart.addEventListener('click', () => {
    mixer.reset();
    recTime.textContent = '0:00';
    toast('Starting over — play the song from the beginning.');
  });
  renderInputs();

  const openRecorder = () => el<HTMLButtonElement>(root, '[data-tab="tab"]').click();

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
        <button class="btn primary goRecorder">2 · Go to the recorder</button>
      </div>
      <p class="hint">In the recorder, press “Connect tab”, pick the tab you just opened (keep “Share tab audio” on), then Record.</p>`;
    linkRecord.classList.remove('hidden');
    el(linkRecord, '.goRecorder').addEventListener('click', openRecorder);
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
    cancelAnimationFrame(meterFrame);
    window.clearInterval(elapsedTimer);
    stopDiag();
    if (timerHandle !== null) window.clearInterval(timerHandle);
    closeReview?.();
    if (document.pictureInPictureElement === captureVideo) void document.exitPictureInPicture().catch(() => undefined);
    mixer.close();
  };
}
