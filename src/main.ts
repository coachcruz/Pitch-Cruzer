import './styles.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root not found');

app.innerHTML = `
<main class="shell">
  <header class="topbar">
    <div>
      <p class="eyebrow">VOCAL TARGET TRAINER</p>
      <h1>Pitch Cruzer</h1>
    </div>
    <span id="topModeStatus" class="topModeStatus">Single note</span>
  </header>

  <div id="errorBanner" class="errorBanner hidden"></div>

  <section class="modeChooser">
    <div class="modeButtons" aria-label="Practice mode">
      <button class="modeButton active" data-app-mode="single"><strong>Note</strong></button>
      <button class="modeButton" data-app-mode="phrase"><strong>Phrase</strong></button>
      <button class="modeButton" data-app-mode="reference"><strong>Match</strong></button>
    </div>
    <button id="advancedToggle" class="textButton">Tuner tools</button>
  </section>

  <div class="tunerStack">
  <section class="heroCard">
    <div class="listenStageTop">
      <div class="listeningContext">
        <p class="eyebrow">2 · LISTEN + MATCH</p>
        <span id="listeningModeLabel" class="listeningModeLabel">SINGLE NOTE</span>
        <strong id="listeningForText">G2</strong>
        <p id="listeningDetail">Choose the note below, then start listening.</p>
      </div>
      <button id="micButton" class="micButton">Start listening</button>
    </div>
    <div class="targetStrip">
      <span>Target</span>
      <strong id="activeTarget">G2</strong>
      <button id="playTone" class="ghostButton">Play tone</button>
    </div>
    <div id="phraseNow" class="phraseNow hidden">
      <span>Sing</span>
      <strong id="phraseNowWord">—</strong>
      <span id="phraseNowVowel">AH</span>
    </div>

    <div class="liveReadout">
      <div id="detectedNote" class="detectedNote">--</div>
      <div id="frequency" class="frequency">— Hz</div>
      <div id="status" class="status status-listening">LISTENING</div>
      <div id="cents" class="centsReadout">—</div>
    </div>

    <div class="meter" aria-label="Pitch cents meter">
      <div class="meterCloseZone"></div>
      <div class="meterLockZone"></div>
      <div class="centerLine"></div>
      <div id="needle" class="needle"></div>
    </div>
    <div class="meterLabels">
      <span>FLAT</span><span>IN TUNE</span><span>SHARP</span>
    </div>

    <div class="holdBlock">
      <div class="holdHeader"><span>Hold target</span><strong id="holdPercent">0%</strong></div>
      <div class="progressTrack"><div id="progressFill" class="progressFill"></div></div>
    </div>
  </section>

  <section class="traceCard">
    <div class="sectionHeading">
      <div><p class="eyebrow">LIVE APPROACH</p><h2>Pitch trace</h2></div>
      <span class="tinyLabel">±60¢</span>
    </div>
    <div class="traceWrap">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Live cents trace">
        <line x1="0" x2="100" y1="50" y2="50" class="traceTarget"></line>
        <line x1="0" x2="100" y1="31.7" y2="31.7" class="traceClose"></line>
        <line x1="0" x2="100" y1="68.3" y2="68.3" class="traceClose"></line>
        <polyline id="traceLine" points="" class="traceLine"></polyline>
      </svg>
    </div>
  </section>
  </div>

  <section id="phraseCard" class="phraseCard hidden">
    <div class="phraseWorkspaceHeader">
      <div>
        <p class="eyebrow">PHRASE PRACTICE</p>
        <h2>Build one line</h2>
      </div>
      <span id="phraseBuildState" class="phraseBuildState" aria-live="polite">Enter lyrics + notes.</span>
    </div>

    <div class="phraseInputs">
      <label>Lyrics / syllables
        <textarea id="lyricsText" rows="2" placeholder="raise | your | yah | yah | yah"></textarea>
      </label>
      <label>Target notes
        <textarea id="phraseNotes" rows="2" placeholder="G3 → A3 → B3 → B3 → B3"></textarea>
      </label>
    </div>

    <div id="phraseWarning" class="phraseWarning hidden"></div>
    <div id="phraseUnits" class="phraseUnits emptyPhrase hidden"></div>

    <div id="vowelCoach" class="vowelCoach hidden">
      <div class="coachGrid">
        <div><span class="coachLabel">VOWEL</span><p id="coachVowel">—</p></div>
        <div><span class="coachLabel">MOUTH</span><p id="mouthCue"></p></div>
        <div><span class="coachLabel">RESONANCE</span><p id="resonanceCue"></p></div>
      </div>
    </div>

    <div class="phraseActionRow">
      <button id="practicePhrase" class="primaryButton" disabled>Start practice</button>
    </div>

    <details class="cadencePanel">
      <summary>
        <strong>Entrance cues</strong>
        <span class="cadenceNote">Optional · count-in · tempo · tone / speech</span>
      </summary>

      <div class="cadenceControls">
        <label>BPM
          <input id="cadenceBpm" type="number" min="40" max="220" step="1" value="84">
        </label>
        <label>Count-in
          <select id="cadenceCountIn">
            <option value="0">None</option>
            <option value="1">1 beat</option>
            <option value="2">2 beats</option>
            <option value="4" selected>4 beats</option>
          </select>
        </label>
        <label>Beats / unit
          <select id="cadenceBeats">
            <option value="0.5">½ beat</option>
            <option value="1" selected>1 beat</option>
            <option value="2">2 beats</option>
            <option value="4">4 beats</option>
          </select>
        </label>
        <label>Cue
          <select id="cadenceMode">
            <option value="both" selected>Both</option>
            <option value="tone">Tone</option>
            <option value="speak">Speak</option>
          </select>
        </label>
        <label>Speech
          <select id="cadenceSpeechMode">
            <option value="unit" selected>Word / unit</option>
            <option value="attack">First syllable</option>
          </select>
        </label>
      </div>

      <div class="buttonRow cadenceButtons">
        <button id="startCadence" class="primaryButton" disabled>Start cues</button>
        <button id="stopCadence" class="secondaryButton" disabled>Stop</button>
      </div>
      <div id="cadenceStatus" class="cadenceStatus"></div>
    </details>
  </section>

  <section id="referenceCard" class="referenceCard hidden">
    <div class="sectionHeading">
      <div><p class="eyebrow">SONG PRACTICE</p><h2>Match</h2></div>
      <div class="matchBadges">
        <span id="lalalStatus" class="tinyLabel">LALAL CHECKING</span>
        <span id="referenceCapability" class="tinyLabel">NO SONG</span>
      </div>
    </div>

    <div class="sourceLaunchRow" aria-label="Open a song source">
      <span class="sourceLaunchLabel">OPEN SOURCE</span>
      <a class="sourceLink" href="https://www.youtube.com/" target="_blank" rel="noopener noreferrer">YouTube ↗</a>
      <a class="sourceLink" href="https://suno.com/" target="_blank" rel="noopener noreferrer">Suno ↗</a>
      <span class="sourceLaunchHint">Open the song in another tab, then come back here.</span>
    </div>

    <div class="captureBar">
      <button id="recordSourceAudio" class="primaryButton capturePrimary">Record browser tab</button>
      <button id="stopSourceAudio" class="captureStop hidden" disabled>Stop & analyze</button>
      <span id="sourceTimer" class="captureState">00:00</span>
      <label class="fileAction">
        <span>or upload audio / video</span>
        <input id="referenceFile" type="file" accept=".mp3,.ogg,.wav,.flac,.aiff,.aif,.aac,.m4a,.avi,.mp4,.mkv,.mov,.m4v">
      </label>
    </div>

    <div class="captureInstruction">
      Chrome will open a picker. Choose the actual YouTube/Suno tab and turn on <strong>Share tab audio</strong>.
    </div>

    <div id="referenceStatus" class="referenceStatus">Upload a song, or record audio from another browser tab. Pitch Cruzer prepares it automatically.</div>

    <div id="analysisProgress" class="analysisProgress hidden">
      <div class="progressTrack"><div id="analysisProgressFill" class="progressFill"></div></div>
      <span id="analysisProgressText">Preparing song…</span>
    </div>

    <div id="songWorkspace" class="songWorkspace hidden">
      <div class="sectionToolbar">
        <button id="selectVerses" class="textButton">Verses</button>
        <button id="selectChoruses" class="textButton">Choruses</button>
        <button id="clearSections" class="textButton">Clear</button>
        <label>Repeat
          <select id="loopCount">
            <option value="1" selected>1×</option>
            <option value="2">2×</option>
            <option value="3">3×</option>
            <option value="5">5×</option>
          </select>
        </label>
      </div>

      <div class="pitchRangeRow">
        <span class="coachLabel">TUNER RANGE</span>
        <button type="button" class="rangeMode active" data-pitch-range-mode="song">Follow song</button>
        <button type="button" class="rangeMode" data-pitch-range-mode="key">Explore key</button>
        <button type="button" class="rangeMode" data-pitch-range-mode="open">Open range</button>
        <span id="songRangeLabel" class="rangeLabel">Song range: analyzing…</span>
      </div>
      <div id="keyGuide" class="keyGuide">Load a song to build its key guide.</div>

      <div id="sectionChips" class="sectionChips"></div>

      <div class="selectedReference">
        <span class="coachLabel">SELECTED NOTES</span>
        <div id="referenceSequence" class="derivedSequence">Select a section.</div>
      </div>

      <div class="stemMixer">
        <div class="stemRow">
          <span>Artist</span>
          <div class="artistPresets">
            <button type="button" data-artist-level="100" class="stemPreset active">100</button>
            <button type="button" data-artist-level="50" class="stemPreset">50</button>
            <button type="button" data-artist-level="20" class="stemPreset">20</button>
            <button type="button" data-artist-level="0" class="stemPreset">Mute</button>
          </div>
        </div>
        <label>Backing vocals <span id="backingVocalLevelValue">100%</span>
          <input id="backingVocalLevel" type="range" min="0" max="100" step="1" value="100">
        </label>
        <label>Instrumental <span id="instrumentalLevelValue">100%</span>
          <input id="instrumentalLevel" type="range" min="0" max="100" step="1" value="100">
        </label>
      </div>

      <div class="practiceActions">
        <button id="playSelection" class="secondaryButton">Play selection</button>
        <button id="recordTake" class="primaryButton">Record take</button>
        <button id="stopPractice" class="secondaryButton" disabled>Stop</button>
      </div>
      <div id="takeStatus" class="takeStatus">Choose one or more sections. Click several, or Shift-click a range.</div>

      <div id="reviewPanel" class="reviewPanel hidden">
        <div class="reviewTop"><span class="coachLabel">TAKE REVIEW</span><strong id="reviewSummary">—</strong></div>
        <div id="reviewDetails" class="reviewDetails"></div>
      </div>
    </div>
  </section>

  <section id="controlsGrid" class="controlsGrid">
    <div id="singleTargetPanel" class="panel">
      <div class="setupStepLabel">1 · SET YOUR TARGET</div>
      <div class="sectionHeading"><div><p class="eyebrow">SINGLE NOTE</p><h2>Target</h2></div></div>
      <div class="targetControls">
        <label>Note<select id="targetNote"></select></label>
        <label>Octave<select id="targetOctave"></select></label>
      </div>
    </div>

    <div id="cruisePanel" class="panel cruisePanel hidden">
      <div class="sectionHeading">
        <div><p class="eyebrow">SEQUENCE TRAINER</p><h2>Cruise Mode</h2></div>
        <span id="stepBadge" class="stepBadge">1/6</span>
      </div>
      <label class="sequenceLabel">Target sequence
        <textarea id="sequenceText" rows="3">C#3 → B2 → A2 → G2 → F#2 → G2</textarea>
      </label>
      <div id="sequenceChips" class="sequenceChips"></div>
      <div class="buttonRow">
        <button id="startCruise" class="primaryButton">Start Cruise</button>
        <button id="resetCruise" class="secondaryButton">Reset</button>
      </div>
    </div>

    <div id="accuracyPanel" class="panel hidden">
      <div class="sectionHeading"><div><p class="eyebrow">TUNER</p><h2>Accuracy</h2></div></div>
      <div class="settingRow">
        <label>In tune <span id="lockedValue">±10¢</span><input id="lockedSlider" type="range" min="5" max="20" step="1" value="10"></label>
        <label>Near <span id="closeValue">±25¢</span><input id="closeSlider" type="range" min="15" max="50" step="1" value="25"></label>
        <label>Advance after <span id="holdValue">0.65s</span><input id="holdSlider" type="range" min="250" max="1500" step="50" value="650"></label>
      </div>
    </div>
  </section>

  <footer>Tuned for low voices. Detection checks likely subharmonics before accepting octave jumps.</footer>
</main>`;

