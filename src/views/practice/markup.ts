import type { StoredSong } from '../../lib/library';
import { formatTime, keyName, midiToNote, voiceTypeNames, voiceTypesFor } from '../../lib/music';
import { LANGUAGE_CHOICES } from '../../lib/prepare';
import { session } from '../../session';
import { escapeHtml } from '../../ui/dom';

/**
 * The practice screen: a slim header (title + ⋯ menu), a thin timeline of the whole song, and the
 * stage — the Staff or the Karaoke lyrics — filling the rest of the screen. The playback controls
 * float over the stage as a small pill that can be dragged anywhere; settings open from it.
 */
// Back buttons as small inline icons (emoji arrows look different on every phone).
const BACK_TO_START = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M2 2h2v12H2zM15 2v12L9 8zM9 2v12L3 8z"/></svg>';
const BACK_ONE = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2v12L4 8z"/></svg>';

export function practiceMarkup(song: StoredSong, hasMusic: boolean): string {
  const analysis = song.analysis;
  const range = analysis.range;
  const meta = [
    analysis.key ? 'Key ' + keyName(analysis.key) : null,
    range ? 'Range ' + midiToNote(range[0]) + '–' + midiToNote(range[1]) + ' (' + voiceTypeNames(voiceTypesFor(range[0], range[1])) + ')' : null,
    formatTime(analysis.duration),
    analysis.separated ? null : 'Full mix (singer not separated)'
  ].filter(Boolean).map(value => escapeHtml(String(value))).join(' · ');

  return `
  <div class="practice">
    <header class="songHead">
      <a href="#/" class="back" aria-label="Back to songs">←</a>
      <div class="songTitle"><h1 id="songTitle">${escapeHtml(song.title)}</h1><p class="meta">${meta}</p></div>
      <div class="menuWrap">
        <button id="moreBtn" class="iconBtn" aria-label="More options" aria-haspopup="menu" aria-expanded="false">⋯</button>
        <div id="moreMenu" class="popMenu hidden" role="menu">
          <button id="buildSong" class="menuItem" role="menuitem">🧩 Build my song (line by line)</button>
          <button id="pickLines" class="menuItem" role="menuitem">Pick lines to practice</button>
          <button id="openTakes" class="menuItem" role="menuitem">Saved takes &amp; scores</button>
          <button id="fixLyrics" class="menuItem" role="menuitem">Fix lyrics</button>
          <button id="redoLyrics" class="menuItem" role="menuitem">Redo lyrics (listen again)</button>
          <button id="renameSections" class="menuItem" role="menuitem">Rename sections</button>
          <button id="renameSong" class="menuItem" role="menuitem">Rename song</button>
          <button id="downloadSong" class="menuItem" role="menuitem">Download song file</button>
          <button id="saveSong" class="menuItem ${session.saved ? 'hidden' : ''}" role="menuitem">Try saving on this device again</button>
          <label class="menuItem check small"><input id="showNotes" type="checkbox"> Notes over the karaoke words</label>
          <label class="menuItem check small"><input id="showUpNext" type="checkbox"> Show “Up next” panel</label>
          <button id="showDetails" class="menuItem" role="menuitem">Show details (what happened)</button>
        </div>
      </div>
    </header>

    <div id="timeline" class="timeline" title="Click to jump there">
      <div id="timelineRange" class="tlRange"></div>
      <div id="timelineMarks" class="tlMarks" aria-hidden="true"></div>
      <span id="songPlayhead" class="playhead"></span>
    </div>

    <div class="stage" id="stage">
      <div class="karaoke hidden" id="karaoke">
        <p id="lyricsHint" class="hint small"></p>
        <div id="lyricsList" class="lyricsList"></div>
      </div>
      <div class="laneWrap" id="laneWrap">
        <canvas id="lane" aria-label="Lyrics scroll across the top; the singer’s notes sit on a treble and bass staff below; your voice is the blue line"></canvas>
        <div id="countdown" class="countdown hidden"></div>
        <div id="lineFlash" class="lineFlash" aria-live="polite"></div>
      </div>
      <aside class="upNext hidden" id="upNextPanel" aria-label="Up next"><h3>Up next</h3><ol id="upNext"></ol></aside>
      <section id="builder" class="builder hidden" aria-label="Build my song" aria-live="polite"></section>

      <div id="controls" class="controls" role="toolbar" aria-label="Playback">
        <span id="grip" class="grip" tabindex="0" role="button" title="Drag to move the controls (or use the arrow keys)" aria-label="Move the controls">⠿</span>
        <button id="toStart" class="cbtn" title="Back to the beginning of the song" aria-label="Back to the beginning of the song">${BACK_TO_START}</button>
        <button id="toSection" class="cbtn" title="Back to the start of this section (twice: the section before)" aria-label="Back to the start of this section">${BACK_ONE}</button>
        <button id="play" class="cbtn primary" title="Play / pause (Space)" aria-label="Play">▶</button>
        <button id="stop" class="cbtn" title="Stop" aria-label="Stop" disabled>■</button>
        <button id="record" class="cbtn record" title="Record yourself" aria-label="Record">●</button>
        <button id="mic" class="cbtn" title="Microphone — see your voice on the staff" aria-label="Microphone" aria-pressed="false">🎤</button>
        <span class="meters" role="group" aria-label="Levels — your mic, the artist, the music. Open each one's controls."><button class="meter" data-voice="mic" aria-label="Mic level — open mic controls"><i data-meter="mic"></i></button><button class="meter" data-voice="singer" aria-label="Artist level — open singer controls"><i data-meter="artist"></i></button><button class="meter" data-voice="music" aria-label="Music level — open music controls"><i data-meter="music"></i></button></span>
        <button id="practiceBtn" class="cbtn" title="What to practice — part, repeats, sing along or echo" aria-label="What to practice">🎵</button>
        <button id="mixToggle" class="cbtn" title="Settings" aria-label="Settings" aria-expanded="false">⚙</button>
        <div class="viewSwitch" role="radiogroup" aria-label="View">
          <button data-view="staff" role="radio" aria-checked="true" title="Notes on a staff with the words above them">Staff</button>
          <button data-view="karaoke" role="radio" aria-checked="false" title="Just the words, big, lighting up as they're sung">Karaoke</button>
        </div>
        <span id="clock" class="mono clock">0:00</span>
        <span id="turnHint" class="turnHint" aria-live="polite"></span>
        <button id="partChip" class="partChip hidden" title="Back to the whole song"></button>

        <div id="mixPanel" class="mixPanel hidden">
          <div class="toggles">
            <label class="check"><input id="forgiveOctave" type="checkbox"> Forgive octave <small>(score the right note in any octave)</small></label>
            <label class="check"><input id="countIn" type="checkbox"> Count me in before recording</label>
            <label class="check"><input id="simpleView" type="checkbox"> Simple staff <small>(fewer labels)</small></label>
            <label class="check"><input id="showVoices" type="checkbox"> Show voice types <small>(bass, tenor, alto…)</small></label>
          </div>
        </div>
      </div>
    </div>

    <dialog id="micDialog" class="dialog" aria-label="Mic check">
      <div id="micDialogBody"></div>
      <div class="row end"><button id="micDialogDone" class="btn primary" type="button">Done</button></div>
    </dialog>

    <dialog id="partDialog" class="dialog" aria-label="What to practice">
      <h2>What to practice</h2>
      <div class="practiceRow">
        <label class="inline">How <select id="practiceStyle" class="miniSelect"><option value="along">Sing along</option><option value="echo">Echo (listen, then sing it back)</option></select></label>
        <label id="echoModelWrap" class="inline hidden">Who sings first <select id="echoModel" class="miniSelect"><option value="artist">The artist</option><option value="me">My best take</option></select></label>
        <label class="inline">Repeat <select id="repeats" class="miniSelect"><option value="1">Once</option><option value="2">2×</option><option value="3">3×</option><option value="5">5×</option><option value="99">Loop</option></select></label>
      </div>
      <p class="hint small">Which part: tick one or more — or the whole song.</p>
      <div id="partList" class="partList"></div>
      <div class="row end"><button id="partWhole" class="btn ghost" type="button">Whole song</button><button id="partDone" class="btn primary" type="button">Done</button></div>
    </dialog>

    <dialog id="voicesDialog" class="dialog" aria-label="Voices">
      <div class="vtabs" role="tablist" aria-label="Voice controls">
        <button class="vtab" data-vtab="mic" role="tab" aria-selected="true" type="button">🎤 Mic</button>
        <button class="vtab" data-vtab="singer" role="tab" aria-selected="false" type="button">🎙 Singer</button>
        <button class="vtab" data-vtab="music" role="tab" aria-selected="false" type="button">🎶 Music</button>
      </div>
      <section class="vpane" data-vpane="mic" role="tabpanel" aria-label="Microphone">
        <div class="vrow">
          <button id="voicesMicToggle" class="btn" type="button" aria-pressed="false">🎤 Turn mic on</button>
          <button id="micCheckBtn" class="btn small" type="button">Mic check &amp; settings</button>
        </div>
        <label class="inline">Microphone <select id="voicesMicSelect" class="miniSelect"><option value="">Automatic (the device picks)</option></select></label>
        <div class="vrow">
          <label class="inline">Second mic <select id="voicesMic2Select" class="miniSelect"><option value="">Pick a mic…</option></select></label>
          <button id="voicesMic2Btn" class="btn small" type="button">Add second mic</button>
        </div>
        <p id="voicesMic2State" class="hint small"></p>
        <div class="mixRow">
          <label for="mixMonitor">Hear my mic</label>
          <input id="mixMonitor" type="range" min="0" max="100" step="1">
          <output id="mixMonitorOut"></output>
        </div>
        <p class="hint small">Two mics at once works on a computer (wired + Bluetooth, or two Bluetooth). Most phones only allow one mic — there, take turns and save a take each.</p>
      </section>
      <section class="vpane hidden" data-vpane="singer" role="tabpanel" aria-label="Singer">
        <div class="mixRow">
          <label for="mixLead">Singer</label>
          <input id="mixLead" type="range" min="0" max="100" step="1">
          <output id="mixLeadOut"></output>
          <div class="presets"><button class="chip" data-lead="0" type="button">Mute</button><button class="chip" data-lead="30" type="button">Guide</button><button class="chip" data-lead="100" type="button">Full</button></div>
        </div>
        ${analysis.separated ? '' : '<p class="notice small">This song was prepared without vocal separation, so the singer can’t be turned down separately.</p>'}
        <h3>Sing with a partner</h3>
        <label class="inline">I sing <select id="duetMode" class="miniSelect">
          <option value="">Off — everything</option>
          <option value="low">The lower voice</option>
          <option value="high">The higher voice</option></select></label>
        <div id="duetNames" class="vrow hidden">
          <label class="inline">Singer One (you) <input id="duetNameMe" class="textInput" maxlength="24" autocomplete="off"></label>
          <label class="inline">Singer Two (partner) <input id="duetNamePartner" class="textInput" maxlength="24" autocomplete="off"></label>
        </div>
        <p id="duetHint" class="hint small hidden">Your partner’s lines keep the original singer; only your lines are scored. In Karaoke, tap the name on a line to switch it.</p>
        <div class="row"><button id="duetAssign" class="btn small" type="button">Assign lines in Karaoke</button></div>
      </section>
      <section class="vpane hidden" data-vpane="music" role="tabpanel" aria-label="Music">
        <div class="mixRow ${hasMusic ? '' : 'disabled'}">
          <label for="mixMusic">Music</label>
          <input id="mixMusic" type="range" min="0" max="100" step="1" ${hasMusic ? '' : 'disabled'}>
          <output id="mixMusicOut"></output>
        </div>
        <div class="mixRow ${hasMusic ? '' : 'disabled'}">
          <label for="mixBass">Bass</label>
          <input id="mixBass" type="range" min="-12" max="12" step="1" ${hasMusic ? '' : 'disabled'}>
          <output id="mixBassOut"></output>
        </div>
        <div class="mixRow ${hasMusic ? '' : 'disabled'}">
          <label for="mixTreble">Treble</label>
          <input id="mixTreble" type="range" min="-12" max="12" step="1" ${hasMusic ? '' : 'disabled'}>
          <output id="mixTrebleOut"></output>
        </div>
        <p class="hint small">Bass and treble shape the background track only — the singer and your mic are untouched.</p>
      </section>
      <div class="row end"><button id="voicesDone" class="btn primary" type="button">Done</button></div>
    </dialog>

    <dialog id="sectionsDialog" class="dialog" aria-label="Rename sections">
      <h2>Rename sections</h2>
      <p class="hint small">If a section was guessed wrong, pick what it really is.</p>
      <div id="sectionEditor" class="secEditor"></div>
      <div class="row end"><button id="sectionsDone" class="btn primary" type="button">Done</button></div>
    </dialog>

    <dialog id="reviewDialog" class="dialog wide" aria-label="Your take">
      <section id="review" class="review hidden" aria-live="polite"></section>
      <div class="takesBlock"><h3>Takes &amp; scores</h3><div id="takesList"></div></div>
      <div class="row end"><button id="reviewDialogClose" class="btn ghost">Close</button></div>
    </dialog>

    <dialog id="coachDialog" class="dialog" aria-label="Section coaching">
      <div id="coachBody"></div>
      <div class="row end"><button id="coachDone" class="btn primary" type="button">Done</button></div>
    </dialog>

    <dialog id="detailsDialog" class="dialog wide" aria-label="Details">
      <h2>What happened</h2>
      <p class="hint small">Step by step: preparing this song and writing its lyrics. Copy it and send it along if something went wrong.</p>
      <ol id="detailsLog" class="diagLog"></ol>
      <div class="row end"><button id="detailsCopy" class="btn">Copy details</button><button id="detailsClose" class="btn ghost">Close</button></div>
    </dialog>

    <dialog id="redoDialog" class="dialog">
      <form method="dialog">
        <h2>Redo the lyrics</h2>
        <p class="hint">Listens to the singer again and writes down what’s sung. The language is found by itself; pick one only if it gets it wrong (for a bilingual song, pick both).</p>
        <label class="inline">Language <select id="redoLang">${LANGUAGE_CHOICES.map(choice => `<option value="${choice.value}">${choice.label}</option>`).join('')}</select></label>
        <label class="inline">Accuracy <select id="redoQuality"><option value="fast">Faster (≈80 MB, recommended)</option><option value="best">Best (≈250 MB, several times slower)</option></select></label>
        <label id="redoKeepWrap" class="check small"><input id="redoKeep" type="checkbox" checked> Keep my lyrics — only line them up with the singer again</label>
        <p id="redoStatus" class="hint small"></p>
        <div class="row end"><button class="btn ghost" value="cancel" id="redoCancel">Cancel</button><button id="redoStart" class="btn primary" type="button">Redo lyrics</button></div>
      </form>
    </dialog>

    <dialog id="lyricsDialog" class="dialog">
      <form method="dialog">
        <h2>Fix the lyrics</h2>
        <p class="hint">Paste or type the correct lyrics — one line per sung line. They’re matched to the singer automatically.</p>
        <div class="row wrap"><input id="lyricsSearch" class="textInput" placeholder="Song name and artist"><button id="lyricsSearchBtn" class="btn small" type="button">Find online</button></div>
        <textarea id="lyricsText" rows="14"></textarea>
        <div class="row end"><button class="btn ghost" value="cancel">Cancel</button><button id="applyLyrics" class="btn primary" value="apply">Apply</button></div>
      </form>
    </dialog>
  </div>`;
}
