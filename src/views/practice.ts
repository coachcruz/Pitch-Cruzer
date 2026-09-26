import { applyTypedLyrics, breathMarks, buildLines, NOTES_VERSION, relabel, SECTION_NAMES, type LyricLine, type Section, type SectionKind, type Syllable } from '../lib/analysis';
import { decodeAudio, downloadBlob, encodeWav } from '../lib/audio';
import { getSong, listTakes, saveSong, saveTake, deleteTake, type StoredSong, type StoredTake } from '../lib/library';
import { LiveMic } from '../lib/mic';
import { foldToOctave, formatTime, keyName, midiToFrequency, midiToNote, octaveOf, octaveRelation, voiceTypeNames, voiceTypesFor } from '../lib/music';
import { Player, Timeline, type Range } from '../lib/player';
import { decodeStems, LANGUAGE_CHOICES, lyricsOptionsFrom, pitchTrackFor, recheckNotes, transcribeLyrics, type SongBuffers } from '../lib/prepare';
import { coachingTip, mixdown, scoreTake, type TakeScore } from '../lib/score';
import { session } from '../session';
import { el, escapeHtml, prefs, toast } from '../ui/dom';
import { PitchLane, type TrailPoint } from '../ui/lane';

interface Review {
  voice: AudioBuffer;
  offset: number;
  baseOffset: number;
  ranges: Range[];
  repeats: number;
  timeline: Timeline;
  score: TakeScore;
  label: string;
  savedId?: string;
  singer?: string;
}

const KIND_ORDER: SectionKind[] = ['intro', 'verse', 'pre', 'chorus', 'bridge', 'instrumental', 'outro', 'part'];

export function renderPractice(root: HTMLElement, songId: string, navigate: (hash: string) => void): () => void {
  root.innerHTML = '<div class="card loading">Loading song…</div>';
  let cleanup: (() => void) | null = null;
  let disposed = false;

  (async () => {
    let song: StoredSong | null = session.song?.id === songId ? session.song : null;
    let buffers: SongBuffers | null = song ? session.buffers : null;
    if (!song) {
      song = (await getSong(songId).catch(() => undefined)) ?? null;
      if (!song) { root.innerHTML = '<div class="card"><p>That song isn’t on this device.</p><a class="btn" href="#/">Back to songs</a></div>'; return; }
      session.song = song;
      session.saved = true;
    }
    if (!buffers) {
      buffers = await decodeStems(song);
      session.buffers = buffers;
    }
    if (disposed) return;
    if ((song.analysis.notesVersion ?? 1) < NOTES_VERSION) {
      // Prepared with older note detection: re-check notes from the saved vocal (no LALAL minutes).
      root.innerHTML = '<div class="card loading">Updating this song’s notes with improved octave detection…</div>';
      const notesOnly = !song.analysis.lines.some(line => line.words.some(word => word.text !== '♪'));
      await recheckNotes(buffers.lead, song.analysis);
      if (notesOnly) song.analysis.lines = buildLines([], song.analysis.notes);
      if (session.saved) await saveSong(song).catch(() => undefined);
      toast('Notes re-checked with improved octave detection.');
    }
    if (disposed) return;
    cleanup = mount(root, song, buffers, navigate);
  })().catch(error => {
    console.error(error);
    root.innerHTML = '<div class="card"><p>Could not open this song.</p><a class="btn" href="#/">Back to songs</a></div>';
  });

  return () => { disposed = true; cleanup?.(); };
}

function noteLabel(syllable: Syllable): string {
  if (!syllable.notes.length) return syllable.midi === null ? '·' : midiToNote(syllable.midi);
  return syllable.notes.map(midiToNote).join('→');
}

function syllablesHtml(line: LyricLine, withData: boolean): string {
  return line.words.map(word => '<span class="word">' + word.syllables.map((syllable, index) => {
    const data = withData ? ` data-s="${syllable.start.toFixed(3)}" data-e="${syllable.end.toFixed(3)}"` : '';
    const hz = syllable.midi === null ? '' : ` title="${midiToNote(syllable.midi)} · ${midiToFrequency(Math.round(syllable.midi)).toFixed(0)} Hz"`;
    const joiner = index < word.syllables.length - 1 ? '<b class="hy">-</b>' : '';
    return `<span class="syl"${data}${hz}><i>${escapeHtml(noteLabel(syllable))}</i><span class="t">${escapeHtml(syllable.text)}${joiner}</span></span>`;
  }).join('') + '</span>').join(' ');
}