const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];

const qs = <T extends HTMLElement>(selector: string) => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error('Missing element: ' + selector);
  return element;
};

const shellEl = qs<HTMLElement>('.shell');
const micButton = qs<HTMLButtonElement>('#micButton');
const topModeStatusEl = qs<HTMLElement>('#topModeStatus');
const listeningModeLabelEl = qs<HTMLElement>('#listeningModeLabel');
const listeningForTextEl = qs<HTMLElement>('#listeningForText');
const listeningDetailEl = qs<HTMLElement>('#listeningDetail');
const advancedToggleButton = qs<HTMLButtonElement>('#advancedToggle');
const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-app-mode]'));
const phraseCardEl = qs<HTMLElement>('#phraseCard');
const referenceCardEl = qs<HTMLElement>('#referenceCard');
const controlsGridEl = qs<HTMLElement>('#controlsGrid');
const singleTargetPanelEl = qs<HTMLElement>('#singleTargetPanel');
const cruisePanelEl = qs<HTMLElement>('#cruisePanel');
const accuracyPanelEl = qs<HTMLElement>('#accuracyPanel');
const playToneButton = qs<HTMLButtonElement>('#playTone');
const activeTargetEl = qs<HTMLElement>('#activeTarget');
const detectedNoteEl = qs<HTMLElement>('#detectedNote');
const frequencyEl = qs<HTMLElement>('#frequency');
const statusEl = qs<HTMLElement>('#status');
const centsEl = qs<HTMLElement>('#cents');
const needleEl = qs<HTMLElement>('#needle');
const holdPercentEl = qs<HTMLElement>('#holdPercent');
const progressFillEl = qs<HTMLElement>('#progressFill');
const traceLineEl = qs<SVGPolylineElement>('#traceLine');
const errorBannerEl = qs<HTMLElement>('#errorBanner');
const targetNoteEl = qs<HTMLSelectElement>('#targetNote');
const targetOctaveEl = qs<HTMLSelectElement>('#targetOctave');
const sequenceTextEl = qs<HTMLTextAreaElement>('#sequenceText');
const sequenceChipsEl = qs<HTMLElement>('#sequenceChips');
const startCruiseButton = qs<HTMLButtonElement>('#startCruise');
const resetCruiseButton = qs<HTMLButtonElement>('#resetCruise');
const stepBadgeEl = qs<HTMLElement>('#stepBadge');
const lockedSlider = qs<HTMLInputElement>('#lockedSlider');
const closeSlider = qs<HTMLInputElement>('#closeSlider');
const holdSlider = qs<HTMLInputElement>('#holdSlider');
const lockedValue = qs<HTMLElement>('#lockedValue');
const closeValue = qs<HTMLElement>('#closeValue');
const holdValue = qs<HTMLElement>('#holdValue');
const lyricsTextEl = qs<HTMLTextAreaElement>('#lyricsText');
const phraseNotesEl = qs<HTMLTextAreaElement>('#phraseNotes');
const practicePhraseButton = qs<HTMLButtonElement>('#practicePhrase');
const phraseBuildStateEl = qs<HTMLElement>('#phraseBuildState');
const cadenceBpmEl = qs<HTMLInputElement>('#cadenceBpm');
const cadenceCountInEl = qs<HTMLSelectElement>('#cadenceCountIn');
const cadenceBeatsEl = qs<HTMLSelectElement>('#cadenceBeats');
const cadenceModeEl = qs<HTMLSelectElement>('#cadenceMode');
const cadenceSpeechModeEl = qs<HTMLSelectElement>('#cadenceSpeechMode');
const startCadenceButton = qs<HTMLButtonElement>('#startCadence');
const stopCadenceButton = qs<HTMLButtonElement>('#stopCadence');
const cadenceStatusEl = qs<HTMLElement>('#cadenceStatus');
const phraseWarningEl = qs<HTMLElement>('#phraseWarning');
const phraseUnitsEl = qs<HTMLElement>('#phraseUnits');
const vowelCoachEl = qs<HTMLElement>('#vowelCoach');
const coachVowelEl = qs<HTMLElement>('#coachVowel');
const mouthCueEl = qs<HTMLElement>('#mouthCue');
const resonanceCueEl = qs<HTMLElement>('#resonanceCue');
const phraseNowEl = qs<HTMLElement>('#phraseNow');
const phraseNowWordEl = qs<HTMLElement>('#phraseNowWord');
const phraseNowVowelEl = qs<HTMLElement>('#phraseNowVowel');
const referenceFileEl = qs<HTMLInputElement>('#referenceFile');
const recordSourceAudioButton = qs<HTMLButtonElement>('#recordSourceAudio');
const stopSourceAudioButton = qs<HTMLButtonElement>('#stopSourceAudio');
const sourceTimerEl = qs<HTMLElement>('#sourceTimer');
const referenceStatusEl = qs<HTMLElement>('#referenceStatus');
const referenceCapabilityEl = qs<HTMLElement>('#referenceCapability');
const lalalStatusEl = qs<HTMLElement>('#lalalStatus');
const analysisProgressEl = qs<HTMLElement>('#analysisProgress');
const analysisProgressFillEl = qs<HTMLElement>('#analysisProgressFill');
const analysisProgressTextEl = qs<HTMLElement>('#analysisProgressText');
const songWorkspaceEl = qs<HTMLElement>('#songWorkspace');
const sectionChipsEl = qs<HTMLElement>('#sectionChips');
const selectVersesButton = qs<HTMLButtonElement>('#selectVerses');
const selectChorusesButton = qs<HTMLButtonElement>('#selectChoruses');
const clearSectionsButton = qs<HTMLButtonElement>('#clearSections');
const loopCountEl = qs<HTMLSelectElement>('#loopCount');
const referenceSequenceEl = qs<HTMLElement>('#referenceSequence');
const songRangeLabelEl = qs<HTMLElement>('#songRangeLabel');
const keyGuideEl = qs<HTMLElement>('#keyGuide');
const pitchRangeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-pitch-range-mode]'));
const backingVocalLevelEl = qs<HTMLInputElement>('#backingVocalLevel');
const backingVocalLevelValueEl = qs<HTMLElement>('#backingVocalLevelValue');
const instrumentalLevelEl = qs<HTMLInputElement>('#instrumentalLevel');
const instrumentalLevelValueEl = qs<HTMLElement>('#instrumentalLevelValue');
const artistPresetButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-artist-level]'));
const playSelectionButton = qs<HTMLButtonElement>('#playSelection');
const recordTakeButton = qs<HTMLButtonElement>('#recordTake');
const stopPracticeButton = qs<HTMLButtonElement>('#stopPractice');
const takeStatusEl = qs<HTMLElement>('#takeStatus');
const reviewPanelEl = qs<HTMLElement>('#reviewPanel');
const reviewSummaryEl = qs<HTMLElement>('#reviewSummary');
const reviewDetailsEl = qs<HTMLElement>('#reviewDetails');

targetNoteEl.innerHTML = NOTE_NAMES.map(
  name => '<option value="' + name + '">' + name + '</option>'
).join('');
targetNoteEl.value = 'G';
targetOctaveEl.innerHTML = [0, 1, 2, 3, 4, 5, 6, 7]
  .map(octave => '<option value="' + octave + '">' + octave + '</option>')
  .join('');
targetOctaveEl.value = '2';

let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let stream: MediaStream | null = null;
let frameId: number | null = null;
let micOn = false;
let lastProcess = 0;
let recentFrequencies: number[] = [];
let previousStableFrequency: number | null = null;
let lockStart: number | null = null;
let cruiseOn = false;
let sequenceIndex = 0;
let trace: number[] = [];
let phraseMode = false;
let phraseWords: string[] = [];
let phraseNotes: string[] = [];
let phraseVowels: string[] = [];
let selectedPhraseIndex = 0;
type AppMode = 'single' | 'phrase' | 'reference';

const requestedMode = new URLSearchParams(window.location.search).get('mode');
let appMode: AppMode = requestedMode === 'phrase' || requestedMode === 'reference' ? requestedMode : 'single';
let advancedControls = false;
let cadencePlaying = false;
let cadenceIndex = 0;
let cadenceTimers: number[] = [];
let cueAudioContext: AudioContext | null = null;
let leadVocalBuffer: AudioBuffer | null = null;
let backingVocalBuffer: AudioBuffer | null = null;
let instrumentalBuffer: AudioBuffer | null = null;
let derivedReferenceNotes: string[] = [];

type PitchBounds = { minHz: number; maxHz: number };
type PitchRangeMode = 'song' | 'key' | 'open';
type DetectedKey = {
  tonic: number;
  mode: 'major' | 'minor';
  confidence: number;
};

const OPEN_VOCAL_BOUNDS: PitchBounds = { minHz: 27.5, maxHz: 2093 };
let songPitchBounds: PitchBounds | null = null;
let detectedSongKey: DetectedKey | null = null;
let pitchRangeMode: PitchRangeMode = 'song';

type SectionKind = 'intro' | 'verse' | 'pre' | 'chorus' | 'bridge' | 'outro' | 'section';
type SongSection = {
  id: string;
  label: string;
  kind: SectionKind;
  start: number;
  end: number;
  notes: string[];
  activity: number;
};
type PracticeSegment = {
  sourceStart: number;
  duration: number;
  label: string;
};

let songSections: SongSection[] = [];
let selectedSectionIds = new Set<string>();
let lastSectionIndex: number | null = null;
let artistLevel = 1;
type SourceUiState = 'idle' | 'requesting' | 'recording' | 'finalizing' | 'processing';

let sourceCaptureStream: MediaStream | null = null;
let sourceCaptureContext: AudioContext | null = null;
let sourceCaptureSource: MediaStreamAudioSourceNode | null = null;
let sourceCaptureProcessor: ScriptProcessorNode | null = null;
let sourceCaptureSink: GainNode | null = null;
let sourcePcmChunks: Int16Array[] = [];
let sourceCaptureSampleRate = 48000;
let sourceCaptureStartedAt = 0;
let sourceTimerHandle: number | null = null;
let sourceUiState: SourceUiState = 'idle';
let practiceContext: AudioContext | null = null;
let practiceSources: AudioBufferSourceNode[] = [];
let practiceArtistGain: GainNode | null = null;
let practiceBackingVocalGain: GainNode | null = null;
let practiceInstrumentalGain: GainNode | null = null;
let practiceStopTimer: number | null = null;
let practiceSegments: PracticeSegment[] = [];
let takeMicStream: MediaStream | null = null;
let takeRecorder: MediaRecorder | null = null;
let takeChunks: Blob[] = [];
let takeLeadInSeconds = 0;
let takeTotalDuration = 0;

type VowelProfile = {
  label: string;
  mouth: string;
  resonance: string;
  pitch: string;
};

const VOWEL_PROFILES: Record<string, VowelProfile> = {
  AH: {
    label: 'AH',
    mouth: 'Release the jaw, keep the lips neutral, and let the tongue sit low without pressing it down.',
    resonance: 'Open shape exposes more low and mid resonance. Big is useful; over-opening can make the note feel loose.',
    pitch: 'Keep the pitch in the vocal folds. Do not lower the jaw farther to chase a low note.'
  },
  EH: {
    label: 'EH',
    mouth: 'Medium jaw opening, tongue forward, lips neutral rather than stretched.',
    resonance: 'Balanced and clear with more forward energy than AH or OH.',
    pitch: 'Keep the tongue forward without clamping the jaw; jaw tension can make the attack unstable.'
  },
  EE: {
    label: 'EE',
    mouth: 'Tongue high and forward, jaw relatively narrow, lips only slightly spread.',
    resonance: 'Bright upper harmonics and strong definition. Too much smile can thin or squeeze the sound.',
    pitch: 'Do not sharpen by spreading harder. Keep the note steady and let the vowel create the brightness.'
  },
  IH: {
    label: 'IH',
    mouth: 'A relaxed, less extreme EE: tongue forward-high with a little more jaw release.',
    resonance: 'Forward and clear without as much brightness or tension as EE.',
    pitch: 'Useful for keeping a note centered; avoid letting IH collapse toward a swallowed UH.'
  },
  OH: {
    label: 'OH',
    mouth: 'Round the lips with a medium-open jaw. Keep space behind the teeth without pulling the tongue back.',
    resonance: 'Rounds and darkens the formants, which can make a low note sound larger.',
    pitch: 'Round the vowel without swallowing it. Over-covering can blur the fundamental and make you feel flat.'
  },
  OO: {
    label: 'OO',
    mouth: 'Lips rounded and slightly forward, jaw narrow, tongue high-back but not retracted into the throat.',
    resonance: 'Strong dark/covered color. It can emphasize depth even when the fundamental note does not change.',
    pitch: 'Keep airflow and fold vibration steady. Do not use extra lip rounding as a substitute for actually landing the note.'
  },
  UH: {
    label: 'UH',
    mouth: 'Neutral lips, moderate jaw release, tongue central and relaxed.',
    resonance: 'Neutral/dark center that is often easy to stabilize, but it can become muffled if swallowed.',
    pitch: 'Good reset vowel for finding center. Keep it speech-like instead of pushing it backward.'
  },
  AY: {
    label: 'AY',
    mouth: 'Start on the open first vowel, then move toward EE late in the syllable.',
    resonance: 'A moving vowel changes the resonance during the note, so the color shifts even if the pitch stays fixed.',
    pitch: 'Land and hold the pitch on the first vowel. Delay the glide until the end instead of letting the diphthong pull the note around.'
  }
};

