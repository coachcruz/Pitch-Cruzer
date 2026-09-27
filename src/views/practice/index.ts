import { alignSyncedLyrics, applyTypedLyrics, breathMarks, buildLines, buildSections, NOTES_VERSION, relabel, SECTION_NAMES, type LyricLine, type SectionKind } from '../../lib/analysis';
import { decodeAudio, downloadBlob } from '../../lib/audio';
import { diagEntries, onDiag } from '../../lib/diag';
import { countInCues, estimateBeat } from '../../lib/beat';
import { duetParts, partnerRanges, type Part } from '../../lib/duet';
import { exportSong, getSong, listTakes, saveSong, type StoredSong, type StoredTake } from '../../lib/library';
import { LiveMic } from '../../lib/mic';
import { formatTime, midiToFrequency, midiToNote, octaveOf } from '../../lib/music';
import { Player, Timeline, type Range } from '../../lib/player';
import { decodeStems, findLyricsOnline, LANGUAGE_CHOICES, lyricsOptionsFrom, recheckNotes, transcribeLyrics, type SongBuffers } from '../../lib/prepare';
import { serverTranscriptionAvailable } from '../../lib/serverTranscribe';
import { LiveVibrato } from '../../lib/vibrato';
import { LYRICS_READY, session } from '../../session';
import { el, escapeHtml, prefs, toast } from '../../ui/dom';
import { PitchLane, type LaneWord, type TrailPoint } from '../../ui/lane';
import { floatingControls } from './controls';
import { Karaoke } from './karaoke';
import { practiceMarkup } from './markup';
import { TakeReview, type Review } from './review';
import { lineText, safeName } from './text';

const KIND_ORDER: SectionKind[] = ['intro', 'verse', 'pre', 'chorus', 'bridge', 'instrumental', 'outro'];

/** Loads a song (from this visit or the device), brings old saves up to date, then shows it. */
export function renderPractice(root: HTMLElement, songId: string): () => void {
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
    }
    // Songs saved by older versions could have generic "Part 1, Part 2…" sections: give them real names.
    const analysis = song.analysis;
    if (analysis.lines.length && analysis.sections.some(section => section.kind === 'part')) {
      analysis.sections = buildSections(analysis.lines, analysis.notes, analysis.duration, analysis.lines.some(line => line.words.some(word => word.text !== '♪')));
      if (session.saved) await saveSong(song).catch(() => undefined);
    }
    if (disposed) return;
    cleanup = mount(root, song, buffers);
  })().catch(error => {
    console.error(error);
    root.innerHTML = '<div class="card"><p>Could not open this song.</p><a class="btn" href="#/">Back to songs</a></div>';
  });

  return () => { disposed = true; cleanup?.(); };
}

