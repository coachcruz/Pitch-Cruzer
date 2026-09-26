import { applyTypedLyrics, breathMarks, buildLines, NOTES_VERSION, relabel, SECTION_NAMES, type LyricLine, type Section, type SectionKind, type Syllable } from '../lib/analysis';
import { decodeAudio, downloadBlob, encodeWav } from '../lib/audio';
import { getSong, listTakes, saveSong, saveTake, deleteTake, type StoredSong, type StoredTake } from '../lib/library';
import { LiveMic } from '../lib/mic';
import { foldToOctave, formatTime, keyName, midiToFrequency, midiToNote, octaveOf, octaveRelation, voiceTypeNames, voiceTypesFor } from '../lib/music';
import { Player, Timeline, type Range } from '../lib/player';
import { decodeStems, findLyricsOnline, LANGUAGE_CHOICES, lyricsOptionsFrom, pitchTrackFor, recheckNotes, transcribeLyrics, type SongBuffers } from '../lib/prepare';
import { coachingTip, mixdown, scoreTake, type TakeScore } from '../lib/score';
import { LiveVibrato, vibratoLabel } from '../lib/vibrato';
import { LYRICS_READY, session } from '../session';
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
  const hasBacking = Boolean(buffers.backing); void hasBacking;
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
          range ? 'Range ' + midiToNote(range[0]) + '–' + midiToNote(range[1]) + ' (' + voiceTypeNames(voiceTypesFor(range[0], range[1])) + ')' : null,
          formatTime(analysis.duration),
          analysis.separated ? null : 'Full mix (singer not separated)'
        ].filter(Boolean).map(value => escapeHtml(String(value))).join(' · ')}</p>
      </div>
      <div class="menuWrap">
        <button id="moreBtn" class="iconBtn" aria-label="More options" aria-haspopup="menu" aria-expanded="false">⋯</button>
        <div id="moreMenu" class="popMenu hidden" role="menu">
          <button id="saveSong" class="menuItem ${session.saved ? 'hidden' : ''}" role="menuitem">Save to my songs</button>
          <button id="openTakes" class="menuItem" role="menuitem">Saved takes &amp; scores</button>
          <button id="renameSong" class="menuItem" role="menuitem">Rename song</button>
          <button id="menuFixLyrics" class="menuItem" role="menuitem">Fix lyrics</button>
          <button id="menuRedoLyrics" class="menuItem" role="menuitem">Redo lyrics (language)</button>
          <label class="menuItem check small"><input id="showUpNext" type="checkbox"> Show “Up next” panel</label>
        </div>
      </div>
    </header>

    <section class="card focus">
      <div class="toolbar">
        <div class="transport">
          <button id="play" class="tbtn primary" title="Play / pause (Space)">▶ <span>Play</span></button>
          <button id="stop" class="tbtn" disabled>■ <span>Stop</span></button>
          <button id="record" class="tbtn record">● <span>Record</span></button>
          <button id="mic" class="tbtn" aria-pressed="false">🎤 <span>Mic</span></button>
          <button id="mixToggle" class="tbtn" aria-expanded="false">🎚 <span>Mix</span></button>
        </div>
        <div class="menuWrap">
          <button id="sectionsBtn" class="dropBtn" aria-haspopup="true" aria-expanded="false" title="Choose what to practice"><span id="selectionLabel">Whole song</span> ▾</button>
          <div id="sectionsMenu" class="popMenu wide hidden">
            <div class="menuQuick">
              <button data-quick="all">Whole song</button><button data-quick="verse">All verses</button><button data-quick="chorus">All choruses</button><button data-quick="none">Clear</button>
            </div>
            <div id="songMap" class="secList" role="group" aria-label="Sections — pick one or more"></div>
            <div class="menuFoot">
              <button id="editSections" class="linkBtn" aria-pressed="false">Rename sections</button>
              <button id="menuPickLines" class="linkBtn">Pick lines from the lyrics…</button>
            </div>
          </div>
        </div>
        <select id="repeats" class="miniSelect" title="Repeat" aria-label="Repeat"><option value="1">Once</option><option value="2">2×</option><option value="3">3×</option><option value="5">5×</option><option value="99">Loop</option></select>
        <select id="practiceStyle" class="miniSelect" title="Echo: the artist sings a line, then it's your turn to sing it back in the quiet" aria-label="Practice style"><option value="along">Sing along</option><option value="echo">Echo</option></select>
        <span id="echoModelWrap" class="hidden"><select id="echoModel" class="miniSelect" title="Who sings the line first in Echo" aria-label="Echo guide"><option value="artist">Artist first</option><option value="me">My best take first</option></select></span>
        <span id="clock" class="mono clock">0:00 / 0:00</span>
      </div>

      <div class="progress" id="progress" title="The whole song — tap to jump there">
        <div id="progressSections" class="progSecs"></div><span id="progressFill" class="playhead"></span>
      </div>

      <div id="mixPanel" class="mixPanel hidden">
        <div class="mixRow">
          <label for="mixLead">Singer</label>
          <input id="mixLead" type="range" min="0" max="100" step="1">
          <output id="mixLeadOut"></output>
          <div class="presets"><button class="chip" data-lead="0">Mute</button><button class="chip" data-lead="30">Guide</button><button class="chip" data-lead="100">Full</button></div>
        </div>
        <div class="mixRow hidden">
          <label for="mixBacking">Backing vocals</label>
          <input id="mixBacking" type="range" min="0" max="100" step="1" ${hasBacking ? '' : 'disabled'}>
          <output id="mixBackingOut"></output>
        </div>
        <div class="mixRow ${hasMusic ? '' : 'disabled'}">
          <label for="mixMusic">Music <small>(incl. backing vocals)</small></label>
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
          <label class="check"><input id="simpleView" type="checkbox"> Simple view <small>(just the notes, the words and your voice — less to read while singing)</small></label>
          <label class="check"><input id="showVoices" type="checkbox"> Show voice types <small>(bass, baritone, tenor… beside the octaves)</small></label>
        </div>
      </div>

      <div class="stageRow" id="stageRow">
        <div class="laneWrap"><canvas id="lane" aria-label="Lyrics scroll across the top; the singer’s notes sit on a treble and bass staff below; your voice is the blue line"></canvas>
          <div id="countdown" class="countdown hidden"></div>
          <div id="lineFlash" class="lineFlash" aria-live="polite"></div></div>
        <aside class="upNext hidden" id="upNextPanel" aria-label="Up next">
          <h3>Up next</h3>
          <ol id="upNext"></ol>
        </aside>
      </div>

      <div class="coach" id="coach" aria-live="off">
        <div><span class="label">Sing</span><strong id="coachTarget">—</strong><small id="coachTargetOct"></small></div>
        <div><span class="label">You</span><strong id="coachYou">—</strong><small id="coachYouOct"></small></div>
        <div class="coachHint" id="coachHint">Press ▶ Play, then 🎤 Mic to see your voice on the staff.</div>
      </div>
    </section>

    <details class="card fold" id="lyricsFold">
      <summary><h2>Full lyrics &amp; notes</h2><span class="hint small">study the whole song, pick lines, fix or redo lyrics</span></summary>
      <div class="row wrap tools">
        <button id="pickLines" class="chip ghost" aria-pressed="false">Pick lines to practice</button>
        <button id="fixLyrics" class="chip ghost">Fix lyrics</button>
        <button id="redoLyrics" class="chip ghost">Redo lyrics (language)</button>
        <label class="check small"><input id="showNotes" type="checkbox"> Show notes</label>
        <label class="check small"><input id="followLyrics" type="checkbox"> Scroll with the song</label>
      </div>
      <p id="lyricsHint" class="hint small">${analysis.transcript === 'failed' || analysis.transcript === 'none'
        ? 'Lyrics couldn’t be heard automatically — use “Redo lyrics” or “Fix lyrics”. Notes are still shown.'
        : 'Tap a line to play from there.'}</p>
      <div id="lyricsList" class="lyricsList"></div>
    </details>

    <dialog id="reviewDialog" class="dialog wide" aria-label="Your take">
      <section id="review" class="review hidden" aria-live="polite"></section>
      <div class="takesBlock">
        <h3>Takes &amp; scores</h3>
        <div id="takesList"><p class="empty">Save a take to start your leaderboard — pass the mic around!</p></div>
      </div>
      <div class="row end"><button id="reviewDialogClose" class="btn ghost">Close</button></div>
    </dialog>

    <dialog id="redoDialog" class="dialog">
      <form method="dialog">
        <h2>Redo the lyrics</h2>
        <p class="hint">Listens to the singer again, phrase by phrase. For bilingual songs pick both languages — each line gets its own language.</p>
        <label class="inline">Language <select id="redoLang">${LANGUAGE_CHOICES.map(choice => `<option value="${choice.value}">${choice.label}</option>`).join('')}</select></label>
        <label class="inline">Accuracy <select id="redoQuality"><option value="fast">Faster (≈80 MB, recommended)</option><option value="best">Best (≈250 MB, several times slower)</option></select></label>
        <p id="redoStatus" class="hint small"></p>
        <div class="row end"><button class="btn ghost" value="cancel" id="redoCancel">Cancel</button><button id="redoStart" class="btn primary" type="button">Redo lyrics</button></div>
      </form>
    </dialog>

    <dialog id="lyricsDialog" class="dialog">
      <form method="dialog">
        <h2>Fix the lyrics</h2>
        <p class="hint">Paste or type the correct lyrics — one line per sung line. Timing is matched to the singer automatically.</p>
        <div class="row wrap"><input id="lyricsSearch" class="textInput" placeholder="Song name and artist"><button id="lyricsSearchBtn" class="btn small" type="button">Find online</button></div>
        <textarea id="lyricsText" rows="14"></textarea>
        <div class="row end"><button class="btn ghost" value="cancel">Cancel</button><button id="applyLyrics" class="btn primary" value="apply">Apply</button></div>
      </form>
    </dialog>
  </div>`;

  // ---------------------------------------------------------------- state
  const player = new Player(buffers);
  const mic = new LiveMic(player.ctx);
  // Conveyor text: whole words written straight (each carries the note it starts on).
  const allSyllables = (): Syllable[] => analysis.lines.flatMap(line => line.words.map(word => ({
    text: word.text, start: word.start, end: word.end,
    midi: word.syllables.find(syllable => syllable.midi !== null)?.midi ?? null, notes: []
  })));
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
  const liveVib = new LiveVibrato();
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

  // Echo practice: each line is played by the artist, then repeated silently for the singer to sing back.
  const styleEl = el<HTMLSelectElement>(root, '#practiceStyle');
  styleEl.value = prefs.get('practiceStyle', 'along');
  const echoMode = () => styleEl.value === 'echo';
  const playbackRanges = (): Range[] => {
    const ranges = selectedRanges();
    if (!echoMode()) return ranges;
    const lines = analysis.lines.filter(line => ranges.some(range => line.start >= range.start - 0.05 && line.start < range.end));
    if (!lines.length) return ranges;
    return lines.flatMap(line => {
      const piece = { start: Math.max(0, line.start - 0.4), end: Math.min(analysis.duration, line.end + 0.3) };
      return [piece, { ...piece, turn: true }];
    });
  };

  const renderSections = () => {
    const map = el(root, '#songMap');
    const isOn = (section: Section) => selected.has(section.id) || Boolean(custom && custom.start < section.end && custom.end > section.start);
    map.innerHTML = analysis.sections.map(section => {
      const on = isOn(section);
      const editor = editingSections
        ? `<select data-kind="${section.id}" aria-label="Section type">${KIND_ORDER.map(kind => `<option value="${kind}" ${kind === section.kind ? 'selected' : ''}>${SECTION_NAMES[kind]}</option>`).join('')}</select>`
        : '';
      return `<div class="secRow kind-${section.kind} ${on ? 'on' : ''}">
        <button data-section="${section.id}" aria-pressed="${on ? 'true' : 'false'}"><span class="tick">${on ? '✓' : ''}</span><span class="dot"></span><strong>${escapeHtml(section.label)}</strong><small>${formatTime(section.start)}–${formatTime(section.end)}</small></button>${editor}</div>`;
    }).join('');
    // The whole song as a thin strip: every section in its color, the chosen ones bright.
    el(root, '#progressSections').innerHTML = analysis.sections.map(section =>
      `<span class="kind-${section.kind} ${isOn(section) || (!selected.size && !custom) ? 'on' : ''}" style="flex-grow:${(section.end - section.start).toFixed(2)}" title="${escapeHtml(section.label)}"></span>`).join('');
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

    const chosen = analysis.sections.filter(section => selected.has(section.id));
    const names = custom ? custom.label
      : chosen.length > 2 ? chosen[0].label + ' + ' + (chosen.length - 1) + ' more'
      : chosen.length ? chosen.map(section => section.label).join(' + ')
      : 'Whole song';
    el(root, '#selectionLabel').textContent = names;
  };

  // ---------------------------------------------------------------- pop-up menus (⋯ and Sections ▾)
  const menus: Array<[HTMLButtonElement, HTMLElement]> = [
    [el<HTMLButtonElement>(root, '#moreBtn'), el(root, '#moreMenu')],
    [el<HTMLButtonElement>(root, '#sectionsBtn'), el(root, '#sectionsMenu')]
  ];
  const closeMenus = (except?: HTMLElement) => menus.forEach(([button, menu]) => {
    if (menu === except) return;
    menu.classList.add('hidden');
    button.setAttribute('aria-expanded', 'false');
  });
  menus.forEach(([button, menu]) => button.addEventListener('click', event => {
    event.stopPropagation();
    const open = menu.classList.contains('hidden');
    closeMenus(menu);
    menu.classList.toggle('hidden', !open);
    button.setAttribute('aria-expanded', String(open));
  }));
  const onDocClick = (event: MouseEvent) => {
    if (!(event.target as HTMLElement).closest('.menuWrap')) closeMenus();
  };
  const onEsc = (event: KeyboardEvent) => { if (event.key === 'Escape') closeMenus(); };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onEsc);
  const openLyricsFold = () => { (el(root, '#lyricsFold') as HTMLDetailsElement).open = true; el(root, '#lyricsFold').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  el(root, '#menuFixLyrics').addEventListener('click', () => { closeMenus(); el<HTMLButtonElement>(root, '#fixLyrics').click(); });
  el(root, '#menuRedoLyrics').addEventListener('click', () => { closeMenus(); el<HTMLButtonElement>(root, '#redoLyrics').click(); });
  el(root, '#menuPickLines').addEventListener('click', () => { closeMenus(); openLyricsFold(); if (!pickingLines) el<HTMLButtonElement>(root, '#pickLines').click(); });
  const showUpNext = el<HTMLInputElement>(root, '#showUpNext');
  showUpNext.checked = prefs.get('showUpNext', false);
  const applyUpNext = () => {
    el(root, '#upNextPanel').classList.toggle('hidden', !showUpNext.checked);
    el(root, '#stageRow').classList.toggle('withUpNext', showUpNext.checked);
    requestAnimationFrame(() => lane.resize());
  };
  showUpNext.addEventListener('change', () => { prefs.set('showUpNext', showUpNext.checked); applyUpNext(); });
  applyUpNext();

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
  const echoModelEl = el<HTMLSelectElement>(root, '#echoModel');
  echoModelEl.value = prefs.get('echoModel', 'artist');
  const syncEchoModel = () => el(root, '#echoModelWrap').classList.toggle('hidden', !echoMode());
  syncEchoModel();
  echoModelEl.addEventListener('change', () => {
    prefs.set('echoModel', echoModelEl.value);
    if (player.state !== 'stopped' && !recording) stopAll();
    if (echoModelEl.value === 'me') toast('Echo will use your best saved take for each line it covers (the artist fills in the rest).');
  });
  styleEl.addEventListener('change', () => {
    syncEchoModel();
    prefs.set('practiceStyle', styleEl.value);
    if (styleEl.value === 'echo') toast('Echo practice: listen to each line, then sing it back in the quiet. Only your turns are scored.');
    selectionChanged();
  });
  repeatsEl.value = String(prefs.get('repeats', 1));
  repeatsEl.addEventListener('change', () => { prefs.set('repeats', repeats()); renderSections(); });

  // Start on the first chorus (or first sung section) — the part most people want to try first.
  const firstPick = analysis.sections.find(s => s.kind === 'chorus') ?? analysis.sections.find(s => !['intro', 'outro', 'instrumental'].includes(s.kind));
  if (firstPick) selected.add(firstPick.id);

  // ---------------------------------------------------------------- lyrics sheet
  const sectionFor = (time: number): Section | undefined => analysis.sections.find(s => time >= s.start && time < s.end);

  let crawlLine: HTMLElement | null = null;
  const renderLyrics = () => {
    const list = el(root, '#lyricsList');
    crawlLine = null;
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
        <span class="lineTime">${formatTime(line.start)}</span><span class="lineText">${syllablesHtml(line, true)}</span>
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
      const from = new Timeline(playbackRanges(), repeats()).timelineFor(Math.max(0, line.start - 0.6)) ?? 0;
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

  // Lyrics crawl: while the song plays, the full lyrics roll upward at an even speed (like a movie
  // opening crawl) and each word lights up as it's sung. Scrolling by hand pauses it for a few seconds.
  const followLyrics = el<HTMLInputElement>(root, '#followLyrics');
  followLyrics.checked = prefs.get('followLyrics', true);
  const lyricsList = el(root, '#lyricsList');
  const applyFollow = () => lyricsList.classList.toggle('crawl', followLyrics.checked);
  followLyrics.addEventListener('change', () => { prefs.set('followLyrics', followLyrics.checked); applyFollow(); });
  applyFollow();
  let handScrollUntil = 0;
  const pauseCrawl = () => { handScrollUntil = performance.now() + 4000; };
  ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(type => lyricsList.addEventListener(type, pauseCrawl, { passive: true }));
  const updateCrawl = (time: number, playing: boolean) => {
    if (!followLyrics.checked || !(el(root, '#lyricsFold') as HTMLDetailsElement).open) return;
    const rows = [...lyricsList.querySelectorAll<HTMLElement>('.lyricLine')];
    if (!rows.length) return;
    const lines = analysis.lines;
    let index = lines.findIndex(line => time < line.end);
    if (index < 0) index = lines.length - 1;
    const row = rows[index];
    if (row !== crawlLine) {
      rows.forEach((node, i) => node.classList.toggle('past', i < index));
      crawlLine?.querySelectorAll('.syl').forEach(node => node.classList.remove('now'));
      crawlLine = row;
    }
    // Light up the words of the current line as they're sung.
    row.querySelectorAll<HTMLElement>('.syl').forEach(node => {
      const start = Number(node.dataset.s), end = Number(node.dataset.e);
      node.classList.toggle('sung', time >= start);
      node.classList.toggle('now', time >= start && time < end + 0.05);
    });
    if (!playing || performance.now() < handScrollUntil) return;
    // Glide at an even speed from this line to the next, so nothing jumps.
    const line = lines[index], next = lines[index + 1], nextRow = rows[index + 1];
    const from = line.start, to = next ? next.start : line.end;
    const progress = Math.max(0, Math.min(1, (time - from) / Math.max(0.1, to - from)));
    const y = row.offsetTop + (nextRow ? (nextRow.offsetTop - row.offsetTop) * progress : 0);
    lyricsList.scrollTop = y - lyricsList.clientHeight * 0.38;
  };
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
    redoQuality.value = current?.quality ?? prefs.get('lyricsQuality2', 'fast');
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
    prefs.set('lyricsQuality2', redoQuality.value);
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

  el(root, '#lyricsSearchBtn').addEventListener('click', async () => {
    const query = el<HTMLInputElement>(root, '#lyricsSearch').value.trim() || song.title;
    const found = await findLyricsOnline(query, analysis.duration);
    if (!found) { toast('No lyrics found online for “' + query + '”. Paste them instead.', 'error'); return; }
    el<HTMLTextAreaElement>(root, '#lyricsText').value = found.text;
    toast('Found: ' + found.label + ' — check them, then Apply.');
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
  // Two simple sliders: Singer and Music. Backing vocals travel with the music.
  const setBacking = bindSlider('mixBacking', 'backing', value => player.setLevel('backing', value));
  bindSlider('mixMusic', 'music', value => { player.setLevel('music', value); setBacking(Math.round(value * 100)); });
  bindSlider('mixMonitor', 'monitor', value => mic.setMonitor(value));
  root.querySelectorAll<HTMLButtonElement>('[data-lead]').forEach(button => button.addEventListener('click', () => setLead(Number(button.dataset.lead))));
  forgiveOctave.addEventListener('change', () => {
    prefs.set('forgiveOctave', forgiveOctave.checked);
    lane.forgiveOctave = forgiveOctave.checked;
    rescore();
  });
  const simpleView = el<HTMLInputElement>(root, '#simpleView');
  simpleView.checked = prefs.get('simpleView', false);
  lane.simple = simpleView.checked;
  simpleView.addEventListener('change', () => { prefs.set('simpleView', simpleView.checked); lane.simple = simpleView.checked; });
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
    micButton.innerHTML = mic.active ? '🎤 <span>Mic on</span>' : '🎤 <span>Mic</span>';
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
    playButton.innerHTML = player.state === 'playing' ? '❚❚ <span>Pause</span>' : player.state === 'paused' ? '▶ <span>Resume</span>' : '▶ <span>Play</span>';
    playButton.disabled = recording;
    stopButton.disabled = !active;
    recordButton.disabled = active && !recording;
    recordButton.innerHTML = recording ? '■ <span>Stop &amp; review</span>' : '● <span>Record</span>';
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

  // Your best saved take, decoded once, used as the Echo guide ("My best take sings first").
  let modelCache: { id: string; buffer: AudioBuffer; locate: (sourceTime: number) => number | null } | null = null;
  const echoModelVoice = async () => {
    if (!echoMode() || echoModelEl.value !== 'me') return undefined;
    const takes = session.saved ? await listTakes(song.id).catch(() => [] as StoredTake[]) : [];
    const singer = prefs.get('singer', '');
    const take = takes.find(item => item.singer === singer) ?? takes[0];
    if (!take) { toast('Save a take first — then Echo can use your own voice as the guide. Using the artist for now.'); return undefined; }
    if (modelCache?.id !== take.id) {
      const buffer = await decodeAudio(await take.voice.arrayBuffer());
      const timeline = new Timeline(take.segments, 1);
      const pieces = timeline.hasTurns ? timeline.pieces.filter(piece => piece.turn) : timeline.pieces;
      modelCache = {
        id: take.id,
        buffer,
        locate: sourceTime => {
          const piece = pieces.find(item => sourceTime >= item.sourceStart - 0.05 && sourceTime < item.sourceStart + item.duration);
          return piece ? piece.timelineStart + Math.max(0, sourceTime - piece.sourceStart) - take.offsetSeconds : null;
        }
      };
    }
    return modelCache;
  };

  const startPlayback = async (withRecording: boolean, from = 0, voice?: { buffer: AudioBuffer; offset: number }) => {
    reviewPlaying = Boolean(voice);
    if (!voice) lane.trail = liveTrail;
    liveTrail.length = 0;
    lastSource = -1;
    const useCountIn = withRecording && countIn.checked;
    const leadIn = useCountIn ? 1.9 : 0.12;
    const ranges = voice && review ? review.ranges : playbackRanges();
    const reps = voice && review ? review.repeats : repeats();
    const model = voice ? undefined : await echoModelVoice();
    player.setLevel('voice', voice || model ? levels.voice / 100 : 0);
    if (withRecording) mic.startRecording();
    const origin = await player.play(ranges, reps, { from, leadIn, voice, model });
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
    reviewDialog.close();
    await startPlayback(true);
    toast(speakers.checked ? 'Recording — sing along!' : 'Recording — sing along! (Headphones give the cleanest take.)');
  });

  const finishRecording = async () => {
    recording = false;
    renderTransport();
    const result = mic.stopRecording();
    if (!result || result.samples.length < result.sampleRate * 0.5) { toast('No audio was recorded from the mic.', 'error'); return; }
    // The review opens the moment you finish — score, save or discard, listen back, leaderboard.
    const reviewEl = el(root, '#review');
    reviewEl.classList.remove('hidden');
    reviewEl.innerHTML = '<p>Scoring your take…</p>';
    openReviewDialog();
    // What you sang at clock time T answers music you heard at T − output latency − input latency.
    const latency = (player.ctx.outputLatency || 0) + (player.ctx.baseLatency || 0) + 0.02;
    const offset = result.startTime - recordingOrigin - latency;
    const voice = player.ctx.createBuffer(1, result.samples.length, result.sampleRate);
    voice.copyToChannel(result.samples, 0);
    const ranges = playbackRanges();
    const reps = repeats();
    await buildReview(voice, offset, ranges, reps, labelForSelection());
  };

  const labelForSelection = () => custom ? custom.label
    : selected.size ? analysis.sections.filter(s => selected.has(s.id)).map(s => s.label).join(' + ') : 'Whole song';

  // ---------------------------------------------------------------- review (a window that opens when you finish)
  const reviewDialog = el<HTMLDialogElement>(root, '#reviewDialog');
  const openReviewDialog = () => {
    closeMenus();
    if (!reviewDialog.open) reviewDialog.showModal();
    void renderTakes();
  };
  reviewDialog.addEventListener('close', () => { if (reviewPlaying) stopAll(); });
  el(root, '#reviewDialogClose').addEventListener('click', () => reviewDialog.close());
  el(root, '#openTakes').addEventListener('click', () => {
    if (!review) el(root, '#review').classList.add('hidden');
    openReviewDialog();
  });
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
          <div title="How evenly you hold each note (separate from hitting it)"><span>Steadiness</span><b>${s.steadiness === null ? '—' : s.steadiness + '%'}</b></div>
        </div>
      </div>
      <p id="progressNote" class="progressNote hidden"></p>
      ${s.vibrato.verdict ? `<p class="vibratoNote">〰 ${escapeHtml(s.vibrato.verdict)}</p>` : ''}
      ${bestLineHtml(s)}
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
    void renderProgress();
    reviewEl.querySelector('#playBest')?.addEventListener('click', async () => {
      if (!review) return;
      const best = bestLine(review.score);
      if (!best) return;
      const timeline = review.timeline;
      const piece = timeline.pieces.find(item => (!timeline.hasTurns || item.turn) && best.line.start >= item.sourceStart - 0.5 && best.line.start < item.sourceStart + item.duration);
      if (!piece) return;
      const from = piece.timelineStart + Math.max(0, best.line.start - 0.3 - piece.sourceStart);
      lane.trail = review.score.trail;
      await startPlayback(false, from, { buffer: review.voice, offset: review.offset });
      lane.trail = review.score.trail;
      renderReviewButtons();
      const stopAt = (best.line.end - best.line.start + 1.2) * 1000;
      window.setTimeout(() => { if (reviewPlaying) stopAll(); }, stopAt);
    });
    el(reviewEl, '#reviewClose').addEventListener('click', () => {
      if (!review?.savedId && !confirm('Discard this take without saving it?')) return;
      if (reviewPlaying) stopAll();
      review = null;
      reviewEl.classList.add('hidden');
      lane.trail = liveTrail;
      renderLyrics();
      reviewDialog.close();
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

  /** Compare this take with your earlier ones on the same part — seeing progress builds confidence. */
  const renderProgress = async () => {
    if (!review || !session.saved) return;
    const current = review;
    const singer = current.singer ?? prefs.get('singer', '');
    const earlier = (await listTakes(song.id).catch(() => [] as StoredTake[]))
      .filter(take => take.id !== current.savedId && take.label === current.label && (!singer || take.singer === singer))
      .sort((a, b) => b.createdAt - a.createdAt);
    const note = root.querySelector<HTMLElement>('#progressNote');
    if (!note || review !== current) return;
    const score = current.score.score;
    if (!earlier.length) { note.textContent = '🌱 Your first saved take on this part — save it to track your progress.'; }
    else {
      const last = earlier[0].score;
      const best = Math.max(...earlier.map(take => take.score));
      note.textContent = score > last ? '📈 Up ' + (score - last) + ' points from your last take (' + last + ')' + (score > best ? ' — a new personal best!' : '.')
        : score === last ? '➡️ Same as your last take — nice and consistent.'
        : '💪 Your best here is ' + best + '. You’ve done it before — you can do it again.';
    }
    note.classList.remove('hidden');
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
      el(root, '#reviewDialog').scrollTop = 0;
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
    const total = player.state !== 'stopped' ? player.totalDuration : new Timeline(playbackRanges(), repeats() === 99 ? 1 : repeats()).duration;
    const t = Math.max(0, Math.min(total, player.timelineTime()));
    clock.textContent = formatTime(t) + ' / ' + formatTime(total);
    progressFill.style.left = ((100 * idleTime) / analysis.duration).toFixed(2) + '%';
  };
  // The strip is the whole song: tap inside what you're practicing to jump there, or tap another
  // section to switch to it.
  progress.addEventListener('click', event => {
    if (recording) return;
    const rect = progress.getBoundingClientRect();
    const time = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * analysis.duration;
    if (reviewPlaying && review) {
      const from = review.timeline.timelineFor(time);
      if (from !== null) void startPlayback(false, from, { buffer: review.voice, offset: review.offset });
      return;
    }
    if (!inSelection(time)) {
      const section = sectionFor(time);
      custom = null;
      selected = new Set(section ? [section.id] : []);
      selectionChanged();
    }
    void startPlayback(false, new Timeline(playbackRanges(), repeats()).timelineFor(time) ?? 0);
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
      coachTargetOct.textContent = middleC(target.midi);
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
    const vibText = vibratoLabel(liveVib.reading());
    coachYouOct.textContent = middleC(sung) + (vibText ? ' · ' + vibText.replace('〰 vibrato ', '〰 ') : '');
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
      liveVib.push(performance.now() / 1000, reading.midi);
      // Coach + encouragement judge the center of any vibrato; the lane still draws the real wave.
      sung = reading.midi === null ? null : liveVib.center();
      lane.liveMidi = reading.midi;
      if (playing && source !== null && !reviewPlaying) {
        if (source < lastSource - 0.3) liveTrail.length = 0;
        lastSource = source;
        if (reading.midi !== null) liveTrail.push({ t: source, midi: reading.midi });
        if (liveTrail.length > 2000) liveTrail.splice(0, liveTrail.length - 1500);
      }
    }
    if (!mic.active) lane.liveMidi = null;
    lane.draw(now);
    updateUpNext(now);
    updateCrawl(now, playing);
    updateCoach(player.state !== 'stopped' || mic.active ? now : null, sung);
    if (player.state !== 'stopped' && player.timeline.hasTurns && !reviewPlaying) {
      const piece = player.timeline.pieceAt(player.timelineTime());
      if (piece?.turn) coachHint.textContent = '🎤 Your turn — sing it back!' + (sung !== null ? ' · ' + coachHint.textContent : '');
      else if (piece) coachHint.textContent = '👂 Listen to the line…';
    }
    trackLine(playing && !reviewPlaying ? source : null, sung);
    updateClock();
  };

  // Encouragement after each line you sing (never negative): research links confidence to both
  // lower performance anxiety and better singing.
  const lineFlash = el(root, '#lineFlash');
  let lineStats: { id: string; frames: number; voiced: number; hits: number } | null = null;
  let flashTimer: number | null = null;
  const flash = (text: string, detail: string) => {
    lineFlash.innerHTML = `<strong>${text}</strong><span>${detail}</span>`;
    lineFlash.classList.remove('show');
    void lineFlash.offsetWidth;
    lineFlash.classList.add('show');
    if (flashTimer !== null) window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => lineFlash.classList.remove('show'), 1600);
  };
  const finishLine = () => {
    if (!lineStats) return;
    const { frames, voiced, hits } = lineStats;
    lineStats = null;
    if (frames < 12 || voiced / frames < 0.3) return;
    const pct = Math.round((100 * hits) / frames);
    const [text] = pct >= 80 ? ['🌟 Perfect!'] : pct >= 60 ? ['Great!'] : pct >= 40 ? ['Nice!'] : ['💪 Keep going'];
    flash(text, pct >= 40 ? pct + '% on the note' : 'you’re getting it');
  };
  const trackLine = (source: number | null, sung: number | null) => {
    if (source === null || !mic.active) { if (player.state === 'stopped') finishLine(); return; }
    if (player.timeline.hasTurns && !player.timeline.pieceAt(player.timelineTime())?.turn) { finishLine(); return; }
    const line = analysis.lines.find(item => source >= item.start - 0.2 && source <= item.end + 0.2);
    if (!line) { finishLine(); return; }
    if (lineStats && lineStats.id !== line.id) finishLine();
    lineStats ??= { id: line.id, frames: 0, voiced: 0, hits: 0 };
    const target = lane.targetAt(source);
    if (!target) return;
    lineStats.frames += 1;
    if (sung === null) return;
    lineStats.voiced += 1;
    if (Math.abs(lane.errorAt(sung, target)) <= 0.5) lineStats.hits += 1;
  };

  // Tap a note bar to hear its exact pitch — handy for checking a note (and its octave) by ear.
  const laneCanvas = el<HTMLCanvasElement>(root, '#lane');
  laneCanvas.addEventListener('click', event => {
    const rect = laneCanvas.getBoundingClientRect();
    const note = lane.noteAtPoint(event.clientX - rect.left, event.clientY - rect.top);
    if (!note) return;
    const midi = Math.round(note.midi);
    const ctx = player.ctx;
    // People match a human voice far better than a synthetic tone, so play the singer's own note
    // (from the separated vocal). Shift+tap, or a song without separation, plays a pure tone.
    const useVoice = analysis.separated && !(event as MouseEvent).shiftKey;
    void ctx.resume().then(() => {
      const at = ctx.currentTime + 0.02;
      const out = ctx.createGain();
      out.connect(ctx.destination);
      if (useVoice) {
        const length = Math.min(2.5, note.end - note.start + 0.12);
        out.gain.setValueAtTime(0.0001, at);
        out.gain.exponentialRampToValueAtTime(1, at + 0.03);
        out.gain.setValueAtTime(1, at + Math.max(0.03, length - 0.08));
        out.gain.exponentialRampToValueAtTime(0.0001, at + length);
        const sourceNode = ctx.createBufferSource();
        sourceNode.buffer = buffers.lead;
        sourceNode.connect(out);
        sourceNode.start(at, Math.max(0, note.start - 0.03), length);
        return;
      }
      out.gain.setValueAtTime(0.0001, at);
      out.gain.exponentialRampToValueAtTime(0.35, at + 0.03);
      out.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
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
    toast('♪ ' + midiToNote(midi) + ' · ' + midiToFrequency(midi).toFixed(0) + ' Hz · octave ' + octaveOf(midi) + (useVoice ? ' — the singer’s own note' : ''));
  });
  laneCanvas.title = 'Tap a note bar to hear the singer sing it (Shift+tap for a pure tone)';

  // Lyrics still being written in the background? Keep practicing; they drop in when ready.
  const onLyricsReady = (event: Event) => {
    if ((event as CustomEvent<string>).detail !== song.id) return;
    lane.setLyrics(allSyllables());
    selected = new Set();
    const pick = analysis.sections.find(s => s.kind === 'chorus') ?? analysis.sections.find(s => !['intro', 'outro', 'instrumental'].includes(s.kind));
    if (pick && player.state === 'stopped') selected.add(pick.id);
    upNextKey = '';
    renderSections();
    renderLyrics();
    el(root, '#lyricsHint').textContent = analysis.transcript === 'failed' || analysis.transcript === 'none'
      ? 'Lyrics couldn’t be heard automatically — use ⋯ → Fix lyrics to paste or find them.' : 'Tap a line to play from there.';
    toast(analysis.transcript === 'failed' || analysis.transcript === 'none' ? 'Couldn’t write the lyrics — use ⋯ → Fix lyrics.' : '✍️ Lyrics are ready.');
  };
  window.addEventListener(LYRICS_READY, onLyricsReady);
  if (session.lyricsJobs.has(song.id)) {
    el(root, '#lyricsHint').textContent = '✍️ Writing the lyrics in the background — start practicing, they’ll appear when ready.';
    toast('✍️ The notes are ready — lyrics are still being written. You can start practicing now.');
  }

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
    window.removeEventListener(LYRICS_READY, onLyricsReady);
    mic.stop();
    player.onEnded = null;
    player.close();
    void navigate;
  };
}

/** The line you sang best (self-modelling: replaying yourself at your best builds confidence). */
function bestLine(score: TakeScore) {
  const candidates = score.lines.filter(item => item.frames >= 10 && item.line.words.some(word => word.text !== '♪'));
  return candidates.sort((a, b) => b.percent - a.percent)[0] ?? null;
}

function bestLineHtml(score: TakeScore): string {
  const best = bestLine(score);
  if (!best || best.percent < 35) return '';
  const text = best.line.words.map(word => word.text).join(' ');
  return `<p class="bestLine">⭐ Your best line: <b>“${escapeHtml(text)}”</b> — ${best.percent}% <button id="playBest" class="chip">▶ Hear yourself</button></p>`;
}

/** Plain-words position of a note: relative to middle C (C4), plus which staff it sits on. */
function middleC(midi: number): string {
  const rounded = Math.round(midi);
  if (rounded === 60) return 'middle C';
  const octaves = Math.abs(rounded - 60) / 12;
  const where = rounded > 60 ? 'above' : 'below';
  return (octaves >= 1 ? Math.floor(octaves) + ' oct ' : '') + where + ' middle C · ' + (rounded >= 60 ? 'treble' : 'bass');
}

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'take';
}