const VOWEL_KEYS = Object.keys(VOWEL_PROFILES);

function inferVowel(unit: string): string {
  const word = unit.toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return 'UH';
  if (/^(i|my|why|try|high|night|light|wide|raise|day|say|way)/.test(word) || /(igh|ai|ay|ey)/.test(word)) return 'AY';
  if (/(ee|ea|ie)/.test(word) || /^(me|we|he|she|be)$/.test(word)) return 'EE';
  if (/(oo|ue|ew)/.test(word) || /^(you|who|to|do)$/.test(word)) return 'OO';
  if (/(oa|ow|oe)/.test(word) || /^(oh|go|no|so)$/.test(word)) return 'OH';
  if (/(eh|ae)/.test(word) || /^(get|best|when|then|there)$/.test(word)) return 'EH';
  if (/(ih|it|is|in)/.test(word) || /^(with|this|his|give)$/.test(word)) return 'IH';
  if (/(uh|ou)/.test(word) || /^(the|a|of|your)$/.test(word)) return 'UH';
  if (/(ah|aw)/.test(word) || /^(yah|ya|far|are|on)$/.test(word)) return 'AH';
  const vowel = word.match(/[aeiouy]/)?.[0];
  if (vowel === 'e') return 'EH';
  if (vowel === 'i' || vowel === 'y') return 'IH';
  if (vowel === 'o') return 'OH';
  if (vowel === 'u') return 'UH';
  return 'AH';
}

function splitPhraseUnits(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.includes('|')) {
    return trimmed.split('|').map(item => item.trim()).filter(Boolean);
  }
  return trimmed.split(/\s+/).map(item => item.trim()).filter(Boolean);
}

function parseNoteList(value: string): string[] {
  return value
    .split(/(?:→|,|\s)+/)
    .map(item => item.trim())
    .filter(item => item.length > 0 && noteToMidi(item) !== null);
}

function setReferenceStatus(message: string, capability: string): void {
  referenceStatusEl.textContent = message;
  referenceCapabilityEl.textContent = capability;
}

let lalalChecked = false;

async function checkLalalConnection(force = false): Promise<void> {
  if (lalalChecked && !force) return;
  lalalStatusEl.textContent = 'LALAL CHECKING';

  try {
    const result = await requestJson<{ minutes_left?: number }>('/api/lalal/minutes', {
      method: 'POST'
    });
    lalalChecked = true;
    lalalStatusEl.textContent = typeof result.minutes_left === 'number'
      ? 'LALAL ' + result.minutes_left.toFixed(1) + ' MIN'
      : 'LALAL READY';
  } catch {
    lalalStatusEl.textContent = 'LALAL KEY ERROR';
  }
}

function setAnalysisProgress(percent: number, message: string): void {
  analysisProgressEl.classList.remove('hidden');
  analysisProgressFillEl.style.width = Math.max(0, Math.min(100, percent)).toFixed(0) + '%';
  analysisProgressTextEl.textContent = message;
}

function clearAnalysisProgress(): void {
  analysisProgressEl.classList.add('hidden');
}

function getRecorderMimeType(): string {
  if (!('MediaRecorder' in window)) return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4'
  ];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) ?? '';
}

function writeWaveText(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function pcmChunksToWave(chunks: Int16Array[], sampleRate: number): Blob {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const dataBytes = sampleCount * 2;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  writeWaveText(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeWaveText(view, 8, 'WAVE');
  writeWaveText(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeWaveText(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  return new Blob([header, ...chunks], { type: 'audio/wav' });
}

async function decodeReferenceBytes(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(bytes.slice(0));
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || 'Unexpected server response' };
  }
  if (!response.ok) {
    const value = data as { error?: string; detail?: string };
    throw new Error(value.error || value.detail || 'Request failed (' + response.status + ')');
  }
  return data as T;
}

async function uploadToLalal(blob: Blob, filename: string): Promise<string> {
  const response = await requestJson<{ id?: string }>('/api/lalal/upload', {
    method: 'POST',
    headers: { 'X-File-Name': filename },
    body: blob
  });
  if (!response.id) throw new Error('LALAL upload did not return a source id.');
  return response.id;
}

async function startLalalSplit(sourceId: string): Promise<string> {
  const response = await requestJson<{ task_id?: string }>('/api/lalal/split', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_id: sourceId })
  });
  if (!response.task_id) throw new Error('LALAL split did not return a task id.');
  return response.task_id;
}

type LalalTrack = { label: string; type: string; url: string };
type LalalCheckItem = {
  status: 'progress' | 'success' | 'error' | 'cancelled' | 'server_error';
  progress?: number;
  error?: string | { detail?: string };
  result?: { duration?: number; tracks?: LalalTrack[] };
};

async function waitForLalal(taskId: string): Promise<LalalTrack[]> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const payload = await requestJson<{ result?: Record<string, LalalCheckItem> }>('/api/lalal/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId })
    });
    const item = payload.result?.[taskId];
    if (!item) throw new Error('LALAL returned no task status.');

    if (item.status === 'success') return item.result?.tracks ?? [];
    if (item.status === 'error' || item.status === 'server_error' || item.status === 'cancelled') {
      const detail = typeof item.error === 'string' ? item.error : item.error?.detail;
      throw new Error(detail || 'LALAL separation failed.');
    }

    const progress = item.progress ?? 0;
    setAnalysisProgress(18 + progress * 0.62, 'Separating lead vocal, backing vocals, and instrumental… ' + progress + '%');
    await new Promise(resolve => window.setTimeout(resolve, 2100));
  }
  throw new Error('Stem separation is taking longer than expected.');
}

async function fetchTrackBuffer(url: string): Promise<AudioBuffer> {
  const response = await fetch('/api/lalal/track?url=' + encodeURIComponent(url));
  if (!response.ok) throw new Error('Could not load a separated track.');
  return decodeReferenceBytes(await response.arrayBuffer());
}

function rmsFrame(buffer: AudioBuffer, startSample: number, frameSamples: number): number {
  const end = Math.min(buffer.length, startSample + frameSamples);
  if (end <= startSample) return 0;
  let sum = 0;
  let count = 0;
  for (let i = startSample; i < end; i += 1) {
    let value = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      value += buffer.getChannelData(channel)[i] ?? 0;
    }
    value /= buffer.numberOfChannels;
    sum += value * value;
    count += 1;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

function pitchFrames(
  buffer: AudioBuffer,
  startSeconds: number,
  durationSeconds: number,
  stepSeconds = 0.14,
  bounds: PitchBounds = OPEN_VOCAL_BOUNDS
): Array<number | null> {
  const sampleRate = buffer.sampleRate;
  const frameSize = 4096;
  const step = Math.max(1, Math.floor(sampleRate * stepSeconds));
  const start = Math.max(0, Math.floor(startSeconds * sampleRate));
  const end = Math.min(buffer.length, Math.floor((startSeconds + durationSeconds) * sampleRate));
  const values: Array<number | null> = [];

  for (let position = start; position + frameSize < end; position += step) {
    const frame = new Float32Array(frameSize);
    for (let i = 0; i < frameSize; i += 1) {
      let sample = 0;
      const index = position + i;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        sample += buffer.getChannelData(channel)[index] ?? 0;
      }
      frame[i] = sample / buffer.numberOfChannels;
    }
    const result = estimatePitch(frame, sampleRate, bounds);
    values.push(result ? frequencyToMidi(result.frequency) : null);
  }
  return values;
}

function collapseReferencePitches(midis: Array<number | null>): string[] {
  const notes: string[] = [];
  let current: number | null = null;
  let count = 0;
  const flush = () => {
    if (current !== null && count >= 2) {
      const note = midiToNote(current);
      if (notes[notes.length - 1] !== note) notes.push(note);
    }
    current = null;
    count = 0;
  };

  midis.forEach(value => {
    if (value === null) {
      flush();
      return;
    }
    const rounded = Math.round(value);
    if (current === rounded) {
      count += 1;
      return;
    }
    flush();
    current = rounded;
    count = 1;
  });
  flush();
  return notes.slice(0, 48);
}

function noteBigramSimilarity(a: string[], b: string[]): number {
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (values: string[]) => new Set(values.slice(0, -1).map((value, index) => value + '>' + values[index + 1]));
  const ga = grams(a);
  const gb = grams(b);
  let intersection = 0;
  ga.forEach(value => { if (gb.has(value)) intersection += 1; });
  const union = new Set([...ga, ...gb]).size;
  return union ? intersection / union : 0;
}

function sectionActivity(buffer: AudioBuffer, start: number, end: number): number {
  const frameSeconds = 0.25;
  const frameSamples = Math.max(1, Math.floor(buffer.sampleRate * frameSeconds));
  const startSample = Math.floor(start * buffer.sampleRate);
  const endSample = Math.floor(end * buffer.sampleRate);
  const values: number[] = [];
  for (let position = startSample; position < endSample; position += frameSamples) {
    values.push(rmsFrame(buffer, position, frameSamples));
  }
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const high = sorted[Math.floor(sorted.length * 0.75)] ?? 0;
  const threshold = Math.max(0.0035, high * 0.22);
  return values.filter(value => value > threshold).length / values.length;
}