function mount(root: HTMLElement, song: StoredSong, buffers: SongBuffers, navigate: (hash: string) => void): () => void {
  const analysis = song.analysis;
  const hasBacking = Boolean(buffers.backing);
  const hasMusic = Boolean(buffers.instrumental);
  const range = analysis.range;

  root.innerHTML = `
  <div class="practice">
    <header class="songHead">
      <a href="#/" class="back" aria-label="Back to songs">←</a>
      <div class="songTitle">
        <h1 id="songTitle">${escapeHtml(song.title)}</h1>
        <p class="meta">${[
          analysis.key ? 'Key ' + keyName(analysis.key) : null,
          range ? 'Vocal range ' + midiToNote(range[0]) + '–' + midiToNote(range[1]) + ' (fits ' + voiceTypeNames(voiceTypesFor(range[0], range[1])) + ')' : null,
          formatTime(analysis.duration),
          analysis.separated ? null : 'Full mix (singer not separated)'
        ].filter(Boolean).map(value => escapeHtml(String(value))).join(' · ')}</p>
      </div>
      <div class="headActions">
        <button id="renameSong" class="btn ghost small">Rename</button>
        <button id="saveSong" class="btn small ${session.saved ? 'hidden' : ''}">Save to my songs</button>
      </div>
    </header>

    <section class="card focus">
      <div class="pickBar">
        <div id="songMap" class="songMap" role="group" aria-label="Song sections — pick one or more"></div>
        <div class="quick">
          <button class="chip" data-quick="all">Whole song</button>
          <button class="chip" data-quick="verse">Verses</button>
          <button class="chip" data-quick="chorus">Choruses</button>
          <button class="chip" data-quick="none">Clear</button>
          <button class="chip ghost" id="editSections" aria-pressed="false">Rename sections</button>
          <label class="inline">Repeat <select id="repeats"><option value="1">1×</option><option value="2">2×</option><option value="3">3×</option><option value="5">5×</option><option value="99">Loop</option></select></label>
          <span id="selectionLabel" class="selectionLabel"></span>
        </div>
      </div>

      <div class="stageRow">
        <div class="laneWrap"><canvas id="lane" aria-label="Lyrics scroll across the top; the artist’s notes are bars below, shaded by octave; your voice is the blue line"></canvas>
          <div id="countdown" class="countdown hidden"></div></div>
        <aside class="upNext" aria-label="Up next">
          <h3>Up next</h3>
          <ol id="upNext"></ol>
        </aside>
      </div>

      <div class="coach" id="coach" aria-live="off">
        <div><span class="label">Sing</span><strong id="coachTarget">—</strong><small id="coachTargetOct"></small></div>
        <div><span class="label">You</span><strong id="coachYou">—</strong><small id="coachYouOct"></small></div>
        <div class="coachHint" id="coachHint">Press play, then turn on your mic to see your voice on the lane.</div>
      </div>
      <div class="progress" id="progress" title="Jump to a spot"><span id="progressFill"></span></div>
      <div class="transport">
        <button id="play" class="btn primary big">▶ Play</button>
        <button id="stop" class="btn big" disabled>■ Stop</button>
        <button id="record" class="btn record big">● Record me</button>
        <button id="mic" class="btn big" aria-pressed="false">🎤 Mic off</button>
        <button id="mixToggle" class="btn big ghost" aria-expanded="false">🎚 Mix</button>
        <span id="clock" class="mono clock">0:00 / 0:00</span>
      </div>

      <div id="mixPanel" class="mixPanel hidden">
        <div class="mixRow">
          <label for="mixLead">Original singer</label>
          <input id="mixLead" type="range" min="0" max="100" step="1">
          <output id="mixLeadOut"></output>
          <div class="presets"><button class="chip" data-lead="0">Mute</button><button class="chip" data-lead="30">Guide</button><button class="chip" data-lead="100">Full</button></div>
        </div>
        <div class="mixRow ${hasBacking ? '' : 'disabled'}">
          <label for="mixBacking">Backing vocals</label>
          <input id="mixBacking" type="range" min="0" max="100" step="1" ${hasBacking ? '' : 'disabled'}>
          <output id="mixBackingOut"></output>
        </div>
        <div class="mixRow ${hasMusic ? '' : 'disabled'}">
          <label for="mixMusic">Music</label>
          <input id="mixMusic" type="range" min="0" max="100" step="1" ${hasMusic ? '' : 'disabled'}>
          <output id="mixMusicOut"></output>
        </div>
        <div class="mixRow">
          <label for="mixMonitor">Hear my mic <small>(headphones)</small></label>
          <input id="mixMonitor" type="range" min="0" max="100" step="1">
          <output id="mixMonitorOut"></output>
        </div>
        ${analysis.separated ? '' : '<p class="notice small">This song was prepared without vocal separation, so the singer can’t be turned down separately.</p>'}
        <div class="toggles">
          <label class="check"><input id="forgiveOctave" type="checkbox"> Forgive octave <small>(score the right note in any octave — your line still shows your real octave)</small></label>
          <label class="check"><input id="speakers" type="checkbox"> I’m on speakers, not headphones <small>(reduces echo)</small></label>
          <label class="check"><input id="countIn" type="checkbox"> Count me in before recording</label>
          <label class="check"><input id="showVoices" type="checkbox"> Show voice types <small>(bass, baritone, tenor… beside the octaves)</small></label>
        </div>
      </div>
    </section>

    <section id="review" class="card review hidden" aria-live="polite"></section>

    <details class="card fold" id="lyricsFold">
      <summary><h2>Full lyrics &amp; notes</h2><span class="hint small">study the whole song, pick lines, fix or redo lyrics</span></summary>
      <div class="row wrap tools">
        <button id="pickLines" class="chip ghost" aria-pressed="false">Pick lines to practice</button>
        <button id="fixLyrics" class="chip ghost">Fix lyrics</button>
        <button id="redoLyrics" class="chip ghost">Redo lyrics (language)</button>
        <label class="check small"><input id="showNotes" type="checkbox"> Show notes</label>
      </div>
      <p id="lyricsHint" class="hint small">${analysis.transcript === 'failed' || analysis.transcript === 'none'
        ? 'Lyrics couldn’t be heard automatically — use “Redo lyrics” or “Fix lyrics”. Notes are still shown.'
        : 'Tap a line to play from there.'}</p>
      <div id="lyricsList" class="lyricsList"></div>
    </details>

    <details class="card fold" id="takesFold">
      <summary><h2>Takes &amp; scores</h2><span class="hint small">pass the mic around — highest score wins</span></summary>
      <div id="takesList"><p class="empty">Record yourself and save your takes here.</p></div>
    </details>

    <dialog id="redoDialog" class="dialog">
      <form method="dialog">
        <h2>Redo the lyrics</h2>
        <p class="hint">Listens to the singer again, phrase by phrase. For bilingual songs pick both languages — each line gets its own language.</p>
        <label class="inline">Language <select id="redoLang">${LANGUAGE_CHOICES.map(choice => `<option value="${choice.value}">${choice.label}</option>`).join('')}</select></label>
        <label class="inline">Accuracy <select id="redoQuality"><option value="best">Best (≈250 MB download, first time only)</option><option value="fast">Faster (≈80 MB)</option></select></label>
        <p id="redoStatus" class="hint small"></p>
        <div class="row end"><button class="btn ghost" value="cancel" id="redoCancel">Cancel</button><button id="redoStart" class="btn primary" type="button">Redo lyrics</button></div>
      </form>
    </dialog>

    <dialog id="lyricsDialog" class="dialog">
      <form method="dialog">
        <h2>Fix the lyrics</h2>
        <p class="hint">Paste or type the correct lyrics — one line per sung line. Timing is matched to the singer automatically.</p>
        <textarea id="lyricsText" rows="14"></textarea>
        <div class="row end"><button class="btn ghost" value="cancel">Cancel</button><button id="applyLyrics" class="btn primary" value="apply">Apply</button></div>
      </form>
    </dialog>
  </div>`;

  // ---------------------------------------------------------------- state
  const player = new Player(buffers);
  const mic = new LiveMic(player.ctx);
  // Conveyor text: "clo-" "ser" so split words still read as one word.
  const allSyllables = () => analysis.lines.flatMap(line => line.words.flatMap(word => word.syllables.map((syllable, index) =>
    index < word.syllables.length - 1 ? { ...syllable, text: syllable.text + '-' } : syllable)));
  const lane = new PitchLane(el<HTMLCanvasElement>(root, '#lane'), analysis.notes, allSyllables(), analysis.range, analysis.key, breathMarks(analysis.notes));

  let selected = new Set<string>();
  let custom: { start: number; end: number; label: string } | null = null;
  let editingSections = false;
  let pickingLines = false;
  let pickAnchor: LyricLine | null = null;
  let liveTrail: TrailPoint[] = [];
  let lastSource = -1;
  let idleTime = 0;
  let recording = false;
  let recordingOrigin = 0;
  let review: Review | null = null;
  let reviewPlaying = false;
  let frame = 0;
  let disposed = false;

  const levels = {
    lead: prefs.get('mix.lead', 100), backing: prefs.get('mix.backing', 100),
    music: prefs.get('mix.music', 100), monitor: prefs.get('mix.monitor', 0), voice: 100
  };
  const forgiveOctave = el<HTMLInputElement>(root, '#forgiveOctave');
  const speakers = el<HTMLInputElement>(root, '#speakers');
  const countIn = el<HTMLInputElement>(root, '#countIn');
  forgiveOctave.checked = prefs.get('forgiveOctave', false);
  speakers.checked = prefs.get('speakers', false);
  countIn.checked = prefs.get('countIn', true);
  lane.forgiveOctave = forgiveOctave.checked;

  const persist = async () => {
    if (!session.saved) return;
    try { await saveSong(song); } catch { toast('Could not save changes on this device.', 'error'); }
  };

  // ---------------------------------------------------------------- selection
  const selectedRanges = (): Range[] => {
    if (custom) return [{ start: custom.start, end: custom.end }];
    const chosen = analysis.sections.filter(section => selected.has(section.id)).sort((a, b) => a.start - b.start);
    if (!chosen.length) return [{ start: 0, end: analysis.duration }];
    const ranges: Range[] = [];
    for (const section of chosen) {
      const last = ranges[ranges.length - 1];
      if (last && Math.abs(last.end - section.start) < 0.05) last.end = section.end;
      else ranges.push({ start: section.start, end: section.end });
    }
    return ranges;
  };
  const repeatsEl = el<HTMLSelectElement>(root, '#repeats');
  const repeats = () => Number(repeatsEl.value) || 1;

  const inSelection = (time: number) => selectedRanges().some(r => time >= r.start && time < r.end);

  const renderSections = () => {
    const map = el(root, '#songMap');
    map.innerHTML = analysis.sections.map(section => {
      const width = ((section.end - section.start) / analysis.duration) * 100;
      const on = selected.has(section.id) || (custom && custom.start < section.end && custom.end > section.start);
      const editor = editingSections
        ? `<select data-kind="${section.id}" aria-label="Section type">${KIND_ORDER.map(kind => `<option value="${kind}" ${kind === section.kind ? 'selected' : ''}>${SECTION_NAMES[kind]}</option>`).join('')}</select>`
        : '';
      return `<div class="seg kind-${section.kind} ${on ? 'on' : ''}" style="flex-grow:${Math.max(width, 3).toFixed(2)}">
        <button data-section="${section.id}" aria-pressed="${on ? 'true' : 'false'}"><strong>${escapeHtml(section.label)}</strong><small>${formatTime(section.start)}</small></button>${editor}</div>`;
    }).join('');
    map.querySelectorAll<HTMLButtonElement>('[data-section]').forEach(button => button.addEventListener('click', () => {
      const id = button.dataset.section!;
      custom = null;
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      selectionChanged();
    }));
    map.querySelectorAll<HTMLSelectElement>('[data-kind]').forEach(select => select.addEventListener('change', () => {
      const section = analysis.sections.find(item => item.id === select.dataset.kind);
      if (!section) return;
      section.kind = select.value as SectionKind;
      analysis.sections = relabel(analysis.sections);
      void persist();
      renderSections();
      renderLyrics();
    }));

    const ranges = selectedRanges();
    const total = ranges.reduce((sum, r) => sum + r.end - r.start, 0);
    const names = custom ? custom.label
      : selected.size ? analysis.sections.filter(s => selected.has(s.id)).map(s => s.label).join(' + ')
      : 'Whole song';
    el(root, '#selectionLabel').innerHTML = `Practicing: <b>${escapeHtml(names)}</b> · ${formatTime(total)}${repeats() > 1 ? ' × ' + (repeats() === 99 ? '∞' : repeats()) : ''}`;
  };

  const selectionChanged = () => {
    if (player.state !== 'stopped' && !recording) stopAll();
    const first = selectedRanges()[0];
    idleTime = first.start;
    liveTrail = [];
    renderSections();
    renderLyrics();
    updateClock();
  };

  root.querySelectorAll<HTMLButtonElement>('[data-quick]').forEach(button => button.addEventListener('click', () => {
    custom = null;
    const quick = button.dataset.quick;
    selected = new Set(
      quick === 'all' || quick === 'none' ? [] : analysis.sections.filter(s => s.kind === quick).map(s => s.id)
    );
    if ((quick === 'verse' || quick === 'chorus') && !selected.size) toast('No ' + (quick === 'verse' ? 'verses' : 'choruses') + ' were detected. Use “Rename sections” to label them.');
    selectionChanged();
  }));
  el(root, '#editSections').addEventListener('click', event => {
    editingSections = !editingSections;
    (event.currentTarget as HTMLElement).setAttribute('aria-pressed', String(editingSections));
    renderSections();
  });
  repeatsEl.value = String(prefs.get('repeats', 1));
  repeatsEl.addEventListener('change', () => { prefs.set('repeats', repeats()); renderSections(); });

  // Start on the first chorus (or first sung section) — the part most people want to try first.
  const firstPick = analysis.sections.find(s => s.kind === 'chorus') ?? analysis.sections.find(s => !['intro', 'outro', 'instrumental'].includes(s.kind));
  if (firstPick) selected.add(firstPick.id);

  // ---------------------------------------------------------------- lyrics sheet
  const sectionFor = (time: number): Section | undefined => analysis.sections.find(s => time >= s.start && time < s.end);

  const renderLyrics = () => {
    const list = el(root, '#lyricsList');
    let lastSection: string | null = null;
    list.innerHTML = analysis.lines.map(line => {
      const section = sectionFor(line.start);
      const header = section && section.id !== lastSection ? `<div class="lyricsSection kind-${section.kind}">${escapeHtml(section.label)}</div>` : '';
      lastSection = section?.id ?? lastSection;
      const outside = !inSelection(line.start + 0.01);
      const anchor = pickAnchor?.id === line.id ? ' anchor' : '';
      const scored = review?.score.lines.find(item => item.line.id === line.id);
      const scoreClass = scored ? (scored.percent >= 70 ? ' good' : scored.percent >= 40 ? ' ok' : ' bad') : '';
      return header + `<button class="lyricLine${outside ? ' outside' : ''}${anchor}${scoreClass}" data-line="${line.id}">
        <span class="lineTime">${formatTime(line.start)}</span><span class="lineText">${syllablesHtml(line, false)}</span>
        ${scored ? `<span class="lineScore">${scored.percent}%</span>` : ''}</button>`;
    }).join('') || '<p class="empty">No sung lines were found.</p>';

    list.querySelectorAll<HTMLButtonElement>('[data-line]').forEach(button => button.addEventListener('click', () => {
      const line = analysis.lines.find(item => item.id === button.dataset.line);
      if (!line) return;
      if (pickingLines) {
        if (!pickAnchor) { pickAnchor = line; renderLyrics(); toast('Now tap the last line you want.'); return; }
        const [a, b] = pickAnchor.start <= line.start ? [pickAnchor, line] : [line, pickAnchor];
        const ia = analysis.lines.indexOf(a) + 1, ib = analysis.lines.indexOf(b) + 1;
        custom = { start: Math.max(0, a.start - 1.2), end: Math.min(analysis.duration, b.end + 0.6), label: ia === ib ? 'Line ' + ia : 'Lines ' + ia + '–' + ib };
        selected.clear();
        pickAnchor = null;
        setPicking(false);
        selectionChanged();
        return;
      }
      if (recording) return;
      if (!inSelection(line.start)) {
        custom = null;
        const section = sectionFor(line.start);
        selected = new Set(section ? [section.id] : []);
        selectionChanged();
      }
      const from = new Timeline(selectedRanges(), repeats()).timelineFor(Math.max(0, line.start - 0.6)) ?? 0;
      void startPlayback(false, from);
    }));
  };

  const setPicking = (on: boolean) => {
    pickingLines = on;
    pickAnchor = null;
    const button = el(root, '#pickLines');
    button.setAttribute('aria-pressed', String(on));
    button.textContent = on ? 'Cancel picking' : 'Pick lines';
    el(root, '#lyricsHint').textContent = on
      ? 'Tap the first line you want to practice, then the last one.'
      : 'Tap a line to play from there.';
    renderLyrics();
  };
  el(root, '#pickLines').addEventListener('click', () => setPicking(!pickingLines));

  const dialog = el<HTMLDialogElement>(root, '#lyricsDialog');
  const showNotes = el<HTMLInputElement>(root, '#showNotes');
  showNotes.checked = prefs.get('showNotes', false);
  const applyShowNotes = () => el(root, '#lyricsList').classList.toggle('hideNotes', !showNotes.checked);
  showNotes.addEventListener('change', () => { prefs.set('showNotes', showNotes.checked); applyShowNotes(); });
  applyShowNotes();

  const redoDialog = el<HTMLDialogElement>(root, '#redoDialog');
  const redoLang = el<HTMLSelectElement>(root, '#redoLang');
  const redoQuality = el<HTMLSelectElement>(root, '#redoQuality');
  const redoStatus = el(root, '#redoStatus');
  const redoStart = el<HTMLButtonElement>(root, '#redoStart');
  let redoing = false;
  el(root, '#redoLyrics').addEventListener('click', () => {
    const current = analysis.lyricsOptions;
    redoLang.value = current
      ? (LANGUAGE_CHOICES.find(choice => choice.value === current.languages.join(','))?.value ?? 'auto')
      : prefs.get('lyricsLang', 'auto');
    redoQuality.value = current?.quality ?? prefs.get('lyricsQuality', 'best');
    redoStatus.textContent = '';
    redoDialog.showModal();
  });
  redoDialog.addEventListener('cancel', event => { if (redoing) event.preventDefault(); });
  redoStart.addEventListener('click', async () => {
    if (redoing) return;
    redoing = true;
    redoStart.disabled = true;
    el<HTMLButtonElement>(root, '#redoCancel').disabled = true;
    if (player.state !== 'stopped') stopAll();
    prefs.set('lyricsLang', redoLang.value);
    prefs.set('lyricsQuality', redoQuality.value);
    try {
      const heard = await transcribeLyrics(buffers.lead, analysis, lyricsOptionsFrom(redoLang.value, redoQuality.value), (step, fraction, detail) => {
        if (!disposed) redoStatus.textContent = (step === 'lyrics' ? 'Lyrics' : 'Sections') + ' · ' + Math.round(fraction * 100) + '%' + (detail ? ' — ' + detail : '');
      });
      if (!heard) {
        redoStatus.textContent = 'Couldn’t hear clear words (or the lyrics model couldn’t download). Your current lyrics were kept.';
        return;
      }
      lane.setLyrics(allSyllables());
      selected = new Set();
      custom = null;
      review = null;
      el(root, '#review').classList.add('hidden');
      upNextKey = '';
      void persist();
      selectionChanged();
      el(root, '#lyricsHint').textContent = 'Tap a line to play from there.';
      toast('Lyrics redone.');
      redoDialog.close();
    } finally {
      redoing = false;
      redoStart.disabled = false;
      el<HTMLButtonElement>(root, '#redoCancel').disabled = false;
    }
  });

  el(root, '#fixLyrics').addEventListener('click', () => {
    el<HTMLTextAreaElement>(root, '#lyricsText').value = analysis.lines
      .map(line => line.words.map(word => word.text).join(' ')).filter(text => !/^[♪\s]+$/.test(text)).join('\n');
    dialog.showModal();
  });
  dialog.addEventListener('close', () => {
    if (dialog.returnValue !== 'apply') return;
    const text = el<HTMLTextAreaElement>(root, '#lyricsText').value;
    if (!text.trim()) return;
    analysis.lines = applyTypedLyrics(analysis, text);
    analysis.transcript = 'edited';
    el(root, '#lyricsHint').textContent = 'Tap a line to play from there.';
    lane.setLyrics(allSyllables());
    upNextKey = '';
    review = null;
    el(root, '#review').classList.add('hidden');
    void persist();
    renderLyrics();
    toast('Lyrics updated.');
  });

  el(root, '#renameSong').addEventListener('click', () => {
    const name = prompt('Song name', song.title)?.trim();
    if (!name) return;
    song.title = name;
    el(root, '#songTitle').textContent = name;
    void persist();
  });
  el(root, '#saveSong').addEventListener('click', async () => {
    try {
      await saveSong(song);
      session.saved = true;
      el(root, '#saveSong').classList.add('hidden');
      toast('Saved to My songs on this device.');
      void renderTakes();
    } catch { toast('Could not save (storage may be full).', 'error'); }
  });

  // ---------------------------------------------------------------- mixer
  const bindSlider = (id: string, key: keyof typeof levels, apply: (value: number) => void) => {
    const input = el<HTMLInputElement>(root, '#' + id);
    const out = el<HTMLOutputElement>(root, '#' + id + 'Out');
    const set = (value: number) => {
      levels[key] = value;
      input.value = String(value);
      out.textContent = value === 0 ? 'Off' : value + '%';
      apply(value / 100);
      if (key !== 'voice') prefs.set('mix.' + key, value);
    };
    input.addEventListener('input', () => set(Number(input.value)));
    set(levels[key]);
    return set;
  };
  const setLead = bindSlider('mixLead', 'lead', value => player.setLevel('lead', value));
  bindSlider('mixBacking', 'backing', value => player.setLevel('backing', value));
  bindSlider('mixMusic', 'music', value => player.setLevel('music', value));
  bindSlider('mixMonitor', 'monitor', value => mic.setMonitor(value));
  root.querySelectorAll<HTMLButtonElement>('[data-lead]').forEach(button => button.addEventListener('click', () => setLead(Number(button.dataset.lead))));
  forgiveOctave.addEventListener('change', () => {
    prefs.set('forgiveOctave', forgiveOctave.checked);
    lane.forgiveOctave = forgiveOctave.checked;
    rescore();
  });
  const showVoices = el<HTMLInputElement>(root, '#showVoices');
  showVoices.checked = prefs.get('showVoices', window.innerWidth >= 700);
  lane.showVoiceTypes = showVoices.checked;
  showVoices.addEventListener('change', () => { prefs.set('showVoices', showVoices.checked); lane.showVoiceTypes = showVoices.checked; });
  const mixToggle = el<HTMLButtonElement>(root, '#mixToggle');
  mixToggle.addEventListener('click', () => {
    const open = el(root, '#mixPanel').classList.toggle('hidden') === false;
    mixToggle.setAttribute('aria-expanded', String(open));
  });
  speakers.addEventListener('change', () => {
    prefs.set('speakers', speakers.checked);
    if (mic.active) void enableMic();
  });
  countIn.addEventListener('change', () => prefs.set('countIn', countIn.checked));

  // ---------------------------------------------------------------- mic
  const micButton = el<HTMLButtonElement>(root, '#mic');
  const renderMicButton = () => {
    micButton.textContent = mic.active ? '🎤 Mic on' : '🎤 Mic off';
    micButton.setAttribute('aria-pressed', String(mic.active));
    micButton.classList.toggle('on', mic.active);
  };
  const enableMic = async (): Promise<boolean> => {
    try {
      await mic.start(speakers.checked);
      mic.setMonitor(levels.monitor / 100);
      renderMicButton();
      return true;
    } catch {
      toast('Microphone blocked. Allow the mic for this site (padlock icon in the address bar) and try again.', 'error');
      renderMicButton();
      return false;
    }
  };
  micButton.addEventListener('click', () => {
    if (recording) return;
    if (mic.active) { mic.stop(); renderMicButton(); el(root, '#coachYou').textContent = '—'; } else void enableMic();
  });

  // ---------------------------------------------------------------- transport
  const playButton = el<HTMLButtonElement>(root, '#play');
  const stopButton = el<HTMLButtonElement>(root, '#stop');
  const recordButton = el<HTMLButtonElement>(root, '#record');
  const countdown = el(root, '#countdown');

  const renderTransport = () => {
    const active = player.state !== 'stopped';
    playButton.textContent = player.state === 'playing' ? '❚❚ Pause' : player.state === 'paused' ? '▶ Resume' : '▶ Play';
    playButton.disabled = recording;
    stopButton.disabled = !active;
    recordButton.disabled = active && !recording;
    recordButton.textContent = recording ? '■ Finish take' : '● Record me';
    recordButton.classList.toggle('live', recording);
  };

  const beep = (when: number, accent: boolean) => {
    const osc = player.ctx.createOscillator();
    const gain = player.ctx.createGain();
    osc.frequency.value = accent ? 1320 : 880;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.35, when + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
    osc.connect(gain).connect(player.ctx.destination);
    osc.start(when);
    osc.stop(when + 0.15);
  };

  const showCountdown = (origin: number) => {
    const tick = () => {
      const left = origin - player.ctx.currentTime;
      if (left <= 0 || player.state === 'stopped') { countdown.classList.add('hidden'); return; }
      countdown.classList.remove('hidden');
      countdown.textContent = String(Math.ceil(left / 0.6));
      requestAnimationFrame(tick);
    };
    tick();
  };

  const startPlayback = async (withRecording: boolean, from = 0, voice?: { buffer: AudioBuffer; offset: number }) => {
    reviewPlaying = Boolean(voice);
    if (!voice) lane.trail = liveTrail;
    liveTrail.length = 0;
    lastSource = -1;
    const useCountIn = withRecording && countIn.checked;
    const leadIn = useCountIn ? 1.9 : 0.12;
    const ranges = voice && review ? review.ranges : selectedRanges();
    const reps = voice && review ? review.repeats : repeats();
    player.setLevel('voice', voice ? levels.voice / 100 : 0);
    if (withRecording) mic.startRecording();
    const origin = await player.play(ranges, reps, { from, leadIn, voice });
    if (useCountIn) {
      [1.8, 1.2, 0.6].forEach((before, index) => beep(origin - before, index === 0));
      showCountdown(origin);
    }
    recordingOrigin = origin;
    renderTransport();
  };

  const stopAll = () => {
    player.stop(true);
  };

  player.onEnded = () => {
    if (recording) void finishRecording();
    reviewPlaying = false;
    lane.trail = liveTrail;
    countdown.classList.add('hidden');
    renderTransport();
    renderReviewButtons();
  };

  playButton.addEventListener('click', async () => {
    if (player.state === 'playing') { await player.pause(); renderTransport(); return; }
    if (player.state === 'paused') { await player.resume(); renderTransport(); return; }
    await startPlayback(false);
  });
  stopButton.addEventListener('click', () => stopAll());

  recordButton.addEventListener('click', async () => {
    if (recording) { stopAll(); return; }
    if (!(await enableMic())) return;
    if (!mic.canRecord) { toast('This browser can’t record here. Try Chrome, Edge or Safari.', 'error'); return; }
    if (repeats() === 99) { repeatsEl.value = '1'; renderSections(); }
    recording = true;
    review = null;
    el(root, '#review').classList.add('hidden');
    await startPlayback(true);
    toast(speakers.checked ? 'Recording — sing along!' : 'Recording — sing along! (Headphones give the cleanest take.)');
  });

  const finishRecording = async () => {
    recording = false;
    renderTransport();
    const result = mic.stopRecording();
    if (!result || result.samples.length < result.sampleRate * 0.5) { toast('No audio was recorded from the mic.', 'error'); return; }
    const reviewEl = el(root, '#review');
    reviewEl.classList.remove('hidden');
    reviewEl.innerHTML = '<p>Scoring your take…</p>';
    // What you sang at clock time T answers music you heard at T − output latency − input latency.
    const latency = (player.ctx.outputLatency || 0) + (player.ctx.baseLatency || 0) + 0.02;
    const offset = result.startTime - recordingOrigin - latency;
    const voice = player.ctx.createBuffer(1, result.samples.length, result.sampleRate);
    voice.copyToChannel(result.samples, 0);
    const ranges = selectedRanges();
    const reps = repeats();
    await buildReview(voice, offset, ranges, reps, labelForSelection());
    reviewEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const labelForSelection = () => custom ? custom.label
    : selected.size ? analysis.sections.filter(s => selected.has(s.id)).map(s => s.label).join(' + ') : 'Whole song';

  // ---------------------------------------------------------------- review
  let voiceTrack: Awaited<ReturnType<typeof pitchTrackFor>> | null = null;

  const buildReview = async (voice: AudioBuffer, offset: number, ranges: Range[], reps: number, label: string, saved?: StoredTake) => {
    const timeline = new Timeline(ranges, reps);
    voiceTrack = await pitchTrackFor(voice);
    const score = scoreTake(voiceTrack, offset, timeline, analysis.notes, analysis.lines, forgiveOctave.checked);
    review = { voice, offset, baseOffset: saved ? saved.offsetSeconds : offset, ranges, repeats: reps, timeline, score, label, savedId: saved?.id, singer: saved?.singer };
    renderReview();
    renderLyrics();
  };

  const rescore = () => {
    if (!review || !voiceTrack) return;
    review.score = scoreTake(voiceTrack, review.offset, review.timeline, analysis.notes, analysis.lines, forgiveOctave.checked);
    renderReview();
    renderLyrics();
  };

  const renderReviewButtons = () => {
    const button = root.querySelector<HTMLButtonElement>('#reviewPlay');
    if (button) button.textContent = reviewPlaying ? '■ Stop' : '▶ Listen to my take';
  };

  const renderReview = () => {
    if (!review) return;
    const s = review.score;
    const reviewEl = el(root, '#review');
    const grade = s.score >= 85 ? 'Superstar' : s.score >= 70 ? 'Great' : s.score >= 50 ? 'Nice work' : s.score >= 30 ? 'Getting there' : 'Keep going';
    const cents = s.meanCents === null ? '—' : (Math.abs(s.meanCents) < 10 ? 'centered' : Math.abs(Math.round(s.meanCents)) + '¢ ' + (s.meanCents < 0 ? 'flat' : 'sharp'));
    reviewEl.innerHTML = `
      <div class="cardHead"><h2>Your take · ${escapeHtml(review.label)}</h2><button id="reviewClose" class="btn ghost small">Close</button></div>
      <div class="scoreRow">
        <div class="bigScore"><strong>${s.score}</strong><span>${grade}</span></div>
        <div class="stats">
          <div><span>On the note</span><b>${s.onPitchWhenSinging}%</b></div>
          <div><span>Sang along</span><b>${s.coverage}%</b></div>
          <div><span>Average</span><b>${cents}</b></div>
        </div>
      </div>
      <p class="tip">💡 ${escapeHtml(coachingTip(s))}</p>
      <div class="row wrap">
        <button id="reviewPlay" class="btn primary">▶ Listen to my take</button>
        <label class="inline">My voice <input id="voiceLevel" type="range" min="0" max="150" value="${levels.voice}"></label>
        <label class="inline" title="If your voice sounds early or late against the music, nudge it here">Sync <input id="syncOffset" type="range" min="-300" max="300" step="10" value="${Math.round((review.offset - review.baseOffset) * 1000)}"><output id="syncOut">${Math.round((review.offset - review.baseOffset) * 1000)} ms</output></label>
      </div>
      <div class="row wrap">
        <input id="singerName" class="textInput" placeholder="Singer name" value="${escapeHtml(review.singer ?? prefs.get('singer', ''))}" maxlength="40">
        <button id="saveTake" class="btn">${review.savedId ? 'Update saved take' : 'Save take'}</button>
        <button id="downloadMix" class="btn ghost">Download mix (WAV)</button>
        <button id="downloadVoice" class="btn ghost">Download my voice only</button>
      </div>
      <p class="hint small">Lines in the lyrics list are now colored by how close you were. Tap one to hear the original again.</p>`;
    el(reviewEl, '#reviewClose').addEventListener('click', () => {
      if (reviewPlaying) stopAll();
      review = null;
      reviewEl.classList.add('hidden');
      lane.trail = liveTrail;
      renderLyrics();
    });
    el(reviewEl, '#reviewPlay').addEventListener('click', async () => {
      if (!review) return;
      if (reviewPlaying) { stopAll(); return; }
      lane.trail = review.score.trail;
      await startPlayback(false, 0, { buffer: review.voice, offset: review.offset });
      lane.trail = review.score.trail;
      renderReviewButtons();
    });
    const voiceLevel = el<HTMLInputElement>(reviewEl, '#voiceLevel');
    voiceLevel.addEventListener('input', () => { levels.voice = Number(voiceLevel.value); if (reviewPlaying) player.setLevel('voice', levels.voice / 100); });
    const sync = el<HTMLInputElement>(reviewEl, '#syncOffset');
    sync.addEventListener('input', () => { el(reviewEl, '#syncOut').textContent = sync.value + ' ms'; });
    sync.addEventListener('change', () => {
      if (!review) return;
      review.offset = review.baseOffset + Number(sync.value) / 1000;
      if (reviewPlaying) stopAll();
      rescore();
    });
    el(reviewEl, '#downloadMix').addEventListener('click', async () => {
      if (!review) return;
      toast('Mixing your take…');
      const blob = await mixdown(buffers, review.timeline, {
        lead: levels.lead / 100, backing: levels.backing / 100, music: levels.music / 100, voice: levels.voice / 100
      }, review.voice, review.offset);
      downloadBlob(blob, safeName(song.title + ' - ' + (el<HTMLInputElement>(reviewEl, '#singerName').value || 'my take')) + '.wav');
    });
    el(reviewEl, '#downloadVoice').addEventListener('click', () => {
      if (!review) return;
      downloadBlob(encodeWav([review.voice.getChannelData(0)], review.voice.sampleRate), safeName(song.title + ' - my voice') + '.wav');
    });
    el(reviewEl, '#saveTake').addEventListener('click', async () => {
      if (!review) return;
      const singer = el<HTMLInputElement>(reviewEl, '#singerName').value.trim() || 'Me';
      prefs.set('singer', singer);
      try {
        if (!session.saved) {
          await saveSong(song);
          session.saved = true;
          el(root, '#saveSong').classList.add('hidden');
        }
        const take: StoredTake = {
          id: review.savedId ?? crypto.randomUUID(),
          songId: song.id,
          singer,
          createdAt: Date.now(),
          score: review.score.score,
          label: review.label,
          voice: encodeWav([review.voice.getChannelData(0)], review.voice.sampleRate),
          sampleRate: review.voice.sampleRate,
          segments: review.ranges,
          offsetSeconds: review.offset
        };
        await saveTake(take);
        review.savedId = take.id;
        review.singer = singer;
        toast('Take saved for ' + singer + '.');
        renderReview();
        void renderTakes();
      } catch { toast('Could not save the take (storage may be full).', 'error'); }
    });
  };

  // ---------------------------------------------------------------- takes / leaderboard
  const renderTakes = async () => {
    const list = el(root, '#takesList');
    if (!session.saved) return;
    let takes: StoredTake[] = [];
    try { takes = await listTakes(song.id); } catch { return; }
    if (disposed || !takes.length) return;
    list.innerHTML = '<ol class="board">' + takes.map((take, index) => `<li>
      <span class="rank">${index === 0 ? '🏆' : index + 1}</span>
      <span class="who"><b>${escapeHtml(take.singer)}</b><small>${escapeHtml(take.label)} · ${new Date(take.createdAt).toLocaleDateString()}</small></span>
      <span class="pts">${take.score}</span>
      <button class="btn ghost small" data-open-take="${take.id}">Open</button>
      <button class="btn ghost small" data-delete-take="${take.id}" aria-label="Delete take">✕</button></li>`).join('') + '</ol>';
    list.querySelectorAll<HTMLButtonElement>('[data-open-take]').forEach(button => button.addEventListener('click', async () => {
      const take = takes.find(item => item.id === button.dataset.openTake);
      if (!take) return;
      if (player.state !== 'stopped') stopAll();
      const voice = await decodeAudio(await take.voice.arrayBuffer());
      el(root, '#review').classList.remove('hidden');
      await buildReview(voice, take.offsetSeconds, take.segments, 1, take.label, take);
      el(root, '#review').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));
    list.querySelectorAll<HTMLButtonElement>('[data-delete-take]').forEach(button => button.addEventListener('click', async () => {
      if (!confirm('Delete this take?')) return;
      await deleteTake(button.dataset.deleteTake!);
      list.innerHTML = '<p class="empty">No saved takes.</p>';
      void renderTakes();
    }));
  };

  // ---------------------------------------------------------------- progress + clock
  const progress = el(root, '#progress');
  const progressFill = el(root, '#progressFill');
  const clock = el(root, '#clock');
  const updateClock = () => {
    const total = player.state !== 'stopped' ? player.totalDuration : new Timeline(selectedRanges(), repeats() === 99 ? 1 : repeats()).duration;
    const t = Math.max(0, Math.min(total, player.timelineTime()));
    clock.textContent = formatTime(t) + ' / ' + formatTime(total);
    progressFill.style.width = (total ? (100 * t) / total : 0).toFixed(2) + '%';
  };
  progress.addEventListener('click', event => {
    if (recording) return;
    const rect = progress.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const total = player.state !== 'stopped' ? player.totalDuration : new Timeline(selectedRanges(), repeats()).duration;
    if (reviewPlaying && review) void startPlayback(false, fraction * total, { buffer: review.voice, offset: review.offset });
    else void startPlayback(false, fraction * total);
  });

  // ---------------------------------------------------------------- up next + coach (every frame)
  const upNext = el(root, '#upNext');
  const coachTarget = el(root, '#coachTarget');
  const coachTargetOct = el(root, '#coachTargetOct');
  const coachYou = el(root, '#coachYou');
  const coachYouOct = el(root, '#coachYouOct');
  const coachHint = el(root, '#coachHint');
  let upNextKey = '';

  const lineText = (line: LyricLine) => line.words.map(word => word.text).join(' ');
  const lineNotes = (line: LyricLine) => {
    const midis = line.words.flatMap(word => word.syllables.map(syl => syl.midi)).filter((m): m is number => m !== null);
    if (!midis.length) return '';
    const lo = Math.min(...midis), hi = Math.max(...midis);
    return Math.round(lo) === Math.round(hi) ? midiToNote(lo) : midiToNote(lo) + '–' + midiToNote(hi);
  };

  /** The slim side panel: the current + next lines, with where to breathe between them. */
  const updateUpNext = (time: number) => {
    const lines = analysis.lines.filter(line => inSelection(line.start + 0.01) || inSelection(line.end - 0.01));
    let index = lines.findIndex(line => time < line.end + 0.15);
    if (index < 0) index = lines.length;
    const shown = lines.slice(index, index + 4);
    const key = shown.map(line => line.id).join('|') + (review ? ':r' : '');
    if (key !== upNextKey) {
      upNextKey = key;
      if (!shown.length) { upNext.innerHTML = '<li class="done">End of selection</li>'; return; }
      upNext.innerHTML = shown.map((line, i) => {
        const next = shown[i + 1];
        const gap = next ? next.start - line.end : 0;
        const breath = next && gap >= 0.3
          ? `<li class="breath">🌬 breathe${gap >= 1.2 ? ' · ' + gap.toFixed(1) + 's' : ' — quick'}</li>` : '';
        const scored = review?.score.lines.find(item => item.line.id === line.id);
        return `<li class="${i === 0 ? 'now' : ''}" data-up="${line.id}"><span>${escapeHtml(lineText(line))}</span>
          <small>${lineNotes(line)}${line.words[0]?.lang && line.words[0].lang !== 'en' ? ' · ' + line.words[0].lang.toUpperCase() : ''}${scored ? ' · ' + scored.percent + '%' : ''}</small></li>` + breath;
      }).join('');
      el(root, '#lyricsList').querySelectorAll('.lyricLine.current').forEach(node => node.classList.remove('current'));
      if (shown[0]) root.querySelector(`[data-line="${shown[0].id}"]`)?.classList.add('current');
    }
    const first = upNext.querySelector('li.now');
    if (first && shown[0]) first.classList.toggle('singing', time >= shown[0].start);
  };

  const updateCoach = (time: number | null, sung: number | null) => {
    const target = time === null ? null : lane.targetAt(time);
    const inBreath = time !== null && !target && lane.breathAt(time);
    if (target) {
      coachTarget.textContent = midiToNote(target.midi);
      coachTargetOct.textContent = 'octave ' + octaveOf(target.midi);
    } else if (time !== null) {
      const next = analysis.notes.find(note => note.start > time);
      coachTarget.textContent = next && next.start - time < 4 ? midiToNote(next.midi) : '—';
      coachTargetOct.textContent = next && next.start - time < 4 ? 'coming up' : '';
    } else { coachTarget.textContent = '—'; coachTargetOct.textContent = ''; }

    if (sung === null) {
      coachYou.textContent = mic.active ? '…' : '—';
      coachYouOct.textContent = '';
      coachYou.className = '';
      if (inBreath && player.state === 'playing') coachHint.textContent = '🌬 Breathe now';
      else if (!mic.active) coachHint.textContent = player.state === 'stopped' ? 'Press play, then turn on your mic to see your voice on the lane.' : 'Turn on the mic to see how close you are.';
      else coachHint.textContent = target ? 'Sing ' + midiToNote(target.midi) : 'Listening…';
      return;
    }
    coachYou.textContent = midiToNote(sung);
    coachYouOct.textContent = 'octave ' + octaveOf(sung);
    if (!target) { coachYou.className = ''; coachHint.textContent = inBreath ? '🌬 Breathe now' : 'You’re singing ' + midiToNote(sung) + '.'; return; }
    const error = lane.errorAt(sung, target);
    const cents = Math.round(error * 100);
    const off = Math.abs(cents);
    const relation = octaveRelation(sung, target.midi);
    coachYou.className = off <= 50 ? 'good' : off <= 120 ? 'close' : 'off';
    const pitchHint = off <= 25 ? '✓ Right on the note'
      : off <= 50 ? (cents < 0 ? 'Very close — a hair higher' : 'Very close — a hair lower')
      : off <= 250 ? (cents < 0 ? '↑ A bit low — go up ' + off + '¢' : '↓ A bit high — come down ' + off + '¢')
      : (cents < 0 ? '↑ Go up about ' + Math.round(off / 100) + ' notes' : '↓ Come down about ' + Math.round(off / 100) + ' notes');
    coachHint.textContent = relation === 'same octave' ? pitchHint
      : lane.forgiveOctave ? pitchHint + ' · ' + relation + ' (forgiven)'
      : (Math.abs(foldToOctave(sung, target.midi) - target.midi) <= 0.5 ? 'Right note, ' : pitchHint + ' · ') + relation;
  };

  const loop = () => {
    if (disposed) return;
    frame = requestAnimationFrame(loop);
    const playing = player.state === 'playing';
    const source = player.state !== 'stopped' ? player.sourceTimeAt(player.timelineTime()) : null;
    if (source !== null) idleTime = source;
    else if (player.state !== 'stopped' && player.timelineTime() < 0) idleTime = player.timeline.pieces[0]?.sourceStart ?? idleTime;
    const now = source ?? idleTime;

    let sung: number | null = null;
    if (mic.active) {
      const reading = mic.read();
      sung = reading.midi;
      lane.liveMidi = sung;
      if (playing && source !== null && !reviewPlaying) {
        if (source < lastSource - 0.3) liveTrail.length = 0;
        lastSource = source;
        if (sung !== null) liveTrail.push({ t: source, midi: sung });
        if (liveTrail.length > 2000) liveTrail.splice(0, liveTrail.length - 1500);
      }
    }
    if (!mic.active) lane.liveMidi = null;
    lane.draw(now);
    updateUpNext(now);
    updateCoach(player.state !== 'stopped' || mic.active ? now : null, sung);
    updateClock();
  };

  // Tap a note bar to hear its exact pitch — handy for checking a note (and its octave) by ear.
  const laneCanvas = el<HTMLCanvasElement>(root, '#lane');
  laneCanvas.addEventListener('click', event => {
    const rect = laneCanvas.getBoundingClientRect();
    const note = lane.noteAtPoint(event.clientX - rect.left, event.clientY - rect.top);
    if (!note) return;
    const midi = Math.round(note.midi);
    const ctx = player.ctx;
    void ctx.resume().then(() => {
      const at = ctx.currentTime + 0.02;
      const out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, at);
      out.gain.exponentialRampToValueAtTime(0.35, at + 0.03);
      out.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
      out.connect(ctx.destination);
      [1, 2, 3].forEach((harmonic, index) => {
        const osc = ctx.createOscillator();
        const level = ctx.createGain();
        osc.frequency.value = midiToFrequency(midi) * harmonic;
        level.gain.value = [1, 0.35, 0.15][index];
        osc.connect(level).connect(out);
        osc.start(at);
        osc.stop(at + 1.15);
      });
    });
    toast('♪ ' + midiToNote(midi) + ' · ' + midiToFrequency(midi).toFixed(0) + ' Hz · octave ' + octaveOf(midi));
  });
  laneCanvas.title = 'Tap a note bar to hear it';

  const onResize = () => lane.resize();
  window.addEventListener('resize', onResize);
  const onKey = (event: KeyboardEvent) => {
    if (event.code !== 'Space' || (event.target as HTMLElement).closest('input, textarea, select, button, dialog')) return;
    event.preventDefault();
    playButton.click();
  };
  window.addEventListener('keydown', onKey);

  renderSections();
  renderLyrics();
  renderTransport();
  renderMicButton();
  void renderTakes();
  idleTime = selectedRanges()[0].start;
  loop();

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKey);
    mic.stop();
    player.onEnded = null;
    player.close();
    void navigate;
  };
}

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'take';
}