function mount(root: HTMLElement, song: StoredSong, buffers: SongBuffers): () => void {
  const analysis = song.analysis;
  root.innerHTML = practiceMarkup(song, Boolean(buffers.instrumental));
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => el<T>(root, selector);

  // ================================================================ state
  const player = new Player(buffers);
  const mic = new LiveMic(player.ctx);
  const liveVib = new LiveVibrato();
  // The staff's lyrics belt: whole words, each with the note it starts on ("♪" placeholders left off).
  const laneWords = (): LaneWord[] => analysis.lines.flatMap(line => line.words)
    .filter(word => word.text !== '♪' && !word.aside)
    .map(word => ({ text: word.text, start: word.start, end: word.end, midi: word.syllables.find(syllable => syllable.midi !== null)?.midi ?? null }));
  const lane = new PitchLane($<HTMLCanvasElement>('#lane'), analysis.notes, laneWords(), analysis.range, breathMarks(analysis.notes));
  // The song's beat (found once from the music, then saved) drives the silent count-in dots.
  const beatIsNew = analysis.beat === undefined;
  if (beatIsNew) analysis.beat = estimateBeat(buffers.instrumental ?? buffers.lead);
  let cues = analysis.beat ? countInCues(analysis.lines, analysis.beat) : [];
  lane.cues = cues;

  let selected = new Set<string>();            // chosen sections (empty = whole song)
  let custom: { start: number; end: number; label: string } | null = null;   // picked lines
  let pickingLines = false;
  let pickAnchor: LyricLine | null = null;
  let liveTrail: TrailPoint[] = [];
  let lastSource = -1;
  let idleTime = 0;
  let recording = false;
  let recordingOrigin = 0;
  let reviewPlaying = false;
  let frame = 0;
  let disposed = false;
  let parts: Map<string, Part> | null = duetParts(analysis);

  const levels = { lead: prefs.get('mix.lead', 100), music: prefs.get('mix.music', 100), monitor: prefs.get('mix.monitor', 0), voice: 100 };
  const forgiveOctave = $<HTMLInputElement>('#forgiveOctave');
  const speakers = $<HTMLInputElement>('#speakers');
  const countIn = $<HTMLInputElement>('#countIn');
  forgiveOctave.checked = prefs.get('forgiveOctave', false);
  speakers.checked = prefs.get('speakers', false);
  countIn.checked = prefs.get('countIn', true);
  lane.forgiveOctave = forgiveOctave.checked;

  const persist = async () => {
    if (!session.saved) return;
    try { await saveSong(song); } catch { toast('Could not save changes on this device.', 'error'); }
  };
  if (beatIsNew) void persist();

  // ================================================================ what is being practiced
  const repeatsEl = $<HTMLSelectElement>('#repeats');
  repeatsEl.value = String(prefs.get('repeats', 1));
  const repeats = () => Number(repeatsEl.value) || 1;
  const styleEl = $<HTMLSelectElement>('#practiceStyle');
  styleEl.value = prefs.get('practiceStyle', 'along');
  const echoMode = () => styleEl.value === 'echo';
  const echoModelEl = $<HTMLSelectElement>('#echoModel');
  echoModelEl.value = prefs.get('echoModel', 'artist');

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
  const inSelection = (time: number) => selectedRanges().some(range => time >= range.start && time < range.end);
  /** Echo practice: each line is played by the artist, then repeated silently for the singer to sing back. */
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
  const labelForSelection = () => custom ? custom.label
    : selected.size ? analysis.sections.filter(section => selected.has(section.id)).map(section => section.label).join(' + ') : 'Whole song';

  const selectionChanged = () => {
    if (player.state !== 'stopped' && !recording) stopAll();
    idleTime = selectedRanges()[0].start;
    liveTrail = [];
    renderSections();
    renderLyrics();
    updateClock();
  };
  const wholeSong = () => { custom = null; selected.clear(); selectionChanged(); };

  // ================================================================ timeline + parts
  // One thin timeline of the whole song: click to jump anywhere. Section names sit on it as plain
  // labels. A part is chosen in ⋯ → Practice a part; it's lit on the timeline, and a chip in the
  // controls goes back to the whole song.
  const pct = (time: number) => ((100 * time) / analysis.duration).toFixed(3) + '%';
  const partDialog = $<HTMLDialogElement>('#partDialog');
  const renderSections = () => {
    const whole = !selected.size && !custom;
    $('#timelineMarks').innerHTML = analysis.sections.map(section =>
      `<span style="left:${pct(section.start)};width:${pct(section.end - section.start)}">${escapeHtml(section.label)}</span>`).join('');
    $('#timelineRange').innerHTML = (whole ? [] : selectedRanges()).map(range => `<i style="left:${pct(range.start)};width:${pct(range.end - range.start)}"></i>`).join('');
    const chip = $('#partChip');
    chip.classList.toggle('hidden', whole);
    chip.textContent = labelForSelection() + ' ✕';
    $('#partList').innerHTML = analysis.sections.map(section => `<label class="check"><input type="checkbox" data-part="${section.id}" ${selected.has(section.id) ? 'checked' : ''}>
      <span><b>${escapeHtml(section.label)}</b> <small class="hint">${formatTime(section.start)}–${formatTime(section.end)}</small></span></label>`).join('');
  };
  $('#partList').addEventListener('change', event => {
    const box = (event.target as HTMLElement).closest<HTMLInputElement>('[data-part]');
    if (!box) return;
    custom = null;
    if (box.checked) selected.add(box.dataset.part!); else selected.delete(box.dataset.part!);
    selectionChanged();
  });
  $('#partChip').addEventListener('click', () => { if (!recording) wholeSong(); });
  $('#choosePart').addEventListener('click', () => { renderSections(); partDialog.showModal(); });
  $('#partWhole').addEventListener('click', () => { wholeSong(); partDialog.close(); });
  $('#partDone').addEventListener('click', () => partDialog.close());
  const timeline = $('#timeline');
  timeline.addEventListener('click', event => {
    if (recording) return;
    const rect = timeline.getBoundingClientRect();
    const time = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * analysis.duration;
    const current = review.current;
    if (reviewPlaying && current) {
      const from = current.timeline.timelineFor(time);
      if (from !== null) void playTake(current, from);
      return;
    }
    if (!inSelection(time)) wholeSong(); // jumping outside the chosen part goes back to the whole song
    void startPlayback(false, new Timeline(playbackRanges(), repeats()).timelineFor(time) ?? 0);
  });

  const sectionsDialog = $<HTMLDialogElement>('#sectionsDialog');
  const renderSectionEditor = () => {
    $('#sectionEditor').innerHTML = analysis.sections.map(section => `<label class="secEdit"><span class="mono">${formatTime(section.start)}</span>
      <select data-kind="${section.id}" aria-label="Section at ${formatTime(section.start)}">${KIND_ORDER.map(kind =>
        `<option value="${kind}" ${kind === section.kind ? 'selected' : ''}>${SECTION_NAMES[kind]}</option>`).join('')}</select>
      <strong>${escapeHtml(section.label)}</strong></label>`).join('');
  };
  $('#sectionEditor').addEventListener('change', event => {
    const select = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-kind]');
    const section = select && analysis.sections.find(item => item.id === select.dataset.kind);
    if (!select || !section) return;
    section.kind = select.value as SectionKind;
    analysis.sections = relabel(analysis.sections);
    void persist();
    renderSectionEditor();
    renderSections();
    renderLyrics();
  });
  $('#renameSections').addEventListener('click', () => { renderSectionEditor(); sectionsDialog.showModal(); });
  $('#sectionsDone').addEventListener('click', () => sectionsDialog.close());

  // ================================================================ ⋯ menu
  const moreBtn = $<HTMLButtonElement>('#moreBtn');
  const moreMenu = $('#moreMenu');
  const closeMenu = () => { moreMenu.classList.add('hidden'); moreBtn.setAttribute('aria-expanded', 'false'); };
  moreBtn.addEventListener('click', event => {
    event.stopPropagation();
    const open = moreMenu.classList.contains('hidden');
    moreMenu.classList.toggle('hidden', !open);
    moreBtn.setAttribute('aria-expanded', String(open));
  });
  // Picking an action closes the menu; ticking a checkbox leaves it open.
  moreMenu.addEventListener('click', event => { if ((event.target as HTMLElement).closest('button.menuItem')) closeMenu(); });
  const settingsPanel = $('#mixPanel');
  const mixToggle = $<HTMLButtonElement>('#mixToggle');
  const closeSettings = () => { settingsPanel.classList.add('hidden'); mixToggle.setAttribute('aria-expanded', 'false'); };
  const onDocClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (!target.closest('.menuWrap')) closeMenu();
    if (!target.closest('#controls')) closeSettings();
  };
  const onEsc = (event: KeyboardEvent) => { if (event.key === 'Escape') { closeMenu(); closeSettings(); } };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onEsc);

  const detailsDialog = $<HTMLDialogElement>('#detailsDialog');
  const renderDetails = () => {
    $('#detailsLog').innerHTML = diagEntries().map(entry =>
      `<li class="d-${entry.tone}"><span class="mono">${entry.at.toFixed(1)}s</span> ${escapeHtml(entry.text)}</li>`).join('')
      || '<li>Nothing logged yet in this visit (details are kept until the page is reloaded).</li>';
  };
  const stopDetails = onDiag(() => { if (detailsDialog.open) renderDetails(); });
  $('#showDetails').addEventListener('click', () => { renderDetails(); detailsDialog.showModal(); });
  $('#detailsClose').addEventListener('click', () => detailsDialog.close());
  $('#detailsCopy').addEventListener('click', () => {
    const text = diagEntries().map(entry => entry.at.toFixed(1) + 's ' + entry.text).join('\n');
    void navigator.clipboard?.writeText(text).then(() => toast('Details copied.'), () => toast('Couldn’t copy — take a screenshot instead.', 'error'));
  });

  const showUpNext = $<HTMLInputElement>('#showUpNext');
  showUpNext.checked = prefs.get('showUpNext', false);
  const applyUpNext = () => {
    $('#upNextPanel').classList.toggle('hidden', !showUpNext.checked);
    $('#stage').classList.toggle('withUpNext', showUpNext.checked);
  };
  showUpNext.addEventListener('change', () => { prefs.set('showUpNext', showUpNext.checked); applyUpNext(); });
  applyUpNext();

  $('#renameSong').addEventListener('click', () => {
    const name = prompt('Song name', song.title)?.trim();
    if (!name) return;
    song.title = name;
    $('#songTitle').textContent = name;
    void persist();
  });
  $('#downloadSong').addEventListener('click', async () => downloadBlob(await exportSong(song), safeName(song.title) + '.pitchcruzer'));
  $('#saveSong').addEventListener('click', async () => {
    try {
      await saveSong(song);
      session.saved = true;
      $('#saveSong').classList.add('hidden');
      toast('Saved on this device.');
    } catch { toast('Could not save (storage may be full).', 'error'); }
  });

  // ================================================================ Staff ⇄ Karaoke
  type View = 'staff' | 'karaoke';
  let view: View = prefs.get<string>('view', 'staff') === 'karaoke' ? 'karaoke' : 'staff';
  const karaoke = new Karaoke($('#lyricsList'), analysis, {
    tap: line => {
      if (pickingLines) { pickLine(line); return; }
      if (recording) return;
      if (!inSelection(line.start)) wholeSong();
      void startPlayback(false, new Timeline(playbackRanges(), repeats()).timelineFor(Math.max(0, line.start - 0.6)) ?? 0);
    },
    toggleSinger: line => {
      if (!analysis.duet || !parts) return;
      analysis.duet.overrides[line.id] = parts.get(line.id) === 'me' ? 'partner' : 'me';
      duetChanged();
    }
  });
  const setView = (next: View) => {
    view = next;
    prefs.set('view', next);
    root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.setAttribute('aria-checked', String(button.dataset.view === next)));
    $('#laneWrap').classList.toggle('hidden', next !== 'staff');
    $('#karaoke').classList.toggle('hidden', next !== 'karaoke');
    karaoke.refollow();
  };
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view as View)));

  // ================================================================ lyrics
  const renderLyrics = () => {
    const current = review.current;
    karaoke.render({
      inSelection,
      scores: current ? new Map(current.score.lines.map(item => [item.line.id, item.percent])) : null,
      singer: parts ? line => parts!.get(line.id) ?? 'me' : null,
      anchor: pickAnchor,
      cues: new Map(cues.map(cue => [cue.lineId, cue.dots]))
    });
  };
  const lyricsHintText = () => {
    if (session.lyricsJobs.has(song.id)) return '✍️ Writing the lyrics in the background — start practicing, they’ll appear when ready.';
    if (analysis.lyricsPending) return 'The lyrics were interrupted before they finished — use ⋯ → Redo lyrics.';
    if (analysis.transcript === 'failed' || analysis.transcript === 'none') return 'Lyrics couldn’t be heard automatically — use ⋯ → Fix lyrics to paste or find them.';
    return '';
  };
  /** New lyrics (written in the background, redone or fixed): refresh everything that shows them. */
  const lyricsChanged = () => {
    lane.setLyrics(laneWords());
    cues = analysis.beat ? countInCues(analysis.lines, analysis.beat) : [];
    lane.cues = cues;
    review.clear();
    if (analysis.duet) analysis.duet.overrides = {};   // line ids changed; re-guess the parts
    parts = duetParts(analysis);
    lane.partner = partnerRanges(analysis, parts);
    upNextKey = '';
    $('#lyricsHint').textContent = lyricsHintText();
    // Sections may have been re-found. While stopped, go back to the whole song; while playing,
    // keep going (dropping picks that no longer exist) so the music isn't interrupted.
    if (player.state === 'stopped') {
      custom = null;
      selected = new Set();
      idleTime = 0;
      liveTrail = [];
    } else {
      selected = new Set([...selected].filter(id => analysis.sections.some(section => section.id === id)));
    }
    renderSections();
    renderLyrics();
    updateClock();
  };

  const setPicking = (on: boolean) => {
    pickingLines = on;
    pickAnchor = null;
    karaoke.holdScroll = on;
    $('#pickLines').textContent = on ? 'Cancel picking lines' : 'Pick lines to practice';
    $('#lyricsHint').textContent = on ? 'Tap the first line you want to practice, then the last one.' : lyricsHintText();
    if (on) setView('karaoke');
    renderLyrics();
  };
  const pickLine = (line: LyricLine) => {
    if (!pickAnchor) { pickAnchor = line; renderLyrics(); toast('Now tap the last line you want.'); return; }
    const [a, b] = pickAnchor.start <= line.start ? [pickAnchor, line] : [line, pickAnchor];
    const ia = analysis.lines.indexOf(a) + 1, ib = analysis.lines.indexOf(b) + 1;
    custom = { start: Math.max(0, a.start - 1.2), end: Math.min(analysis.duration, b.end + 0.6), label: ia === ib ? 'Line ' + ia : 'Lines ' + ia + '–' + ib };
    selected.clear();
    setPicking(false);
    selectionChanged();
  };
  $('#pickLines').addEventListener('click', () => setPicking(!pickingLines));

  const showNotes = $<HTMLInputElement>('#showNotes');
  showNotes.checked = prefs.get('showNotes', false);
  const applyShowNotes = () => $('#lyricsList').classList.toggle('hideNotes', !showNotes.checked);
  showNotes.addEventListener('change', () => { prefs.set('showNotes', showNotes.checked); applyShowNotes(); });
  applyShowNotes();

  // Redo the lyrics (listen again, maybe in other languages).
  const redoDialog = $<HTMLDialogElement>('#redoDialog');
  const redoLang = $<HTMLSelectElement>('#redoLang');
  const redoQuality = $<HTMLSelectElement>('#redoQuality');
  const redoStatus = $('#redoStatus');
  const redoStart = $<HTMLButtonElement>('#redoStart');
  let redoing = false;
  $('#redoLyrics').addEventListener('click', () => {
    const current = analysis.lyricsOptions;
    redoLang.value = current ? (LANGUAGE_CHOICES.find(choice => choice.value === current.languages.join(','))?.value ?? 'auto') : prefs.get('lyricsLang', 'auto');
    redoQuality.value = current?.quality ?? prefs.get('lyricsQuality2', 'fast');
    redoStatus.textContent = '';
    void serverTranscriptionAvailable().then(available => redoQuality.closest('label')!.classList.toggle('hidden', available));
    redoDialog.showModal();
  });
  redoDialog.addEventListener('cancel', event => { if (redoing) event.preventDefault(); });
  redoStart.addEventListener('click', async () => {
    if (redoing) return;
    redoing = true;
    redoStart.disabled = true;
    $<HTMLButtonElement>('#redoCancel').disabled = true;
    if (player.state !== 'stopped') stopAll();
    prefs.set('lyricsLang', redoLang.value);
    prefs.set('lyricsQuality2', redoQuality.value);
    try {
      const heard = await transcribeLyrics(buffers.lead, analysis, lyricsOptionsFrom(redoLang.value, redoQuality.value), (step, fraction, detail) => {
        if (!disposed) redoStatus.textContent = (step === 'lyrics' ? 'Lyrics' : 'Sections') + ' · ' + Math.round(fraction * 100) + '%' + (detail ? ' — ' + detail : '');
      }, song.title);
      if (!heard) { redoStatus.textContent = 'Couldn’t hear clear words (or the lyrics model couldn’t download). Your current lyrics were kept.'; return; }
      lyricsChanged();
      void persist();
      toast('Lyrics redone.');
      redoDialog.close();
    } finally {
      redoing = false;
      redoStart.disabled = false;
      $<HTMLButtonElement>('#redoCancel').disabled = false;
    }
  });

  // Fix the lyrics (type, paste or find them online).
  const lyricsDialog = $<HTMLDialogElement>('#lyricsDialog');
  let foundOnline: Awaited<ReturnType<typeof findLyricsOnline>> = null;
  $('#lyricsSearchBtn').addEventListener('click', async () => {
    const query = $<HTMLInputElement>('#lyricsSearch').value.trim() || song.title;
    const found = await findLyricsOnline(query, analysis.duration);
    if (!found) { toast('No lyrics found online for “' + query + '”. Paste them instead.', 'error'); return; }
    $<HTMLTextAreaElement>('#lyricsText').value = found.text;
    foundOnline = found;
    toast('Found: ' + found.label + ' — check them, then Apply.');
  });
  $('#fixLyrics').addEventListener('click', () => {
    $<HTMLTextAreaElement>('#lyricsText').value = analysis.lines.map(lineText).filter(text => !/^[♪\s]+$/.test(text)).join('\n');
    lyricsDialog.showModal();
  });
  lyricsDialog.addEventListener('close', () => {
    if (lyricsDialog.returnValue !== 'apply') return;
    const text = $<HTMLTextAreaElement>('#lyricsText').value;
    if (!text.trim()) return;
    // Unedited timed lyrics from the lookup carry their own timing; otherwise match them to the singer.
    const aligned = foundOnline?.synced && text === foundOnline.text ? alignSyncedLyrics(analysis, foundOnline.synced) : null;
    foundOnline = null;
    analysis.lines = aligned ? aligned.lines : applyTypedLyrics(analysis, text);
    analysis.transcript = 'edited';
    analysis.lyricsPending = false;
    analysis.sections = buildSections(analysis.lines, analysis.notes, analysis.duration, true);
    lyricsChanged();
    void persist();
    toast('Lyrics updated.');
  });

  // ================================================================ duet
  const duetMode = $<HTMLSelectElement>('#duetMode');
  duetMode.value = analysis.duet?.mine ?? '';
  const duetChanged = () => {
    parts = duetParts(analysis);
    lane.partner = partnerRanges(analysis, parts);
    $('#duetHint').classList.toggle('hidden', !parts);
    void persist();
    renderLyrics();
    review.rescore();
    if (player.state !== 'stopped' && !recording && !reviewPlaying) {
      // Re-start from here so the new parts are heard right away.
      void startPlayback(false, player.timelineTime());
    }
  };
  duetMode.addEventListener('change', () => {
    analysis.duet = duetMode.value ? { mine: duetMode.value as 'low' | 'high', overrides: analysis.duet?.overrides ?? {} } : undefined;
    duetChanged();
    if (analysis.duet) toast('Duet on — your partner’s lines keep the original singer. Tap You/Them in Karaoke to fix any line.');
  });
  lane.partner = partnerRanges(analysis, parts);
  $('#duetHint').classList.toggle('hidden', !parts);

  // ================================================================ settings
  const bindSlider = (id: string, key: 'lead' | 'music' | 'monitor', apply: (value: number) => void) => {
    const input = $<HTMLInputElement>('#' + id);
    const out = $<HTMLOutputElement>('#' + id + 'Out');
    const set = (value: number) => {
      levels[key] = value;
      input.value = String(value);
      out.textContent = value === 0 ? 'Off' : value + '%';
      apply(value / 100);
      prefs.set('mix.' + key, value);
    };
    input.addEventListener('input', () => set(Number(input.value)));
    set(levels[key]);
    return set;
  };
  const setLead = bindSlider('mixLead', 'lead', value => player.setLevel('lead', value));
  bindSlider('mixMusic', 'music', value => player.setLevel('music', value));
  bindSlider('mixMonitor', 'monitor', value => mic.setMonitor(value));
  root.querySelectorAll<HTMLButtonElement>('[data-lead]').forEach(button => button.addEventListener('click', () => setLead(Number(button.dataset.lead))));
  mixToggle.addEventListener('click', () => {
    const open = settingsPanel.classList.toggle('hidden') === false;
    mixToggle.setAttribute('aria-expanded', String(open));
  });
  forgiveOctave.addEventListener('change', () => {
    prefs.set('forgiveOctave', forgiveOctave.checked);
    lane.forgiveOctave = forgiveOctave.checked;
    review.rescore();
  });
  const simpleView = $<HTMLInputElement>('#simpleView');
  simpleView.checked = prefs.get('simpleView', false);
  lane.simple = simpleView.checked;
  simpleView.addEventListener('change', () => { prefs.set('simpleView', simpleView.checked); lane.simple = simpleView.checked; });
  const showVoices = $<HTMLInputElement>('#showVoices');
  showVoices.checked = prefs.get('showVoices', window.innerWidth >= 700);
  lane.showVoiceTypes = showVoices.checked;
  showVoices.addEventListener('change', () => { prefs.set('showVoices', showVoices.checked); lane.showVoiceTypes = showVoices.checked; });
  speakers.addEventListener('change', () => { prefs.set('speakers', speakers.checked); if (mic.active) void enableMic(); });
  countIn.addEventListener('change', () => prefs.set('countIn', countIn.checked));
  repeatsEl.addEventListener('change', () => { prefs.set('repeats', repeats()); updateClock(); });
  const syncEchoModel = () => $('#echoModelWrap').classList.toggle('hidden', !echoMode());
  syncEchoModel();
  styleEl.addEventListener('change', () => {
    syncEchoModel();
    prefs.set('practiceStyle', styleEl.value);
    if (echoMode()) toast('Echo: listen to each line, then sing it back in the quiet. Only your turns are scored.');
    selectionChanged();
  });
  echoModelEl.addEventListener('change', () => {
    prefs.set('echoModel', echoModelEl.value);
    if (player.state !== 'stopped' && !recording) stopAll();
    if (echoModelEl.value === 'me') toast('Echo will use your best saved take for each line it covers (the artist fills in the rest).');
  });

  // ================================================================ mic
  const micButton = $<HTMLButtonElement>('#mic');
  const renderMicButton = () => {
    micButton.setAttribute('aria-pressed', String(mic.active));
    micButton.classList.toggle('on', mic.active);
    micButton.title = mic.active ? 'Microphone on — tap to turn off' : 'Microphone — see your voice on the staff';
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
    if (mic.active) { mic.stop(); renderMicButton(); } else void enableMic();
  });

  // ================================================================ playback + recording
  const playButton = $<HTMLButtonElement>('#play');
  const stopButton = $<HTMLButtonElement>('#stop');
  const recordButton = $<HTMLButtonElement>('#record');
  const countdown = $('#countdown');
  const renderTransport = () => {
    const active = player.state !== 'stopped';
    playButton.textContent = player.state === 'playing' ? '❚❚' : '▶';
    playButton.title = player.state === 'playing' ? 'Pause (Space)' : 'Play (Space)';
    playButton.disabled = recording;
    stopButton.disabled = !active;
    recordButton.disabled = active && !recording;
    recordButton.textContent = recording ? '■ Review' : '●';
    recordButton.title = recording ? 'Stop and see how you did' : 'Record yourself';
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
      const takeTimeline = new Timeline(take.segments, 1);
      const pieces = takeTimeline.hasTurns ? takeTimeline.pieces.filter(piece => piece.turn) : takeTimeline.pieces;
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

  const startPlayback = async (withRecording: boolean, from = 0) => {
    reviewPlaying = false;
    lane.trail = liveTrail;
    liveTrail.length = 0;
    lastSource = -1;
    const useCountIn = withRecording && countIn.checked;
    const model = await echoModelVoice();
    player.setLevel('voice', model ? levels.voice / 100 : 0);
    if (withRecording) mic.startRecording();
    const origin = await player.play(playbackRanges(), repeats(), {
      from, leadIn: useCountIn ? 1.9 : 0.12, model, partner: partnerRanges(analysis, parts)
    });
    if (useCountIn) {
      [1.8, 1.2, 0.6].forEach((before, index) => beep(origin - before, index === 0));
      showCountdown(origin);
    }
    recordingOrigin = origin;
    renderTransport();
  };
  const playTake = async (take: Review, from: number) => {
    reviewPlaying = true;
    lane.trail = take.score.trail;
    player.setLevel('voice', levels.voice / 100);
    await player.play(take.ranges, take.repeats, { from, voice: { buffer: take.voice, offset: take.offset }, partner: partnerRanges(analysis, parts) });
    renderTransport();
  };
  const stopAll = () => player.stop(true);

  player.onEnded = () => {
    if (recording) void finishRecording();
    idleTime = selectedRanges()[0].start;   // after a stop, Play starts from the top again
    reviewPlaying = false;
    lane.trail = liveTrail;
    countdown.classList.add('hidden');
    renderTransport();
    review.refreshPlayButton();
  };
  playButton.addEventListener('click', async () => {
    if (player.state === 'playing') { await player.pause(); renderTransport(); return; }
    if (player.state === 'paused') { await player.resume(); renderTransport(); return; }
    await startPlayback(false, new Timeline(playbackRanges(), repeats()).timelineFor(idleTime) ?? 0);
  });
  stopButton.addEventListener('click', stopAll);

  /** Jump to a moment of the song: keep playing from there, or (stopped) make it where Play starts. */
  const jumpTo = (time: number) => {
    if (recording) return;
    if (!inSelection(time)) wholeSong();
    if (player.state === 'stopped') { idleTime = time; updateClock(); return; }
    void startPlayback(false, new Timeline(playbackRanges(), repeats()).timelineFor(time) ?? 0);
  };
  $('#toStart').addEventListener('click', () => jumpTo(0));
  $('#toSection').addEventListener('click', () => {
    // The start of the section you're in — or, right at a section's start, the one before it.
    const now = idleTime;
    const starts = analysis.sections.map(section => section.start).sort((a, b) => a - b);
    const current = [...starts].reverse().find(start => start <= now + 0.05) ?? 0;
    const target = now - current < 1.5 ? ([...starts].reverse().find(start => start < current - 0.05) ?? 0) : current;
    jumpTo(target);
  });
  recordButton.addEventListener('click', async () => {
    if (recording) { stopAll(); return; }
    if (!(await enableMic())) return;
    if (!mic.canRecord) { toast('This browser can’t record here. Try Chrome, Edge or Safari.', 'error'); return; }
    if (repeats() === 99) repeatsEl.value = '1';
    recording = true;
    review.clear();
    review.close();
    closeSettings();
    await startPlayback(true);
    toast(speakers.checked ? 'Recording — sing along!' : 'Recording — sing along! (Headphones give the cleanest take.)');
  });

  const finishRecording = async () => {
    recording = false;
    renderTransport();
    const result = mic.stopRecording();
    if (!result || result.samples.length < result.sampleRate * 0.5) { toast('No audio was recorded from the mic.', 'error'); return; }
    // What you sang at clock time T answers music you heard at T − output latency − input latency.
    const latency = (player.ctx.outputLatency || 0) + (player.ctx.baseLatency || 0) + 0.02;
    const voice = player.ctx.createBuffer(1, result.samples.length, result.sampleRate);
    voice.copyToChannel(result.samples, 0);
    await review.fromRecording(voice, result.startTime - recordingOrigin - latency, playbackRanges(), repeats(), labelForSelection());
  };

  // ================================================================ review window
  const review = new TakeReview({
    root, song, buffers, player, levels,
    forgiveOctave: () => forgiveOctave.checked,
    counts: time => !parts || parts.get(analysis.lines.find(line => time >= line.start - 0.2 && time <= line.end + 0.2)?.id ?? '') !== 'partner',
    playTake,
    stop: stopAll,
    isPlayingTake: () => reviewPlaying,
    showTrail: trail => { lane.trail = trail ?? liveTrail; },
    changed: renderLyrics
  });
  $('#openTakes').addEventListener('click', () => review.open());

  // ================================================================ clock, up next, every frame
  const clock = $('#clock');
  const songPlayhead = $('#songPlayhead');
  const updateClock = () => {
    const total = player.state !== 'stopped' ? player.totalDuration : new Timeline(playbackRanges(), repeats() === 99 ? 1 : repeats()).duration;
    const t = Math.max(0, Math.min(total, player.timelineTime()));
    clock.textContent = formatTime(t) + ' / ' + formatTime(total);
    songPlayhead.style.left = pct(idleTime);
  };

  const upNext = $('#upNext');
  let upNextKey = '';
  const lineNotes = (line: LyricLine) => {
    const midis = line.words.flatMap(word => word.syllables.map(syl => syl.midi)).filter((m): m is number => m !== null);
    if (!midis.length) return '';
    const lo = Math.min(...midis), hi = Math.max(...midis);
    return Math.round(lo) === Math.round(hi) ? midiToNote(lo) : midiToNote(lo) + '–' + midiToNote(hi);
  };
  /** The optional side panel: the current + next lines, with where to breathe between them. */
  const updateUpNext = (time: number) => {
    if (!showUpNext.checked) return;
    const lines = analysis.lines.filter(line => inSelection(line.start + 0.01) || inSelection(line.end - 0.01));
    let index = lines.findIndex(line => time < line.end + 0.15);
    if (index < 0) index = lines.length;
    const shown = lines.slice(index, index + 4);
    const key = shown.map(line => line.id).join('|');
    if (key !== upNextKey) {
      upNextKey = key;
      upNext.innerHTML = shown.length ? shown.map((line, i) => {
        const next = shown[i + 1];
        const gap = next ? next.start - line.end : 0;
        const breath = next && gap >= 0.3 ? `<li class="breath">🌬 breathe${gap >= 1.2 ? ' · ' + gap.toFixed(1) + 's' : ' — quick'}</li>` : '';
        return `<li class="${i === 0 ? 'now' : ''}"><span>${escapeHtml(lineText(line))}</span><small>${lineNotes(line)}</small></li>` + breath;
      }).join('') : '<li class="done">End of selection</li>';
    }
    upNext.querySelector('li.now')?.classList.toggle('singing', Boolean(shown[0]) && time >= shown[0].start);
  };

  // A short, friendly note after each line you sing (never negative): confidence helps singing.
  const lineFlash = $('#lineFlash');
  let lineStats: { id: string; frames: number; voiced: number; hits: number } | null = null;
  let flashTimer: number | null = null;
  const finishLine = () => {
    if (!lineStats) return;
    const { frames, voiced, hits } = lineStats;
    lineStats = null;
    if (frames < 12 || voiced / frames < 0.3) return;
    const percent = Math.round((100 * hits) / frames);
    lineFlash.innerHTML = `<strong>${percent >= 80 ? '🌟 Perfect!' : percent >= 60 ? 'Great!' : percent >= 40 ? 'Nice!' : '💪 Keep going'}</strong><span>${percent >= 40 ? percent + '% on the note' : 'you’re getting it'}</span>`;
    lineFlash.classList.remove('show');
    void lineFlash.offsetWidth;
    lineFlash.classList.add('show');
    if (flashTimer !== null) window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => lineFlash.classList.remove('show'), 1600);
  };
  const trackLine = (source: number | null, sung: number | null) => {
    if (source === null || !mic.active) { if (player.state === 'stopped') finishLine(); return; }
    if (player.timeline.hasTurns && !player.timeline.pieceAt(player.timelineTime())?.turn) { finishLine(); return; }
    const line = analysis.lines.find(item => source >= item.start - 0.2 && source <= item.end + 0.2);
    if (!line || parts?.get(line.id) === 'partner') { finishLine(); return; }
    if (lineStats && lineStats.id !== line.id) finishLine();
    lineStats ??= { id: line.id, frames: 0, voiced: 0, hits: 0 };
    const target = lane.targetAt(source);
    if (!target) return;
    lineStats.frames += 1;
    if (sung === null) return;
    lineStats.voiced += 1;
    if (Math.abs(lane.errorAt(sung, target)) <= 0.5) lineStats.hits += 1;
  };

  const turnHint = $('#turnHint');
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
      // Encouragement judges the center of any vibrato; the staff still draws the real wave.
      sung = reading.midi === null ? null : liveVib.center();
      if (playing && source !== null && !reviewPlaying) {
        if (source < lastSource - 0.3) liveTrail.length = 0;
        lastSource = source;
        if (reading.midi !== null) liveTrail.push({ t: source, midi: reading.midi });
        if (liveTrail.length > 2000) liveTrail.splice(0, liveTrail.length - 1500);
      }
    }

    if (view === 'staff') lane.draw(now);
    else karaoke.update(now, playing);
    updateUpNext(now);
    // Echo: say whose turn it is, right in the controls.
    const piece = player.state !== 'stopped' && player.timeline.hasTurns && !reviewPlaying ? player.timeline.pieceAt(player.timelineTime()) : null;
    turnHint.textContent = piece ? (piece.turn ? '🎤 Your turn' : '👂 Listen') : '';
    trackLine(playing && !reviewPlaying ? source : null, sung);
    updateClock();
  };

  // Tap a note bar to hear its exact pitch — the singer's own voice (Shift+tap: a pure tone).
  const laneCanvas = $<HTMLCanvasElement>('#lane');
  laneCanvas.title = 'Tap a note bar to hear the singer sing it (Shift+tap for a pure tone)';
  laneCanvas.addEventListener('click', event => {
    const rect = laneCanvas.getBoundingClientRect();
    const note = lane.noteAtPoint(event.clientX - rect.left, event.clientY - rect.top);
    if (!note) return;
    const midi = Math.round(note.midi);
    const ctx = player.ctx;
    const useVoice = analysis.separated && !event.shiftKey;
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

  // Lyrics still being written in the background? Keep practicing; they drop in when ready.
  const onLyricsReady = (event: Event) => {
    if ((event as CustomEvent<string>).detail !== song.id) return;
    lyricsChanged();
    toast(analysis.transcript === 'failed' || analysis.transcript === 'none' ? 'Couldn’t write the lyrics — use ⋯ → Fix lyrics.' : '✍️ Lyrics are ready.');
  };
  window.addEventListener(LYRICS_READY, onLyricsReady);
  if (session.lyricsJobs.has(song.id)) toast('✍️ The notes are ready — lyrics are still being written. You can start practicing now.');

  // The stage fills whatever height is left, so redraw the canvas whenever its box changes size.
  const laneResize = new ResizeObserver(() => lane.resize());
  laneResize.observe($('#laneWrap'));
  const stopFloating = floatingControls($('#controls'), $('#stage'), $('#grip'), settingsPanel);
  const onKey = (event: KeyboardEvent) => {
    if (event.code !== 'Space' || (event.target as HTMLElement).closest('input, textarea, select, button, dialog, [role="button"]')) return;
    event.preventDefault();
    playButton.click();
  };
  window.addEventListener('keydown', onKey);

  setView(view);
  $('#lyricsHint').textContent = lyricsHintText();
  renderSections();
  renderLyrics();
  renderTransport();
  renderMicButton();
  loop();

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    laneResize.disconnect();
    stopFloating();
    stopDetails();
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onEsc);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener(LYRICS_READY, onLyricsReady);
    mic.stop();
    player.onEnded = null;
    player.close();
  };
}