async function buildSongSections(buffer: AudioBuffer): Promise<SongSection[]> {
  const duration = buffer.duration;
  if (duration <= 0) return [];

  const frameSeconds = 0.25;
  const frameSamples = Math.max(1, Math.floor(buffer.sampleRate * frameSeconds));
  const envelope: number[] = [];
  for (let position = 0; position < buffer.length; position += frameSamples) {
    envelope.push(rmsFrame(buffer, position, frameSamples));
  }

  const sorted = [...envelope].sort((a, b) => a - b);
  const high = sorted[Math.floor(sorted.length * 0.8)] ?? 0;
  const threshold = Math.max(0.0035, high * 0.18);
  const gapCenters: number[] = [];
  let gapStart: number | null = null;

  envelope.forEach((value, index) => {
    const silent = value <= threshold;
    if (silent && gapStart === null) gapStart = index;
    if ((!silent || index === envelope.length - 1) && gapStart !== null) {
      const gapEnd = silent && index === envelope.length - 1 ? index + 1 : index;
      const gapDuration = (gapEnd - gapStart) * frameSeconds;
      if (gapDuration >= 1.1) gapCenters.push(((gapStart + gapEnd) / 2) * frameSeconds);
      gapStart = null;
    }
  });

  const targetCount = Math.max(3, Math.min(9, Math.round(duration / 23)));
  const boundaries = [0];
  const used = new Set<number>();
  for (let index = 1; index < targetCount; index += 1) {
    const desired = duration * index / targetCount;
    let bestIndex = -1;
    let bestDistance = 8;
    gapCenters.forEach((value, candidateIndex) => {
      const distance = Math.abs(value - desired);
      if (!used.has(candidateIndex) && distance < bestDistance && value > boundaries[boundaries.length - 1] + 7) {
        bestDistance = distance;
        bestIndex = candidateIndex;
      }
    });
    const boundary = bestIndex >= 0 ? gapCenters[bestIndex] : desired;
    if (bestIndex >= 0) used.add(bestIndex);
    if (boundary - boundaries[boundaries.length - 1] >= 7 && duration - boundary >= 7) boundaries.push(boundary);
  }
  boundaries.push(duration);
  boundaries.sort((a, b) => a - b);

  const sections: SongSection[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const notes = collapseReferencePitches(pitchFrames(buffer, start, end - start, 0.16));
    sections.push({
      id: 'section-' + index,
      label: 'Section ' + String(index + 1),
      kind: 'section',
      start,
      end,
      notes,
      activity: sectionActivity(buffer, start, end)
    });
    setAnalysisProgress(84 + ((index + 1) / Math.max(1, boundaries.length - 1)) * 12, 'Mapping sections and pitch…');
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }

  if (sections[0] && sections[0].activity < 0.28) {
    sections[0].kind = 'intro';
    sections[0].label = 'Intro';
  }
  if (sections.length > 1 && sections[sections.length - 1].activity < 0.25) {
    const last = sections[sections.length - 1];
    last.kind = 'outro';
    last.label = 'Outro';
  }

  let bestGroup: number[] = [];
  for (let i = 0; i < sections.length; i += 1) {
    if (sections[i].kind === 'intro' || sections[i].kind === 'outro') continue;
    const group = [i];
    for (let j = i + 1; j < sections.length; j += 1) {
      if (sections[j].kind === 'intro' || sections[j].kind === 'outro') continue;
      const durationRatio = Math.min(sections[i].end - sections[i].start, sections[j].end - sections[j].start) /
        Math.max(sections[i].end - sections[i].start, sections[j].end - sections[j].start);
      if (durationRatio > 0.68 && noteBigramSimilarity(sections[i].notes, sections[j].notes) >= 0.42) group.push(j);
    }
    if (group.length > bestGroup.length) bestGroup = group;
  }

  if (bestGroup.length >= 2) {
    bestGroup.forEach((sectionIndex, groupIndex) => {
      const section = sections[sectionIndex];
      section.kind = 'chorus';
      section.label = groupIndex === bestGroup.length - 1 && bestGroup.length > 2
        ? 'Final Chorus'
        : 'Chorus ' + String(groupIndex + 1);
    });
  }

  let verseNumber = 1;
  sections.forEach((section, index) => {
    if (section.kind !== 'section') return;
    const nextChorusIndex = sections.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.kind === 'chorus');
    const durationSeconds = section.end - section.start;
    if (nextChorusIndex === index + 1 && durationSeconds < 16) {
      section.kind = 'pre';
      section.label = 'Pre-Chorus';
    } else if (bestGroup.length >= 2 && index > bestGroup[0] && index < bestGroup[bestGroup.length - 1] && durationSeconds > 16 && index > sections.length * 0.55) {
      section.kind = 'bridge';
      section.label = 'Bridge';
    } else {
      section.kind = 'verse';
      section.label = 'Verse ' + String(verseNumber);
      verseNumber += 1;
    }
  });

  return sections;
}

function formatTime(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  return String(Math.floor(value / 60)) + ':' + String(value % 60).padStart(2, '0');
}

function selectedSections(): SongSection[] {
  return songSections.filter(section => selectedSectionIds.has(section.id));
}

function pitchBoundsText(bounds: PitchBounds): string {
  return midiToNote(frequencyToMidi(bounds.minHz)) + '–' + midiToNote(frequencyToMidi(bounds.maxHz));
}

function getActivePitchBounds(): PitchBounds {
  if (appMode === 'reference' && pitchRangeMode === 'song' && songPitchBounds) {
    return songPitchBounds;
  }
  return OPEN_VOCAL_BOUNDS;
}

function keyName(key: DetectedKey): string {
  return NOTE_NAMES[key.tonic] + ' ' + key.mode;
}

function scalePitchClasses(key: DetectedKey): number[] {
  const intervals = key.mode === 'major'
    ? [0, 2, 4, 5, 7, 9, 11]
    : [0, 2, 3, 5, 7, 8, 10];
  return intervals.map(interval => (key.tonic + interval) % 12);
}

function updatePitchRangeUi(): void {
  pitchRangeButtons.forEach(button => {
    button.classList.toggle('active', button.dataset.pitchRangeMode === pitchRangeMode);
  });

  songRangeLabelEl.textContent = songPitchBounds
    ? 'Song range: ' + pitchBoundsText(songPitchBounds)
    : 'Song range: analyzing…';

  if (!detectedSongKey) {
    keyGuideEl.textContent = 'Load a song to build its key guide.';
    return;
  }

  const scale = scalePitchClasses(detectedSongKey).map(pc => NOTE_NAMES[pc]);
  const third = scale[2];
  const fifth = scale[4];
  keyGuideEl.innerHTML =
    '<strong>' + keyName(detectedSongKey) + '</strong>' +
    '<span>Strong tones: ' + scale[0] + ' · ' + third + ' · ' + fifth + '</span>' +
    '<span>Scale: ' + scale.join(' · ') + '</span>';
}

function analyzeSongPitchProfile(buffer: AudioBuffer): {
  bounds: PitchBounds | null;
  key: DetectedKey | null;
} {
  const frames = pitchFrames(buffer, 0, buffer.duration, 0.14, OPEN_VOCAL_BOUNDS)
    .filter((value): value is number => value !== null);
  if (!frames.length) return { bounds: null, key: null };

  const counts = new Map<number, number>();
  const histogram = new Array<number>(12).fill(0);
  frames.forEach(value => {
    const rounded = Math.round(value);
    counts.set(rounded, (counts.get(rounded) ?? 0) + 1);
    histogram[((rounded % 12) + 12) % 12] += 1;
  });

  const supported = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([midi]) => midi)
    .sort((a, b) => a - b);
  const source = supported.length
    ? supported
    : frames.map(value => Math.round(value)).sort((a, b) => a - b);

  const openLowMidi = frequencyToMidi(OPEN_VOCAL_BOUNDS.minHz);
  const openHighMidi = frequencyToMidi(OPEN_VOCAL_BOUNDS.maxHz);
  const bounds: PitchBounds = {
    minHz: midiToFrequency(Math.max(openLowMidi, source[0] - 2)),
    maxHz: midiToFrequency(Math.min(openHighMidi, source[source.length - 1] + 2))
  };

  if (frames.length < 8) return { bounds, key: null };

  const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  const cosine = (a: number[], b: number[]): number => {
    let dot = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i < 12; i += 1) {
      dot += a[i] * b[i];
      aa += a[i] * a[i];
      bb += b[i] * b[i];
    }
    return dot / (Math.sqrt(aa * bb) + 1e-9);
  };

  let key: DetectedKey | null = null;
  for (let tonic = 0; tonic < 12; tonic += 1) {
    for (const mode of ['major', 'minor'] as const) {
      const profile = mode === 'major' ? majorProfile : minorProfile;
      const rotated = new Array<number>(12);
      for (let pc = 0; pc < 12; pc += 1) {
        rotated[pc] = profile[((pc - tonic) % 12 + 12) % 12];
      }
      const confidence = cosine(histogram, rotated);
      if (!key || confidence > key.confidence) key = { tonic, mode, confidence };
    }
  }

  return { bounds, key };
}

function syncSelectedNotes(): void {
  const sections = selectedSections();
  derivedReferenceNotes = sections.flatMap(section => section.notes).slice(0, 72);
  referenceSequenceEl.innerHTML = derivedReferenceNotes.length
    ? derivedReferenceNotes.map(note => '<span class="chip">' + note + '</span>').join('')
    : 'Select a section.';
  updateListeningContext();
}

function renderSongSections(): void {
  sectionChipsEl.innerHTML = songSections.map((section, index) => {
    const selected = selectedSectionIds.has(section.id) ? ' selected' : '';
    return '<button type="button" class="songSection' + selected + '" data-section-index="' + index + '">' +
      '<strong>' + section.label + '</strong><span>' + formatTime(section.start) + '–' + formatTime(section.end) + '</span></button>';
  }).join('');

  sectionChipsEl.querySelectorAll<HTMLButtonElement>('[data-section-index]').forEach(button => {
    button.addEventListener('click', event => {
      const index = Number(button.dataset.sectionIndex ?? -1);
      if (index < 0 || !songSections[index]) return;

      if ((event as MouseEvent).shiftKey && lastSectionIndex !== null) {
        const from = Math.min(lastSectionIndex, index);
        const to = Math.max(lastSectionIndex, index);
        for (let cursor = from; cursor <= to; cursor += 1) selectedSectionIds.add(songSections[cursor].id);
      } else {
        const id = songSections[index].id;
        if (selectedSectionIds.has(id)) selectedSectionIds.delete(id);
        else selectedSectionIds.add(id);
        lastSectionIndex = index;
      }

      renderSongSections();
      syncSelectedNotes();
    });
  });
}

function selectKinds(kinds: SectionKind[]): void {
  selectedSectionIds.clear();
  songSections.forEach(section => {
    if (kinds.includes(section.kind)) selectedSectionIds.add(section.id);
  });
  renderSongSections();
  syncSelectedNotes();
}

async function prepareSong(blob: Blob, filename: string): Promise<void> {
  setSourceUiState('processing');
  stopPracticePlayback(false);
  songWorkspaceEl.classList.add('hidden');
  reviewPanelEl.classList.add('hidden');
  selectedSectionIds.clear();
  songSections = [];
  derivedReferenceNotes = [];
  leadVocalBuffer = null;
  backingVocalBuffer = null;
  instrumentalBuffer = null;
  songPitchBounds = null;
  detectedSongKey = null;
  pitchRangeMode = 'song';
  updatePitchRangeUi();

  try {
    if (blob.size < 1024) throw new Error('The captured source did not contain enough audio data.');
    setAnalysisProgress(4, 'Reading source audio…');
    setReferenceStatus('Source captured. Preparing stems automatically…', 'PROCESSING');

    setAnalysisProgress(10, 'Uploading source for stem separation…');
    const sourceId = await uploadToLalal(blob, filename);
    setAnalysisProgress(17, 'Starting vocal / instrumental separation…');
    const taskId = await startLalalSplit(sourceId);
    const tracks = await waitForLalal(taskId);

    const lead = tracks.find(track => track.label === 'vocals@0') ?? tracks.find(track => track.label === 'vocals');
    const backing = tracks.find(track => track.label === 'vocals@1');
    const instrumental = tracks.find(track => track.label === 'no_vocals');

    if (!lead?.url || !instrumental?.url) throw new Error('The separated lead vocal or instrumental track is missing.');

    setAnalysisProgress(81, 'Loading separated tracks…');
    const [leadBuffer, instrumentalLoaded, backingBuffer] = await Promise.all([
      fetchTrackBuffer(lead.url),
      fetchTrackBuffer(instrumental.url),
      backing?.url ? fetchTrackBuffer(backing.url) : Promise.resolve(null)
    ]);
    leadVocalBuffer = leadBuffer;
    instrumentalBuffer = instrumentalLoaded;
    backingVocalBuffer = backingBuffer;

    setAnalysisProgress(82, 'Mapping vocal range and key…');
    const songProfile = analyzeSongPitchProfile(leadVocalBuffer);
    songPitchBounds = songProfile.bounds;
    detectedSongKey = songProfile.key;
    updatePitchRangeUi();

    songSections = await buildSongSections(leadVocalBuffer);
    if (!songSections.length) throw new Error('No usable song sections were detected.');

    const firstPractice = songSections.find(section => section.kind === 'chorus') ??
      songSections.find(section => section.kind !== 'intro' && section.kind !== 'outro') ??
      songSections[0];
    selectedSectionIds.add(firstPractice.id);
    lastSectionIndex = songSections.indexOf(firstPractice);

    renderSongSections();
    syncSelectedNotes();
    songWorkspaceEl.classList.remove('hidden');
    setAnalysisProgress(100, 'Song ready.');
    window.setTimeout(clearAnalysisProgress, 600);
    setReferenceStatus(
      'Ready. Lead vocal, backing vocals, and instrumental stay synchronized. Pick any sections and practice.',
      'READY'
    );
    setSourceUiState('idle');
  } catch (error) {
    clearAnalysisProgress();
    const message = error instanceof Error ? error.message : 'Song preparation failed.';
    const keyMissing = message.includes('LALAL_API_KEY');
    setReferenceStatus(
      keyMissing
        ? 'The app is ready for LALAL, but the private LALAL_API_KEY still needs to be added to Netlify.'
        : message,
      keyMissing ? 'LALAL KEY NEEDED' : 'PROCESSING ERROR'
    );
    setSourceUiState('idle');
  }
}

function setSourceUiState(state: SourceUiState): void {
  sourceUiState = state;
  referenceCardEl.dataset.captureState = state;

  const idle = state === 'idle';
  const recording = state === 'recording';

  recordSourceAudioButton.classList.toggle('hidden', recording || state === 'finalizing');
  recordSourceAudioButton.disabled = !idle;
  stopSourceAudioButton.classList.toggle('hidden', !recording);
  stopSourceAudioButton.disabled = !recording;
  referenceFileEl.disabled = !idle;
  sourceTimerEl.classList.toggle('recording', recording);

  if (state === 'requesting') {
    recordSourceAudioButton.classList.remove('hidden');
    recordSourceAudioButton.textContent = 'Choose source tab…';
  } else if (state === 'processing') {
    recordSourceAudioButton.classList.remove('hidden');
    recordSourceAudioButton.textContent = 'Analyzing source…';
  } else if (state === 'idle') {
    recordSourceAudioButton.textContent = 'Record browser tab';
  }
}

function updateSourceTimer(): void {
  const elapsed = Math.max(0, (performance.now() - sourceCaptureStartedAt) / 1000);
  sourceTimerEl.textContent = formatTime(elapsed);
}

async function cleanupSourceCapture(): Promise<void> {
  if (sourceTimerHandle !== null) {
    window.clearInterval(sourceTimerHandle);
    sourceTimerHandle = null;
  }

  if (sourceCaptureProcessor) {
    sourceCaptureProcessor.onaudioprocess = null;
    try { sourceCaptureProcessor.disconnect(); } catch { /* disconnected */ }
  }
  if (sourceCaptureSource) {
    try { sourceCaptureSource.disconnect(); } catch { /* disconnected */ }
  }
  if (sourceCaptureSink) {
    try { sourceCaptureSink.disconnect(); } catch { /* disconnected */ }
  }

  sourceCaptureStream?.getTracks().forEach(track => track.stop());
  sourceCaptureStream = null;
  sourceCaptureSource = null;
  sourceCaptureProcessor = null;
  sourceCaptureSink = null;

  const context = sourceCaptureContext;
  sourceCaptureContext = null;
  if (context && context.state !== 'closed') {
    await context.close().catch(() => undefined);
  }
}

async function finalizeSourceCapture(): Promise<void> {
  const chunks = sourcePcmChunks;
  const sampleRate = sourceCaptureSampleRate;
  sourcePcmChunks = [];

  await cleanupSourceCapture();

  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (sampleCount < Math.max(1, Math.floor(sampleRate * 0.25))) {
    setSourceUiState('idle');
    setReferenceStatus('No usable tab audio was captured. Make sure Share tab audio is enabled.', 'NO AUDIO');
    return;
  }

  const blob = pcmChunksToWave(chunks, sampleRate);
  await prepareSong(blob, 'recorded-source.wav');
}

function stopSourceCapture(): void {
  if (sourceUiState !== 'recording') return;
  setSourceUiState('finalizing');
  setReferenceStatus('Finalizing captured tab audio as WAV…', 'FINALIZING');
  void finalizeSourceCapture();
}

async function startSourceCapture(): Promise<void> {
  if (!navigator.mediaDevices?.getDisplayMedia || !('AudioContext' in window)) {
    setReferenceStatus('This browser cannot record tab audio.', 'UNSUPPORTED');
    return;
  }

  try {
    setSourceUiState('requesting');
    setReferenceStatus('Choose the source tab and enable Share tab audio.', 'CHOOSE TAB');

    const capture = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const audioTrack = capture.getAudioTracks()[0];
    if (!audioTrack) {
      capture.getTracks().forEach(track => track.stop());
      setSourceUiState('idle');
      setReferenceStatus('No tab audio was shared. Choose the source tab and enable Share tab audio.', 'NO AUDIO');
      return;
    }

    sourceCaptureStream = capture;
    sourceCaptureContext = new AudioContext();
    await sourceCaptureContext.resume();
    sourceCaptureSampleRate = sourceCaptureContext.sampleRate;
    sourcePcmChunks = [];

    const audioOnly = new MediaStream([audioTrack]);
    sourceCaptureSource = sourceCaptureContext.createMediaStreamSource(audioOnly);
    sourceCaptureProcessor = sourceCaptureContext.createScriptProcessor(4096, 2, 1);
    sourceCaptureSink = sourceCaptureContext.createGain();
    sourceCaptureSink.gain.value = 0;

    sourceCaptureProcessor.onaudioprocess = event => {
      if (sourceUiState !== 'recording') return;
      const input = event.inputBuffer;
      const channels = Math.max(1, input.numberOfChannels);
      const data = Array.from({ length: channels }, (_, channel) => input.getChannelData(channel));
      const mono = new Int16Array(input.length);

      for (let frame = 0; frame < input.length; frame += 1) {
        let sample = 0;
        for (let channel = 0; channel < channels; channel += 1) {
          sample += data[channel][frame] ?? 0;
        }
        sample /= channels;
        sample = Math.max(-1, Math.min(1, sample));
        mono[frame] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
      }
      sourcePcmChunks.push(mono);
    };

    sourceCaptureSource.connect(sourceCaptureProcessor);
    sourceCaptureProcessor.connect(sourceCaptureSink);
    sourceCaptureSink.connect(sourceCaptureContext.destination);

    audioTrack.addEventListener('ended', () => {
      if (sourceUiState === 'recording') stopSourceCapture();
    });

    sourceCaptureStartedAt = performance.now();
    sourceTimerEl.textContent = '0:00';
    sourceTimerHandle = window.setInterval(updateSourceTimer, 250);
    setSourceUiState('recording');
    setReferenceStatus('Recording tab audio. When you have what you want, press Stop & analyze.', 'RECORDING');
  } catch {
    sourcePcmChunks = [];
    await cleanupSourceCapture();
    setSourceUiState('idle');
    setReferenceStatus('Tab recording was cancelled or blocked.', 'CAPTURE CANCELLED');
  }
}

function scheduleBuffer(
  buffer: AudioBuffer | null,
  gain: GainNode,
  context: AudioContext,
  when: number,
  offset: number,
  duration: number
): void {
  if (!buffer || duration <= 0 || offset >= buffer.duration) return;
  const sourceNode = context.createBufferSource();
  sourceNode.buffer = buffer;
  sourceNode.connect(gain);
  const safeDuration = Math.min(duration, buffer.duration - offset);
  sourceNode.start(when, offset, safeDuration);
  practiceSources.push(sourceNode);
}

function stopPracticePlayback(stopRecorder = true): void {
  practiceSources.forEach(sourceNode => {
    try { sourceNode.stop(); } catch { /* already stopped */ }
  });
  practiceSources = [];
  if (practiceStopTimer !== null) {
    window.clearTimeout(practiceStopTimer);
    practiceStopTimer = null;
  }
  if (stopRecorder && takeRecorder?.state === 'recording') takeRecorder.stop();
  takeMicStream?.getTracks().forEach(track => track.stop());
  takeMicStream = null;
  practiceContext?.close().catch(() => undefined);
  practiceContext = null;
  practiceArtistGain = null;
  practiceBackingVocalGain = null;
  practiceInstrumentalGain = null;
  playSelectionButton.disabled = false;
  recordTakeButton.disabled = false;
  stopPracticeButton.disabled = true;
}

function applyStemLevels(): void {
  if (practiceArtistGain) practiceArtistGain.gain.value = artistLevel;
  if (practiceBackingVocalGain) practiceBackingVocalGain.gain.value = Number(backingVocalLevelEl.value) / 100;
  if (practiceInstrumentalGain) practiceInstrumentalGain.gain.value = Number(instrumentalLevelEl.value) / 100;
  backingVocalLevelValueEl.textContent = backingVocalLevelEl.value + '%';
  instrumentalLevelValueEl.textContent = instrumentalLevelEl.value + '%';
  artistPresetButtons.forEach(button => {
    button.classList.toggle('active', Number(button.dataset.artistLevel ?? 0) === Math.round(artistLevel * 100));
  });
}

async function startSelection(recordUser: boolean): Promise<void> {
  const sections = selectedSections();
  if (!leadVocalBuffer || !instrumentalBuffer || sections.length === 0) {
    takeStatusEl.textContent = 'Select at least one prepared section first.';
    return;
  }

  stopPracticePlayback(false);
  reviewPanelEl.classList.add('hidden');

  try {
    if (recordUser) {
      takeMicStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        video: false
      });
      const mimeType = getRecorderMimeType();
      takeRecorder = mimeType ? new MediaRecorder(takeMicStream, { mimeType }) : new MediaRecorder(takeMicStream);
      takeChunks = [];
      takeRecorder.addEventListener('dataavailable', event => {
        if (event.data.size > 0) takeChunks.push(event.data);
      });
      takeRecorder.addEventListener('stop', () => {
        const type = takeRecorder?.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(takeChunks, { type });
        takeChunks = [];
        if (blob.size > 0) void analyzeTake(blob);
      });
    }

    const context = new AudioContext();
    await context.resume();
    practiceContext = context;
    const artistGain = context.createGain();
    const backingGain = context.createGain();
    const instrumentalGain = context.createGain();
    artistGain.connect(context.destination);
    backingGain.connect(context.destination);
    instrumentalGain.connect(context.destination);
    practiceArtistGain = artistGain;
    practiceBackingVocalGain = backingGain;
    practiceInstrumentalGain = instrumentalGain;
    applyStemLevels();

    const repetitions = Math.max(1, Number(loopCountEl.value) || 1);
    const leadIn = recordUser ? 0.2 : 0.06;
    takeLeadInSeconds = leadIn;
    practiceSegments = [];
    let cursor = context.currentTime + leadIn;
    let relativeCursor = 0;

    if (recordUser && takeRecorder) takeRecorder.start(250);

    for (let repeat = 0; repeat < repetitions; repeat += 1) {
      for (const section of sections) {
        const duration = Math.max(0, section.end - section.start);
        scheduleBuffer(leadVocalBuffer, artistGain, context, cursor, section.start, duration);
        scheduleBuffer(backingVocalBuffer, backingGain, context, cursor, section.start, duration);
        scheduleBuffer(instrumentalBuffer, instrumentalGain, context, cursor, section.start, duration);
        practiceSegments.push({ sourceStart: section.start, duration, label: section.label });
        cursor += duration;
        relativeCursor += duration;
      }
    }

    takeTotalDuration = relativeCursor;
    derivedReferenceNotes = practiceSegments.flatMap(segment => {
      const section = songSections.find(item => Math.abs(item.start - segment.sourceStart) < 0.01);
      return section?.notes ?? [];
    }).slice(0, 72);
    updateListeningContext();

    playSelectionButton.disabled = true;
    recordTakeButton.disabled = true;
    stopPracticeButton.disabled = false;
    takeStatusEl.textContent = recordUser
      ? 'Recording your microphone separately. You are hearing the synchronized artist + backing tracks.'
      : 'Playing selected sections.';

    practiceStopTimer = window.setTimeout(() => {
      stopPracticePlayback(recordUser);
      takeStatusEl.textContent = recordUser ? 'Take complete. Analyzing your vocal…' : 'Playback complete.';
    }, Math.ceil((leadIn + relativeCursor + 0.15) * 1000));
  } catch (error) {
    stopPracticePlayback(false);
    takeStatusEl.textContent = error instanceof Error ? error.message : 'Could not start practice.';
  }
}

function concatenateArtistPitch(stepSeconds: number): Array<number | null> {
  if (!leadVocalBuffer) return [];
  return practiceSegments.flatMap(segment => pitchFrames(leadVocalBuffer!, segment.sourceStart, segment.duration, stepSeconds));
}

function rmsSequence(buffer: AudioBuffer, startSeconds: number, durationSeconds: number, stepSeconds: number): number[] {
  const frameSamples = Math.max(1, Math.floor(buffer.sampleRate * stepSeconds));
  const start = Math.max(0, Math.floor(startSeconds * buffer.sampleRate));
  const end = Math.min(buffer.length, Math.floor((startSeconds + durationSeconds) * buffer.sampleRate));
  const values: number[] = [];
  for (let position = start; position < end; position += frameSamples) values.push(rmsFrame(buffer, position, frameSamples));
  return values;
}

function concatenateArtistRms(stepSeconds: number): number[] {
  if (!leadVocalBuffer) return [];
  return practiceSegments.flatMap(segment => rmsSequence(leadVocalBuffer!, segment.sourceStart, segment.duration, stepSeconds));
}

function correlation(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length < 3) return 0;
  const aa = a.slice(0, length);
  const bb = b.slice(0, length);
  const meanA = aa.reduce((sum, value) => sum + value, 0) / length;
  const meanB = bb.reduce((sum, value) => sum + value, 0) / length;
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (let index = 0; index < length; index += 1) {
    const da = aa[index] - meanA;
    const db = bb[index] - meanB;
    numerator += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  const denom = Math.sqrt(denomA * denomB);
  return denom ? numerator / denom : 0;
}

function bestTimingOffset(artist: Array<number | null>, user: Array<number | null>, stepSeconds: number): number {
  let bestLag = 0;
  let bestScore = -1;
  for (let lag = -5; lag <= 5; lag += 1) {
    let matches = 0;
    let count = 0;
    for (let index = 0; index < artist.length; index += 1) {
      const userIndex = index + lag;
      if (userIndex < 0 || userIndex >= user.length) continue;
      const artistVoiced = artist[index] !== null;
      const userVoiced = user[userIndex] !== null;
      if (artistVoiced === userVoiced) matches += 1;
      count += 1;
    }
    const score = count ? matches / count : 0;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return bestLag * stepSeconds * 1000;
}

async function analyzeTake(blob: Blob): Promise<void> {
  try {
    const userBuffer = await decodeReferenceBytes(await blob.arrayBuffer());
    const stepSeconds = 0.12;
    const artistPitch = concatenateArtistPitch(stepSeconds);
    const userPitch = pitchFrames(userBuffer, takeLeadInSeconds, takeTotalDuration, stepSeconds);
    const pitchErrors: number[] = [];
    const artistMotion: number[] = [];
    const userMotion: number[] = [];

    const length = Math.min(artistPitch.length, userPitch.length);
    for (let index = 0; index < length; index += 1) {
      const artistMidi = artistPitch[index];
      const userMidi = userPitch[index];
      if (artistMidi !== null && userMidi !== null) pitchErrors.push(Math.abs((userMidi - artistMidi) * 100));
      if (index > 0) {
        const previousArtist = artistPitch[index - 1];
        const previousUser = userPitch[index - 1];
        if (artistMidi !== null && userMidi !== null && previousArtist !== null && previousUser !== null) {
          artistMotion.push(artistMidi - previousArtist);
          userMotion.push(userMidi - previousUser);
        }
      }
    }

    const within25 = pitchErrors.length
      ? pitchErrors.filter(value => value <= 25).length / pitchErrors.length * 100
      : 0;
    const medianError = pitchErrors.length ? median(pitchErrors) : 0;
    const timingMs = bestTimingOffset(artistPitch, userPitch, stepSeconds);
    const artistRms = concatenateArtistRms(stepSeconds);
    const userRms = rmsSequence(userBuffer, takeLeadInSeconds, takeTotalDuration, stepSeconds);
    const energyMatch = Math.max(0, correlation(artistRms, userRms)) * 100;
    const motionMatch = Math.max(0, correlation(artistMotion, userMotion)) * 100;

    const timingText = Math.abs(timingMs) < 45
      ? 'centered'
      : Math.abs(timingMs).toFixed(0) + ' ms ' + (timingMs > 0 ? 'late' : 'early');

    reviewSummaryEl.textContent = within25.toFixed(0) + '% of voiced frames within ±25¢';
    reviewDetailsEl.innerHTML =
      '<div><span>Pitch center</span><strong>' + medianError.toFixed(0) + '¢ median error</strong></div>' +
      '<div><span>Timing</span><strong>' + timingText + '</strong></div>' +
      '<div><span>Dynamics / breath energy</span><strong>' + energyMatch.toFixed(0) + '% contour match</strong></div>' +
      '<div><span>Slides / vibrato movement</span><strong>' + motionMatch.toFixed(0) + '% contour match</strong></div>';
    reviewPanelEl.classList.remove('hidden');
    takeStatusEl.textContent = 'Review ready. Artist and your microphone were analyzed as separate tracks.';
  } catch {
    takeStatusEl.textContent = 'The take recorded, but this browser could not decode it for review.';
  }
}

function noteToMidi(note: string): number | null {
  const match = note
    .trim()
    .toUpperCase()
    .match(/^([A-G])([#B]?)(-?\\d)$/);
  if (!match) return null;

  const naturalMap: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  let pitchClass = naturalMap[match[1]];
  if (match[2] === '#') pitchClass += 1;
  if (match[2] === 'B') pitchClass -= 1;
  return (Number(match[3]) + 1) * 12 + pitchClass;
}

function midiToNote(midi: number): string {
  const rounded = Math.round(midi);
  const octave = Math.floor(rounded / 12) - 1;
  const pitchClass = ((rounded % 12) + 12) % 12;
  return NOTE_NAMES[pitchClass] + octave;
}

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

function centsBetween(frequency: number, targetFrequency: number): number {
  return 1200 * Math.log2(frequency / targetFrequency);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[middle - 1] + sorted[middle]) / 2;
  return sorted[middle];
}

function getSequence(): string[] {
  return sequenceTextEl.value
    .split(/(?:→|,|\\s)+/)
    .map(item => item.trim())
    .filter(item => item.length > 0 && noteToMidi(item) !== null);
}

function getActiveTarget(): string {
  const sequence = getSequence();

  if (cruiseOn && sequence.length > 0) {
    return sequence[Math.min(sequenceIndex, sequence.length - 1)];
  }

  if (appMode === 'phrase' && phraseNotes.length > 0) {
    const phraseIndex = cadencePlaying
      ? cadenceIndex
      : selectedPhraseIndex;
    return phraseNotes[Math.min(phraseIndex, phraseNotes.length - 1)];
  }

  if (appMode === 'reference' && derivedReferenceNotes.length > 0) {
    return derivedReferenceNotes[0];
  }

  return targetNoteEl.value + targetOctaveEl.value;
}

function canListenInCurrentMode(): boolean {
  if (appMode === 'single') return true;
  if (appMode === 'phrase') return phraseWords.length > 0 && phraseNotes.length > 0;
  return derivedReferenceNotes.length > 0;
}

function getPhraseLine(): string {
  return phraseWords.join(' ').trim();
}

function updateListeningContext(): void {
  const target = getActiveTarget();
  activeTargetEl.textContent = target;

  if (appMode === 'single') {
    listeningModeLabelEl.textContent = cruiseOn ? 'SEQUENCE' : 'SINGLE NOTE';
    listeningForTextEl.textContent = cruiseOn
      ? getSequence().join(' → ')
      : target;
    listeningDetailEl.textContent = cruiseOn
      ? 'Current target: ' + target + '. Hold it inside the lock window to advance.'
      : 'The tuner is grading one pitch only: ' + target + '.';
  } else if (appMode === 'phrase') {
    listeningModeLabelEl.textContent = 'PHRASE';
    const line = getPhraseLine();
    if (!line || phraseNotes.length === 0) {
      listeningForTextEl.textContent = 'No phrase loaded';
      listeningDetailEl.textContent = 'Enter matching lyric units and target notes.';
    } else {
      const index = cadencePlaying
        ? Math.min(cadenceIndex, phraseWords.length - 1)
        : phraseMode
          ? Math.min(sequenceIndex, phraseWords.length - 1)
          : Math.min(selectedPhraseIndex, phraseWords.length - 1);
      const word = phraseWords[index] ?? '';
      const note = phraseNotes[index] ?? target;
      listeningForTextEl.textContent = line;
      listeningDetailEl.textContent =
        'Current unit: ' + word + ' · target ' + note +
        '. Tap another lyric unit to practice that part.';
    }
  } else {
    listeningModeLabelEl.textContent = 'MATCH RECORDING';
    if (derivedReferenceNotes.length === 0) {
      listeningForTextEl.textContent = 'No pitch target yet';
      listeningDetailEl.textContent =
        'Add a song in Match. Pitch Cruzer prepares stems and section targets automatically.';
    } else {
      listeningForTextEl.textContent = derivedReferenceNotes.join(' → ');
      listeningDetailEl.textContent =
        'Selected song sections are ready. Current pitch target: ' + target + '.';
    }
  }

  const canListen = canListenInCurrentMode();
  micButton.disabled = !canListen;
  if (!micOn) {
    micButton.textContent = canListen ? 'Start listening' : 'Load a target first';
  }
}

function applyModeVisibility(): void {
  shellEl.classList.remove('mode-single', 'mode-phrase', 'mode-reference');
  shellEl.classList.add('mode-' + appMode);
  shellEl.classList.toggle('advanced-open', advancedControls);

  phraseCardEl.classList.toggle('hidden', appMode !== 'phrase');
  referenceCardEl.classList.toggle('hidden', appMode !== 'reference');

  singleTargetPanelEl.classList.toggle('hidden', appMode !== 'single');
  cruisePanelEl.classList.toggle(
    'hidden',
    !(advancedControls && appMode === 'single')
  );
  accuracyPanelEl.classList.toggle('hidden', !advancedControls);

  const controlsVisible =
    appMode === 'single' || advancedControls;
  controlsGridEl.classList.toggle('hidden', !controlsVisible);

  modeButtons.forEach(button => {
    button.classList.toggle('active', button.dataset.appMode === appMode);
  });

  const modeNames: Record<AppMode, string> = {
    single: 'Single note',
    phrase: 'Phrase',
    reference: 'Match recording'
  };
  topModeStatusEl.textContent = modeNames[appMode];
  advancedToggleButton.classList.toggle('active', advancedControls);
  advancedToggleButton.textContent = advancedControls
    ? 'Hide tools'
    : 'Tuner tools';

  updateListeningContext();
}

function setAppMode(mode: AppMode): void {
  if (micOn) stopMic();
  if (cadencePlaying) stopCadence(false);
  appMode = mode;
  cruiseOn = false;
  phraseMode = false;
  sequenceIndex = 0;
  lockStart = null;
  trace = [];
  traceLineEl.setAttribute('points', '');
  setHoldProgress(0);
  applyModeVisibility();
  if (mode === 'reference') void checkLalalConnection();
  if (mode === 'phrase') window.requestAnimationFrame(syncPhraseFromInputs);
}

function getTargetFrequency(): number {
  return midiToFrequency(noteToMidi(getActiveTarget()) ?? noteToMidi('G2')!);
}

function estimatePitch(
  buffer: Float32Array,
  sampleRate: number,
  bounds: PitchBounds = OPEN_VOCAL_BOUNDS
): { frequency: number; clarity: number } | null {
  let mean = 0;
  for (let i = 0; i < buffer.length; i += 1) mean += buffer[i];
  mean /= buffer.length;

  const centered = new Float32Array(buffer.length);
  let rms = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const value = buffer[i] - mean;
    centered[i] = value;
    rms += value * value;
  }
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.008) return null;

  const minHz = Math.max(20, bounds.minHz);
  const maxHz = Math.min(sampleRate / 4, Math.max(minHz + 1, bounds.maxHz));
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(
    Math.floor(sampleRate / minHz),
    Math.floor(centered.length / 2)
  );
  const correlations = new Float32Array(maxLag + 1);
  let bestLag = -1;
  let bestCorrelation = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let numerator = 0;
    let energyA = 0;
    let energyB = 0;
    const limit = centered.length - lag;

    for (let i = 0; i < limit; i += 2) {
      const a = centered[i];
      const b = centered[i + lag];
      numerator += a * b;
      energyA += a * a;
      energyB += b * b;
    }

    const correlation = numerator / (Math.sqrt(energyA * energyB) + 1e-9);
    correlations[lag] = correlation;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestLag < 0 || bestCorrelation < 0.58) return null;

  let chosenLag = bestLag;
  let chosenCorrelation = bestCorrelation;

  for (const multiple of [2, 3]) {
    const candidate = bestLag * multiple;
    if (candidate > maxLag) continue;

    let localLag = candidate;
    let localCorrelation = correlations[candidate];
    const start = Math.max(minLag, candidate - 3);
    const end = Math.min(maxLag, candidate + 3);

    for (let lag = start; lag <= end; lag += 1) {
      if (correlations[lag] > localCorrelation) {
        localCorrelation = correlations[lag];
        localLag = lag;
      }
    }

    if (localCorrelation >= bestCorrelation * 0.86 && localCorrelation > 0.56) {
      chosenLag = localLag;
      chosenCorrelation = localCorrelation;
    }
  }

  let refinedLag = chosenLag;
  if (chosenLag > minLag && chosenLag < maxLag) {
    const left = correlations[chosenLag - 1];
    const center = correlations[chosenLag];
    const right = correlations[chosenLag + 1];
    const denominator = left - 2 * center + right;
    if (Math.abs(denominator) > 1e-6)
      refinedLag += (0.5 * (left - right)) / denominator;
  }

  const frequency = sampleRate / refinedLag;
  if (!Number.isFinite(frequency) || frequency < minHz || frequency > maxHz)
    return null;
  return { frequency, clarity: chosenCorrelation };
}

function renderPhraseCoach(): void {
  shellEl.classList.toggle('phrase-practicing', appMode === 'phrase' && phraseMode);

  if (phraseWords.length === 0) {
    phraseNowEl.classList.add('hidden');
    phraseUnitsEl.classList.add('hidden');
    vowelCoachEl.classList.add('hidden');
    return;
  }

  const currentIndex = phraseMode
    ? Math.min(sequenceIndex, phraseWords.length - 1)
    : cadencePlaying
      ? Math.min(cadenceIndex, phraseWords.length - 1)
      : Math.min(selectedPhraseIndex, phraseWords.length - 1);

  phraseUnitsEl.classList.remove('emptyPhrase', 'hidden');
  phraseUnitsEl.innerHTML = phraseWords.map((word, index) => {
    const note = phraseNotes[index] ?? '—';
    const canPlay = noteToMidi(note) !== null;
    const vowel = phraseVowels[index] ?? inferVowel(word);
    const classes = [
      'phraseUnit',
      index === currentIndex ? 'currentPhraseUnit' : '',
      phraseMode && index < sequenceIndex
        ? 'donePhraseUnit'
        : cadencePlaying && index < cadenceIndex
          ? 'donePhraseUnit'
          : ''
    ].filter(Boolean).join(' ');

    const options = VOWEL_KEYS.map(key =>
      '<option value="' + key + '"' + (key === vowel ? ' selected' : '') + '>' + key + '</option>'
    ).join('');

    return '<div class="' + classes + '" data-phrase-index="' + index + '">' +
      '<button type="button" class="phraseUnitTarget" data-select-index="' + index + '" aria-label="Select ' + word + ', target ' + note + '">' +
        '<span class="phraseUnitWord">' + word + '</span>' +
        '<span class="phraseUnitNote">' + note + '</span>' +
      '</button>' +
      '<button type="button" class="unitToneButton" data-tone-index="' + index + '"' +
        (canPlay ? '' : ' disabled') +
        ' aria-label="Hear ' + note + ' for ' + word + '">▶ Hear ' + note + '</button>' +
      '<select class="vowelSelect" data-vowel-index="' + index + '" aria-label="Vowel for ' + word + '">' + options + '</select>' +
    '</div>';
  }).join('');

  const word = phraseWords[currentIndex] ?? '';
  const vowelKey = phraseVowels[currentIndex] ?? inferVowel(word);
  const profile = VOWEL_PROFILES[vowelKey] ?? VOWEL_PROFILES.UH;

  vowelCoachEl.classList.remove('hidden');
  coachVowelEl.textContent = profile.label;
  mouthCueEl.textContent = profile.mouth;
  resonanceCueEl.textContent = profile.resonance;
  phraseNowEl.classList.add('hidden');

  phraseUnitsEl.querySelectorAll<HTMLButtonElement>('.phraseUnitTarget').forEach(button => {
    button.addEventListener('click', () => {
      selectedPhraseIndex = Number(button.dataset.selectIndex ?? 0);
      renderPhraseCoach();
      updateListeningContext();
    });
  });

  phraseUnitsEl.querySelectorAll<HTMLSelectElement>('.vowelSelect').forEach(select => {
    select.addEventListener('click', event => event.stopPropagation());
    select.addEventListener('change', event => {
      event.stopPropagation();
      const index = Number(select.dataset.vowelIndex ?? 0);
      phraseVowels[index] = select.value;
      selectedPhraseIndex = index;
      renderPhraseCoach();
      updateListeningContext();
    });
  });
}

function syncPhraseFromInputs(): void {
  if (cadencePlaying) stopCadence(false);
  phraseMode = false;
  cruiseOn = false;
  shellEl.classList.remove('phrase-practicing');
  practicePhraseButton.textContent = 'Start practice';

  const words = splitPhraseUnits(lyricsTextEl.value);
  const notes = parseNoteList(phraseNotesEl.value);
  phraseWarningEl.classList.add('hidden');
  phraseWarningEl.textContent = '';

  phraseWords = words;
  phraseNotes = notes;
  phraseVowels = words.map((word, index) => phraseVowels[index] ?? inferVowel(word));
  selectedPhraseIndex = Math.min(selectedPhraseIndex, Math.max(0, words.length - 1));

  const hasBoth = words.length > 0 && notes.length > 0;
  const countsMatch = hasBoth && words.length === notes.length;
  const ready = countsMatch;

  practicePhraseButton.disabled = !ready;
  startCadenceButton.disabled = !ready;
  shellEl.classList.toggle('phrase-ready', ready);
  cadenceStatusEl.textContent = '';

  if (words.length === 0 && notes.length === 0) {
    phraseBuildStateEl.textContent = 'Add lyrics and target notes.';
  } else if (!hasBoth) {
    phraseBuildStateEl.textContent = words.length === 0
      ? 'Add the lyric / syllable line.'
      : 'Add the target-note line.';
  } else if (!countsMatch) {
    phraseBuildStateEl.textContent = words.length + ' lyric units · ' + notes.length + ' notes';
    phraseWarningEl.textContent =
      'Make the counts match. Use | to split lyric syllables exactly.';
    phraseWarningEl.classList.remove('hidden');
  } else {
    phraseBuildStateEl.textContent =
      words.length + ' units ready · play any target or start practice.';
  }

  renderPhraseCoach();
  updateListeningContext();
}

function getAttackSyllable(unit: string): string {
  const hyphenPart = unit.split(/[-–—]/)[0]?.trim();
  if (hyphenPart && hyphenPart !== unit.trim()) return hyphenPart;

  const clean = unit.toLowerCase().replace(/[^a-z']/g, '');
  if (!clean) return unit;

  const match = clean.match(/^([^aeiouy]*[aeiouy]+(?:[^aeiouy](?![aeiouy])){0,2})/);
  return match?.[1] ?? clean;
}

async function getCueContext(): Promise<AudioContext> {
  if (!cueAudioContext || cueAudioContext.state === 'closed') {
    cueAudioContext = new AudioContext();
  }
  await cueAudioContext.resume();
  return cueAudioContext;
}

async function playNoteTone(note: string, durationMs = 900): Promise<void> {
  const midi = noteToMidi(note);
  if (midi === null) return;

  const context = await getCueContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = midiToFrequency(midi);

  const now = context.currentTime;
  const duration = Math.max(0.12, Math.min(1.2, durationMs / 1000));
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
  gain.gain.setValueAtTime(0.18, now + Math.max(0.04, duration - 0.08));
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.03);
}

async function playCadenceTone(note: string, durationMs: number): Promise<void> {
  await playNoteTone(note, Math.max(120, durationMs * 0.58));
}

async function playCountInClick(accent: boolean): Promise<void> {
  const context = await getCueContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;

  oscillator.type = 'sine';
  oscillator.frequency.value = accent ? 1320 : 880;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.09);
}

function speakCadenceUnit(unit: string, note: string): void {
  if (!('speechSynthesis' in window)) return;

  const text = cadenceSpeechModeEl.value === 'attack'
    ? getAttackSyllable(unit)
    : unit;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.22;
  utterance.volume = 0.78;

  const midi = noteToMidi(note);
  if (midi !== null) {
    utterance.pitch = Math.max(0.55, Math.min(1.8, Math.pow(2, (midi - 60) / 24)));
  }

  window.speechSynthesis.speak(utterance);
}

function stopCadence(resetDisplay = true): void {
  cadenceTimers.forEach(timer => window.clearTimeout(timer));
  cadenceTimers = [];
  cadencePlaying = false;
  window.speechSynthesis?.cancel();
  startCadenceButton.disabled = false;
  stopCadenceButton.disabled = true;
  cadenceStatusEl.textContent = 'Cadence cues stopped.';

  if (resetDisplay) {
    selectedPhraseIndex = Math.min(cadenceIndex, Math.max(0, phraseWords.length - 1));
    activeTargetEl.textContent = getActiveTarget();
    renderPhraseCoach();
  }
}

function finishCadence(): void {
  cadenceTimers = [];
  cadencePlaying = false;
  startCadenceButton.disabled = false;
  stopCadenceButton.disabled = true;
  cadenceStatusEl.textContent = 'Phrase complete.';
  selectedPhraseIndex = Math.min(cadenceIndex, Math.max(0, phraseWords.length - 1));
  activeTargetEl.textContent = getActiveTarget();
  renderPhraseCoach();
}

function startCadence(): void {
  if (
    phraseWords.length === 0 ||
    phraseNotes.length === 0 ||
    phraseWords.length !== phraseNotes.length
  ) return;

  stopCadence(false);
  cruiseOn = false;
  phraseMode = false;
  sequenceIndex = 0;
  cadencePlaying = true;
  cadenceIndex = 0;
  startCadenceButton.disabled = true;
  stopCadenceButton.disabled = false;

  const bpm = Math.max(40, Math.min(220, Number(cadenceBpmEl.value) || 84));
  const beatMs = 60000 / bpm;
  const countIn = Math.max(0, Number(cadenceCountInEl.value) || 0);
  const beatsPerUnit = Math.max(0.5, Number(cadenceBeatsEl.value) || 1);
  const unitMs = beatMs * beatsPerUnit;
  const mode = cadenceModeEl.value;
  const phraseLength = Math.min(phraseWords.length, phraseNotes.length);

  cadenceStatusEl.textContent =
    'Count-in ' + countIn + ' · ' + bpm + ' BPM · ' + beatsPerUnit + ' beat' +
    (beatsPerUnit === 1 ? '' : 's') + ' per unit';

  for (let beat = 0; beat < countIn; beat += 1) {
    const timer = window.setTimeout(() => {
      void playCountInClick(beat === countIn - 1);
    }, beat * beatMs);
    cadenceTimers.push(timer);
  }

  const phraseStart = countIn * beatMs;
  for (let index = 0; index < phraseLength; index += 1) {
    const timer = window.setTimeout(() => {
      if (!cadencePlaying) return;
      cadenceIndex = index;
      selectedPhraseIndex = index;
      const word = phraseWords[index];
      const note = phraseNotes[index];
      activeTargetEl.textContent = note;
      renderPhraseCoach();

      if (mode === 'tone' || mode === 'both') void playCadenceTone(note, unitMs);
      if (mode === 'speak' || mode === 'both') speakCadenceUnit(word, note);

      cadenceStatusEl.textContent =
        'Cue ' + String(index + 1) + '/' + String(phraseLength) +
        ' · ' + word + ' · ' + note;
    }, phraseStart + index * unitMs);
    cadenceTimers.push(timer);
  }

  const finishTimer = window.setTimeout(
    finishCadence,
    phraseStart + phraseLength * unitMs + 80
  );
  cadenceTimers.push(finishTimer);
  renderPhraseCoach();
}

function renderSequence(): void {
  const sequence = getSequence();
  sequenceChipsEl.innerHTML = sequence
    .map((note, index) => {
      let className = 'chip';
      if (cruiseOn && index === sequenceIndex) className += ' current';
      if (index < sequenceIndex) className += ' done';
      return '<span class="' + className + '">' + note + '</span>';
    })
    .join('');

  stepBadgeEl.textContent =
    sequence.length === 0
      ? '0/0'
      : String(Math.min(sequenceIndex + 1, sequence.length)) +
        '/' +
        String(sequence.length);

  activeTargetEl.textContent = getActiveTarget();
  updateListeningContext();
  targetNoteEl.disabled = cruiseOn;
  targetOctaveEl.disabled = cruiseOn;
  sequenceTextEl.disabled = cruiseOn;
  startCruiseButton.disabled = cruiseOn || sequence.length === 0;
  renderPhraseCoach();
}

function setHoldProgress(progress: number): void {
  const clamped = Math.max(0, Math.min(100, progress));
  holdPercentEl.textContent = String(Math.round(clamped)) + '%';
  progressFillEl.style.width = String(clamped) + '%';
}

function setNoPitch(): void {
  detectedNoteEl.textContent = '--';
  frequencyEl.textContent = '— Hz';
  centsEl.textContent = '—';
  statusEl.textContent = micOn ? 'LISTENING' : 'MIC OFF';
  statusEl.className = 'status status-listening';
  needleEl.style.left = '50%';
  lockStart = null;
  setHoldProgress(0);
}

function renderPitch(frequency: number, timestamp: number): void {
  const targetFrequency = getTargetFrequency();
  const cents = centsBetween(frequency, targetFrequency);
  const tolerance = Number(lockedSlider.value);
  const closeTolerance = Number(closeSlider.value);
  const holdMs = Number(holdSlider.value);
  const absolute = Math.abs(cents);

  detectedNoteEl.textContent = midiToNote(frequencyToMidi(frequency));
  frequencyEl.textContent = frequency.toFixed(1) + ' Hz';
  centsEl.textContent =
    (cents > 0 ? '+' : '') + String(Math.round(cents)) + '¢';

  let status = 'SHARP';
  if (absolute <= tolerance) status = 'LOCKED';
  else if (absolute <= closeTolerance) status = 'CLOSE';
  else if (cents < 0) status = 'FLAT';

  statusEl.textContent = status;
  statusEl.className = 'status status-' + status.toLowerCase();

  const needle = Math.max(2, Math.min(98, 50 + (cents / 50) * 48));
  needleEl.style.left = String(needle) + '%';

  trace.push(Math.max(-60, Math.min(60, cents)));
  if (trace.length > 80) trace = trace.slice(-80);
  traceLineEl.setAttribute(
    'points',
    trace
      .map((value, index) => {
        const x = trace.length < 2 ? 50 : (index / (trace.length - 1)) * 100;
        const y = 50 - (value / 60) * 44;
        return x.toFixed(2) + ',' + y.toFixed(2);
      })
      .join(' ')
  );

  if (absolute <= tolerance) {
    if (lockStart === null) lockStart = timestamp;
    const progress = Math.min(100, ((timestamp - lockStart) / holdMs) * 100);
    setHoldProgress(progress);

    if (progress >= 100 && cruiseOn) {
      const sequence = getSequence();
      lockStart = null;
      setHoldProgress(0);

      if (sequenceIndex >= sequence.length - 1) {
        cruiseOn = false;
      } else {
        sequenceIndex += 1;
      }

      trace = [];
      traceLineEl.setAttribute('points', '');
      renderSequence();
    }
  } else {
    lockStart = null;
    setHoldProgress(0);
  }
}

function processAudio(timestamp: number): void {
  frameId = requestAnimationFrame(processAudio);
  if (timestamp - lastProcess < 60) return;
  lastProcess = timestamp;

  if (!analyser || !audioContext) return;

  const buffer = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buffer);
  const activeBounds = getActivePitchBounds();
  const result = estimatePitch(buffer, audioContext.sampleRate, activeBounds);

  if (!result) {
    recentFrequencies = [];
    setNoPitch();
    return;
  }

  let candidate = result.frequency;
  const previous = previousStableFrequency;
  const targetFrequency = getTargetFrequency();

  if (previous) {
    const ratio = candidate / previous;

    if (ratio > 1.88 && ratio < 2.12 && candidate / 2 >= activeBounds.minHz) {
      candidate /= 2;
    } else if (ratio > 0.47 && ratio < 0.53 && candidate * 2 <= activeBounds.maxHz) {
      const currentDistance = Math.abs(
        centsBetween(candidate, targetFrequency)
      );
      const doubledDistance = Math.abs(
        centsBetween(candidate * 2, targetFrequency)
      );
      if (doubledDistance + 18 < currentDistance) candidate *= 2;
    }
  }

  recentFrequencies.push(candidate);
  if (recentFrequencies.length > 5) recentFrequencies.shift();
  const smoothed = median(recentFrequencies);
  previousStableFrequency = smoothed;
  renderPitch(smoothed, timestamp);
}

async function startMic(): Promise<void> {
  errorBannerEl.classList.add('hidden');

  if (!canListenInCurrentMode()) {
    updateListeningContext();
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    });

    audioContext = new AudioContext();
    await audioContext.resume();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    micOn = true;
    micButton.textContent = 'Stop listening';
    micButton.classList.add('active');
    setNoPitch();
    updateListeningContext();
    frameId = requestAnimationFrame(processAudio);
  } catch {
    errorBannerEl.textContent =
      'Microphone access is required. Allow mic access, then tap Start Mic again.';
    errorBannerEl.classList.remove('hidden');
    stopMic();
  }
}

function stopMic(): void {
  if (frameId !== null) cancelAnimationFrame(frameId);
  frameId = null;
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  source?.disconnect();
  source = null;
  analyser?.disconnect();
  analyser = null;
  audioContext?.close().catch(() => undefined);
  audioContext = null;
  micOn = false;
  micButton.classList.remove('active');
  recentFrequencies = [];
  previousStableFrequency = null;
  setNoPitch();
  updateListeningContext();
}

async function playTarget(): Promise<void> {
  await playNoteTone(getActiveTarget(), 900);
}

micButton.addEventListener('click', () => {
  if (micOn) stopMic();
  else void startMic();
});

playToneButton.addEventListener('click', () => void playTarget());

targetNoteEl.addEventListener('change', () => {
  trace = [];
  renderSequence();
  updateListeningContext();
});

targetOctaveEl.addEventListener('change', () => {
  trace = [];
  renderSequence();
  updateListeningContext();
});

sequenceTextEl.addEventListener('input', renderSequence);

startCruiseButton.addEventListener('click', () => {
  if (getSequence().length === 0) return;
  appMode = 'single';
  phraseMode = false;
  cruiseOn = true;
  sequenceIndex = 0;
  trace = [];
  lockStart = null;
  setHoldProgress(0);
  renderSequence();
});

resetCruiseButton.addEventListener('click', () => {
  cruiseOn = false;
  phraseMode = false;
  sequenceIndex = 0;
  trace = [];
  traceLineEl.setAttribute('points', '');
  lockStart = null;
  setHoldProgress(0);
  renderSequence();
});

lockedSlider.addEventListener('input', () => {
  lockedValue.textContent = '±' + lockedSlider.value + '¢';
});

closeSlider.addEventListener('input', () => {
  closeValue.textContent = '±' + closeSlider.value + '¢';
});

holdSlider.addEventListener('input', () => {
  holdValue.textContent = (Number(holdSlider.value) / 1000).toFixed(2) + 's';
});

recordSourceAudioButton.addEventListener('click', () => {
  void startSourceCapture();
});

stopSourceAudioButton.addEventListener('click', stopSourceCapture);

referenceFileEl.addEventListener('change', () => {
  const file = referenceFileEl.files?.[0];
  if (!file) return;

  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  const supported = new Set(['mp3', 'ogg', 'wav', 'flac', 'aiff', 'aif', 'aac', 'm4a', 'avi', 'mp4', 'mkv', 'mov', 'm4v']);
  if (!supported.has(extension)) {
    referenceFileEl.value = '';
    setReferenceStatus('That file type is not supported for separation. Use MP3, OGG, WAV, FLAC, AIFF, AAC, M4A, AVI, MP4, MKV, MOV, or M4V.', 'UNSUPPORTED FILE');
    return;
  }

  void prepareSong(file, file.name || 'uploaded-source');
});

selectVersesButton.addEventListener('click', () => selectKinds(['verse']));
selectChorusesButton.addEventListener('click', () => selectKinds(['chorus']));
clearSectionsButton.addEventListener('click', () => {
  selectedSectionIds.clear();
  renderSongSections();
  syncSelectedNotes();
});

pitchRangeButtons.forEach(button => {
  button.addEventListener('click', () => {
    const mode = button.dataset.pitchRangeMode as PitchRangeMode | undefined;
    if (!mode) return;
    pitchRangeMode = mode;
    recentFrequencies = [];
    previousStableFrequency = null;
    updatePitchRangeUi();
  });
});

artistPresetButtons.forEach(button => {
  button.addEventListener('click', () => {
    artistLevel = Math.max(0, Math.min(1, Number(button.dataset.artistLevel ?? 0) / 100));
    applyStemLevels();
  });
});
backingVocalLevelEl.addEventListener('input', applyStemLevels);
instrumentalLevelEl.addEventListener('input', applyStemLevels);

playSelectionButton.addEventListener('click', () => {
  void startSelection(false);
});
recordTakeButton.addEventListener('click', () => {
  void startSelection(true);
});
stopPracticeButton.addEventListener('click', () => {
  stopPracticePlayback(true);
  takeStatusEl.textContent = 'Stopped.';
});

modeButtons.forEach(button => {
  button.addEventListener('click', () => {
    const mode = button.dataset.appMode as AppMode | undefined;
    if (mode) setAppMode(mode);
  });
});

advancedToggleButton.addEventListener('click', () => {
  advancedControls = !advancedControls;
  applyModeVisibility();
});

startCadenceButton.addEventListener('click', startCadence);
stopCadenceButton.addEventListener('click', () => stopCadence());

phraseUnitsEl.addEventListener('click', event => {
  const target = event.target as HTMLElement;
  const toneButton = target.closest<HTMLButtonElement>('.unitToneButton');
  if (!toneButton || toneButton.disabled) return;

  event.preventDefault();
  event.stopPropagation();

  const index = Number(toneButton.dataset.toneIndex ?? -1);
  const note = phraseNotes[index];
  if (index < 0 || !note || noteToMidi(note) === null) return;

  selectedPhraseIndex = index;
  toneButton.classList.add('playing');
  toneButton.textContent = 'Playing ' + note + '…';
  phraseBuildStateEl.textContent = 'Playing ' + note + ' · ' + (phraseWords[index] ?? 'unit');
  updateListeningContext();

  void playNoteTone(note, 800)
    .then(() => {
      window.setTimeout(() => {
        const liveButton = phraseUnitsEl.querySelector<HTMLButtonElement>(
          '.unitToneButton[data-tone-index="' + index + '"]'
        );
        if (liveButton) {
          liveButton.classList.remove('playing');
          liveButton.textContent = '▶ Hear ' + note;
        }
        if (phraseWords.length === phraseNotes.length && phraseWords.length > 0) {
          phraseBuildStateEl.textContent = phraseWords.length + ' units ready';
        }
      }, 820);
    })
    .catch(() => {
      toneButton.classList.remove('playing');
      toneButton.textContent = '▶ Hear ' + note;
      phraseBuildStateEl.textContent = 'Audio blocked · tap Hear again';
    });
});

practicePhraseButton.addEventListener('click', () => {
  stopCadence(false);
  if (phraseWords.length === 0 || phraseNotes.length === 0) return;
  sequenceTextEl.value = phraseNotes.join(' → ');
  phraseMode = true;
  cruiseOn = true;
  sequenceIndex = 0;
  selectedPhraseIndex = 0;
  trace = [];
  traceLineEl.setAttribute('points', '');
  lockStart = null;
  setHoldProgress(0);
  renderSequence();
  renderPhraseCoach();
  practicePhraseButton.textContent = 'Practice active';
  phraseBuildStateEl.textContent = 'Live tuner active';
});

[lyricsTextEl, phraseNotesEl].forEach(field => {
  field.addEventListener('input', syncPhraseFromInputs);
  field.addEventListener('change', syncPhraseFromInputs);
  field.addEventListener('blur', syncPhraseFromInputs);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}

renderSequence();
applyModeVisibility();
setSourceUiState('idle');
updatePitchRangeUi();

if (new URLSearchParams(window.location.search).get('debug') === 'layout') {
  const renderLayoutDebug = () => {
    document.getElementById('layoutDebug')?.remove();
    const selectors = ['.shell', '.topbar', '.modeChooser', '.referenceCard', '.tunerStack', '.heroCard', '.traceCard', 'footer'];
    const lines = selectors.map(selector => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return selector + ': missing';
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return selector +
        ' x=' + rect.x.toFixed(1) +
        ' y=' + rect.y.toFixed(1) +
        ' w=' + rect.width.toFixed(1) +
        ' h=' + rect.height.toFixed(1) +
        ' bottom=' + rect.bottom.toFixed(1) +
        ' display=' + style.display +
        ' overflowY=' + style.overflowY;
    });
    const debug = document.createElement('pre');
    debug.id = 'layoutDebug';
    debug.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:99999;max-width:calc(100vw - 16px);max-height:45vh;overflow:auto;padding:10px;background:#000;color:#0f0;font:11px/1.35 monospace;white-space:pre-wrap;border:1px solid #0f0';
    const bodyStyle = getComputedStyle(document.body);
    const shell = document.querySelector<HTMLElement>('.shell');
    debug.textContent =
      'viewport w=' + window.innerWidth + ' h=' + window.innerHeight +
      ' scrollH=' + document.documentElement.scrollHeight +
      ' bodyH=' + document.body.scrollHeight +
      ' stylesheets=' + document.styleSheets.length +
      ' bodyMargin=' + bodyStyle.margin +
      ' shellClass=' + (shell?.className ?? 'missing') + '\n' +
      lines.join('\n');
    document.body.appendChild(debug);
  };
  const renderWhenReady = () => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(renderLayoutDebug));
    window.setTimeout(renderLayoutDebug, 1600);
  };
  if (document.readyState === 'complete') {
    renderWhenReady();
  } else {
    window.addEventListener('load', renderWhenReady, { once: true });
  }
  document.fonts?.ready.then(renderLayoutDebug).catch(() => undefined);
  window.addEventListener('resize', renderLayoutDebug);
}
void checkLalalConnection();
setNoPitch();
