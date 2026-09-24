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

  <section id="phraseCard" class="phraseCard hidden">
    <div class="sectionHeading">
      <div>
        <p class="eyebrow">LYRIC + RESONANCE TRAINER</p>
        <h2>Phrase Coach</h2>
      </div>
      <span class="tinyLabel">VOWEL SHAPE</span>
    </div>

    <p class="phraseIntro">
      Enter the phrase as words or syllables, then give each unit a target note. Use <strong>|</strong> when you want exact syllable boundaries.
    </p>

    <div class="phraseInputs">
      <label>Phrase lyrics
        <textarea id="lyricsText" rows="3" placeholder="raise | your | yah | yah | yah"></textarea>
      </label>
      <label>Phrase notes
        <textarea id="phraseNotes" rows="3" placeholder="G3 → A3 → B3 → B3 → B3"></textarea>
      </label>
    </div>

    <div class="buttonRow phraseButtons">
      <button id="buildPhrase" class="primaryButton">Build phrase</button>
      <button id="practicePhrase" class="secondaryButton" disabled>Practice phrase</button>
    </div>

    <div class="cadencePanel">
      <div class="cadenceTitleRow">
        <div>
          <span class="coachLabel">CADENCE CUE</span>
          <strong>Entrance trainer</strong>
        </div>
        <span class="cadenceNote">Tone = exact pitch · TTS pitch = approximate</span>
      </div>

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
        <button id="startCadence" class="primaryButton">Start cues</button>
        <button id="stopCadence" class="secondaryButton" disabled>Stop</button>
      </div>
      <div id="cadenceStatus" class="cadenceStatus">Build a phrase, then cue the entrances.</div>
    </div>

    <div id="phraseWarning" class="phraseWarning hidden"></div>
    <div id="phraseUnits" class="phraseUnits emptyPhrase">
      Build a phrase to see note-by-note vowel coaching.
    </div>

    <div id="vowelCoach" class="vowelCoach hidden">
      <div class="vowelCoachTop">
        <div>
          <span class="coachLabel">CURRENT UNIT</span>
          <strong id="coachWord">—</strong>
        </div>
        <div class="vowelBadge" id="coachVowel">AH</div>
      </div>
      <div class="coachGrid">
        <div><span class="coachLabel">MOUTH</span><p id="mouthCue"></p></div>
        <div><span class="coachLabel">RESONANCE</span><p id="resonanceCue"></p></div>
        <div><span class="coachLabel">PITCH CUE</span><p id="pitchCue"></p></div>
      </div>
      <p class="coachScience">The vowel changes resonance/formants and tone color. Your vocal folds still set the fundamental pitch.</p>
    </div>
  </section>

  <section id="referenceCard" class="referenceCard hidden">
    <div class="sectionHeading">
      <div>
        <p class="eyebrow">SONG COMPARISON</p>
        <h2>Reference Match</h2>
      </div>
      <span id="referenceCapability" class="tinyLabel">NO SOURCE</span>
    </div>

    <p class="phraseIntro">
      Paste a YouTube, Spotify, Suno, or direct-audio link. Streaming embeds can be used as a listening reference; accessible audio and imported clips can also be analyzed into target notes.
    </p>

    <div class="desktopCapturePanel">
      <div class="captureActions">
        <button id="captureDesktopAudio" class="primaryButton">Capture tab audio</button>
        <button id="stopDesktopAudio" class="secondaryButton" disabled>Stop</button>
        <span id="desktopCaptureStatus" class="captureState">OFF</span>
      </div>
      <div class="captureMixControls">
        <label>Vocal reduce <span id="vocalReduceValue">85%</span>
          <input id="vocalReduce" type="range" min="0" max="100" step="1" value="85">
        </label>
        <label>Backing <span id="backingLevelValue">80%</span>
          <input id="backingLevel" type="range" min="0" max="100" step="1" value="80">
        </label>
      </div>
      <div class="captureHint">Use headphones. Fast mode reduces center-panned vocals; it is not full AI stem separation.</div>
    </div>

    <div class="referenceDivider"><span>LINK / FILE</span></div>

    <label>Reference URL
      <div class="referenceUrlRow">
        <input id="referenceUrl" type="url" placeholder="https://youtube.com/... or https://suno.com/song/...">
        <button id="loadReference" class="primaryButton compactButton">Load reference</button>
      </div>
    </label>

    <div class="referenceDivider"><span>OR</span></div>

    <label class="fileLabel">Import reference audio
      <input id="referenceFile" type="file" accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg">
    </label>

    <div id="referenceStatus" class="referenceStatus">
      Add a song link or audio clip to start.
    </div>

    <div id="referencePlayer" class="referencePlayer hidden"></div>

    <div id="referenceAnalysis" class="referenceAnalysis hidden">
      <div class="analysisControls">
        <label>Start (sec)
          <input id="referenceStart" type="number" min="0" step="0.1" value="0">
        </label>
        <label>Analyze (sec)
          <input id="referenceDuration" type="number" min="3" max="20" step="1" value="12">
        </label>
        <button id="useCurrentTime" class="secondaryButton">Use player time</button>
        <button id="analyzeReference" class="primaryButton">Analyze selection</button>
      </div>

      <div id="analysisProgress" class="analysisProgress hidden">
        <div class="progressTrack"><div id="analysisProgressFill" class="progressFill"></div></div>
        <span id="analysisProgressText">Analyzing…</span>
      </div>

      <div id="referenceSequenceWrap" class="referenceSequenceWrap hidden">
        <span class="coachLabel">DERIVED TARGETS</span>
        <div id="referenceSequence" class="derivedSequence"></div>
        <div class="buttonRow referenceActions">
          <button id="sendReferenceToCruise" class="primaryButton">Send to Cruise</button>
          <button id="sendReferenceToPhrase" class="secondaryButton">Use with lyrics</button>
        </div>
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
const buildPhraseButton = qs<HTMLButtonElement>('#buildPhrase');
const practicePhraseButton = qs<HTMLButtonElement>('#practicePhrase');
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
const coachWordEl = qs<HTMLElement>('#coachWord');
const coachVowelEl = qs<HTMLElement>('#coachVowel');
const mouthCueEl = qs<HTMLElement>('#mouthCue');
const resonanceCueEl = qs<HTMLElement>('#resonanceCue');
const pitchCueEl = qs<HTMLElement>('#pitchCue');
const phraseNowEl = qs<HTMLElement>('#phraseNow');
const phraseNowWordEl = qs<HTMLElement>('#phraseNowWord');
const phraseNowVowelEl = qs<HTMLElement>('#phraseNowVowel');
const captureDesktopAudioButton = qs<HTMLButtonElement>('#captureDesktopAudio');
const stopDesktopAudioButton = qs<HTMLButtonElement>('#stopDesktopAudio');
const desktopCaptureStatusEl = qs<HTMLElement>('#desktopCaptureStatus');
const vocalReduceSlider = qs<HTMLInputElement>('#vocalReduce');
const vocalReduceValueEl = qs<HTMLElement>('#vocalReduceValue');
const backingLevelSlider = qs<HTMLInputElement>('#backingLevel');
const backingLevelValueEl = qs<HTMLElement>('#backingLevelValue');
const referenceUrlEl = qs<HTMLInputElement>('#referenceUrl');
const loadReferenceButton = qs<HTMLButtonElement>('#loadReference');
const referenceFileEl = qs<HTMLInputElement>('#referenceFile');
const referenceStatusEl = qs<HTMLElement>('#referenceStatus');
const referencePlayerEl = qs<HTMLElement>('#referencePlayer');
const referenceCapabilityEl = qs<HTMLElement>('#referenceCapability');
const referenceAnalysisEl = qs<HTMLElement>('#referenceAnalysis');
const referenceStartEl = qs<HTMLInputElement>('#referenceStart');
const referenceDurationEl = qs<HTMLInputElement>('#referenceDuration');
const useCurrentTimeButton = qs<HTMLButtonElement>('#useCurrentTime');
const analyzeReferenceButton = qs<HTMLButtonElement>('#analyzeReference');
const analysisProgressEl = qs<HTMLElement>('#analysisProgress');
const analysisProgressFillEl = qs<HTMLElement>('#analysisProgressFill');
const analysisProgressTextEl = qs<HTMLElement>('#analysisProgressText');
const referenceSequenceWrapEl = qs<HTMLElement>('#referenceSequenceWrap');
const referenceSequenceEl = qs<HTMLElement>('#referenceSequence');
const sendReferenceToCruiseButton = qs<HTMLButtonElement>('#sendReferenceToCruise');
const sendReferenceToPhraseButton = qs<HTMLButtonElement>('#sendReferenceToPhrase');

targetNoteEl.innerHTML = NOTE_NAMES.map(
  name => '<option value="' + name + '">' + name + '</option>'
).join('');
targetNoteEl.value = 'G';
targetOctaveEl.innerHTML = [1, 2, 3, 4, 5]
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

let appMode: AppMode = 'single';
let advancedControls = false;
let cadencePlaying = false;
let cadenceIndex = 0;
let cadenceTimers: number[] = [];
let cueAudioContext: AudioContext | null = null;
let referenceAudioBuffer: AudioBuffer | null = null;
let referenceAudioElement: HTMLAudioElement | null = null;
let referenceObjectUrl: string | null = null;
let derivedReferenceNotes: string[] = [];

let desktopCaptureStream: MediaStream | null = null;
let desktopCaptureContext: AudioContext | null = null;
let desktopVocalSubtractLeft: GainNode | null = null;
let desktopVocalSubtractRight: GainNode | null = null;
let desktopBackingGain: GainNode | null = null;
let desktopRecorder: MediaRecorder | null = null;
let desktopRecorderChunks: Blob[] = [];
let desktopCaptureStopping = false;
let desktopCaptureStereo = true;

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

function parseYouTubeId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname.includes('youtu.be')) return url.pathname.split('/').filter(Boolean)[0] ?? null;
    if (url.hostname.includes('youtube.com')) {
      if (url.pathname.startsWith('/shorts/')) return url.pathname.split('/')[2] ?? null;
      if (url.pathname.startsWith('/embed/')) return url.pathname.split('/')[2] ?? null;
      return url.searchParams.get('v');
    }
  } catch {
    return null;
  }
  return null;
}

function parseSpotifyEmbed(value: string): string | null {
  try {
    const url = new URL(value);
    if (!url.hostname.includes('spotify.com')) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const embedIndex = parts[0] === 'embed' ? 1 : 0;
    const type = parts[embedIndex];
    const id = parts[embedIndex + 1];
    if (!type || !id) return null;
    return 'https://open.spotify.com/embed/' + type + '/' + id.split('?')[0];
  } catch {
    return null;
  }
}

function isSunoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === 'suno.com' || url.hostname.endsWith('.suno.com');
  } catch {
    return false;
  }
}

function looksLikeDirectAudio(value: string): boolean {
  try {
    const url = new URL(value);
    return /\.(mp3|m4a|wav|aac|ogg|flac)(?:$|\?)/i.test(url.pathname + url.search);
  } catch {
    return false;
  }
}

function clearReferencePlayer(): void {
  referencePlayerEl.innerHTML = '';
  referencePlayerEl.classList.add('hidden');
  referenceAudioElement = null;
  referenceAudioBuffer = null;
  derivedReferenceNotes = [];
  referenceSequenceWrapEl.classList.add('hidden');
  referenceAnalysisEl.classList.add('hidden');
  if (referenceObjectUrl) {
    URL.revokeObjectURL(referenceObjectUrl);
    referenceObjectUrl = null;
  }
}

function setReferenceStatus(message: string, capability: string): void {
  referenceStatusEl.textContent = message;
  referenceCapabilityEl.textContent = capability;
}

function updateDesktopMix(): void {
  const reduction = Math.max(0, Math.min(1, Number(vocalReduceSlider.value) / 100));
  const backing = Math.max(0, Math.min(1, Number(backingLevelSlider.value) / 100));
  vocalReduceValueEl.textContent = Math.round(reduction * 100) + '%';
  backingLevelValueEl.textContent = Math.round(backing * 100) + '%';

  const effectiveReduction = desktopCaptureStereo ? reduction : 0;
  if (desktopVocalSubtractLeft) desktopVocalSubtractLeft.gain.value = -effectiveReduction;
  if (desktopVocalSubtractRight) desktopVocalSubtractRight.gain.value = -effectiveReduction;
  if (desktopBackingGain) desktopBackingGain.gain.value = backing;
}

function getRecorderMimeType(): string {
  if (!('MediaRecorder' in window)) return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus'
  ];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) ?? '';
}

async function finalizeDesktopRecording(): Promise<void> {
  if (desktopRecorderChunks.length === 0) return;

  const type = desktopRecorder?.mimeType || getRecorderMimeType() || 'audio/webm';
  const blob = new Blob(desktopRecorderChunks, { type });
  desktopRecorderChunks = [];

  try {
    referenceAudioBuffer = await decodeReferenceBytes(await blob.arrayBuffer());
    referenceAnalysisEl.classList.remove('hidden');
    setReferenceStatus(
      'Captured audio is ready for pitch analysis. The saved reference is the original captured mix; vocal reduction only affects what you hear while practicing.',
      'CAPTURE READY'
    );
    updateListeningContext();
  } catch {
    setReferenceStatus(
      'Capture ended. Live backing worked, but this browser could not decode the captured recording for offline pitch analysis.',
      'CAPTURE ENDED'
    );
  }
}

function stopDesktopCapture(): void {
  if (!desktopCaptureStream && !desktopCaptureContext) return;

  desktopCaptureStopping = true;
  if (desktopRecorder?.state === 'recording') {
    desktopRecorder.stop();
  }

  desktopCaptureStream?.getTracks().forEach(track => track.stop());
  desktopCaptureStream = null;

  desktopCaptureContext?.close().catch(() => undefined);
  desktopCaptureContext = null;
  desktopVocalSubtractLeft = null;
  desktopVocalSubtractRight = null;
  desktopBackingGain = null;

  captureDesktopAudioButton.disabled = false;
  stopDesktopAudioButton.disabled = true;
  desktopCaptureStatusEl.textContent = 'OFF';
  desktopCaptureStatusEl.classList.remove('active');
  desktopCaptureStopping = false;
}

async function startDesktopCapture(): Promise<void> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setReferenceStatus('This browser does not support tab/system audio capture.', 'UNSUPPORTED');
    return;
  }

  stopDesktopCapture();
  setReferenceStatus(
    'Choose the tab/window that is playing the song and make sure Share audio is enabled.',
    'CHOOSE SOURCE'
  );

  try {
    const supported = navigator.mediaDevices.getSupportedConstraints() as MediaTrackSupportedConstraints & {
      suppressLocalAudioPlayback?: boolean;
    };
    const audioConstraints: MediaTrackConstraints & {
      suppressLocalAudioPlayback?: boolean;
    } = {};

    if (supported.suppressLocalAudioPlayback) {
      audioConstraints.suppressLocalAudioPlayback = true;
    }

    const capture = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: audioConstraints
    });

    const audioTrack = capture.getAudioTracks()[0];
    if (!audioTrack) {
      capture.getTracks().forEach(track => track.stop());
      setReferenceStatus(
        'The selected source did not provide an audio track. Choose a browser tab and enable Share tab audio.',
        'NO AUDIO'
      );
      return;
    }

    desktopCaptureStream = capture;
    const audioOnly = new MediaStream([audioTrack]);
    const settings = audioTrack.getSettings() as MediaTrackSettings & {
      channelCount?: number;
      suppressLocalAudioPlayback?: boolean;
    };
    desktopCaptureStereo = settings.channelCount !== 1;

    const context = new AudioContext();
    await context.resume();
    desktopCaptureContext = context;

    const sourceNode = context.createMediaStreamSource(audioOnly);
    const splitter = context.createChannelSplitter(2);
    const merger = context.createChannelMerger(2);

    const leftBase = context.createGain();
    const rightBase = context.createGain();
    const midLeft = context.createGain();
    const midRight = context.createGain();
    const midBus = context.createGain();
    const subtractLeft = context.createGain();
    const subtractRight = context.createGain();
    const backingGain = context.createGain();

    leftBase.gain.value = 1;
    rightBase.gain.value = 1;
    midLeft.gain.value = 0.5;
    midRight.gain.value = 0.5;

    sourceNode.connect(splitter);
    splitter.connect(leftBase, 0);
    splitter.connect(rightBase, desktopCaptureStereo ? 1 : 0);
    leftBase.connect(merger, 0, 0);
    rightBase.connect(merger, 0, 1);

    splitter.connect(midLeft, 0);
    splitter.connect(midRight, desktopCaptureStereo ? 1 : 0);
    midLeft.connect(midBus);
    midRight.connect(midBus);
    midBus.connect(subtractLeft);
    midBus.connect(subtractRight);
    subtractLeft.connect(merger, 0, 0);
    subtractRight.connect(merger, 0, 1);

    merger.connect(backingGain);
    backingGain.connect(context.destination);

    desktopVocalSubtractLeft = subtractLeft;
    desktopVocalSubtractRight = subtractRight;
    desktopBackingGain = backingGain;
    updateDesktopMix();

    desktopRecorderChunks = [];
    if ('MediaRecorder' in window) {
      const mimeType = getRecorderMimeType();
      desktopRecorder = mimeType
        ? new MediaRecorder(audioOnly, { mimeType })
        : new MediaRecorder(audioOnly);
      desktopRecorder.addEventListener('dataavailable', event => {
        if (event.data.size > 0) desktopRecorderChunks.push(event.data);
      });
      desktopRecorder.addEventListener('stop', () => {
        void finalizeDesktopRecording();
      });
      desktopRecorder.start(250);
    }

    audioTrack.addEventListener('ended', () => {
      if (!desktopCaptureStopping) stopDesktopCapture();
    });

    captureDesktopAudioButton.disabled = true;
    stopDesktopAudioButton.disabled = false;
    desktopCaptureStatusEl.textContent = 'LIVE';
    desktopCaptureStatusEl.classList.add('active');

    const suppressed = settings.suppressLocalAudioPlayback === true;
    const reductionNote = desktopCaptureStereo
      ? 'Center vocal reduction is active.'
      : 'The captured source is mono, so center vocal reduction is disabled.';

    setReferenceStatus(
      reductionNote + (suppressed
        ? ' Original local playback is suppressed; you are hearing Pitch Cruzer’s processed backing.'
        : ' If you hear both the original and processed mix, this browser did not suppress the source playback.'),
      'LIVE CAPTURE'
    );
  } catch {
    setReferenceStatus(
      'Desktop audio capture was cancelled or blocked. Chrome or Edge desktop works best for this mode.',
      'CAPTURE OFF'
    );
    stopDesktopCapture();
  }
}

async function decodeReferenceBytes(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(bytes.slice(0));
  } finally {
    await context.close().catch(() => undefined);
  }
}

function installAudioPlayer(src: string): HTMLAudioElement {
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.preload = 'metadata';
  audio.crossOrigin = 'anonymous';
  audio.src = src;
  referencePlayerEl.innerHTML = '';
  referencePlayerEl.appendChild(audio);
  referencePlayerEl.classList.remove('hidden');
  referenceAudioElement = audio;
  return audio;
}

async function loadDirectAudio(value: string): Promise<void> {
  setReferenceStatus('Trying to load analyzable audio…', 'LOADING AUDIO');
  try {
    const response = await fetch(value, { mode: 'cors' });
    if (!response.ok) throw new Error('Audio request failed');
    const bytes = await response.arrayBuffer();
    referenceAudioBuffer = await decodeReferenceBytes(bytes);
    installAudioPlayer(value);
    referenceAnalysisEl.classList.remove('hidden');
    setReferenceStatus('Raw audio is accessible. Pitch extraction is available.', 'FULL ANALYSIS');
  } catch {
    installAudioPlayer(value);
    setReferenceStatus(
      'The link can be played if the host allows it, but its raw audio is blocked by cross-origin rules. Import the clip for exact pitch analysis.',
      'PLAYER ONLY'
    );
  }
}

function loadReferenceLink(): void {
  const value = referenceUrlEl.value.trim();
  if (!value) {
    setReferenceStatus('Paste a reference link first.', 'NO SOURCE');
    return;
  }

  clearReferencePlayer();
  const youtubeId = parseYouTubeId(value);
  const spotifyEmbed = parseSpotifyEmbed(value);

  if (youtubeId) {
    const iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube.com/embed/' + encodeURIComponent(youtubeId);
    iframe.title = 'YouTube reference';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    referencePlayerEl.appendChild(iframe);
    referencePlayerEl.classList.remove('hidden');
    setReferenceStatus(
      'YouTube is loaded as a listening reference. The iframe does not expose decoded audio samples, so import the clip for automatic pitch extraction.',
      'PLAYER ONLY'
    );
    return;
  }

  if (spotifyEmbed) {
    const iframe = document.createElement('iframe');
    iframe.src = spotifyEmbed;
    iframe.title = 'Spotify reference';
    iframe.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    iframe.loading = 'lazy';
    referencePlayerEl.appendChild(iframe);
    referencePlayerEl.classList.remove('hidden');
    setReferenceStatus(
      'Spotify is loaded as a listening reference. The embed does not expose decoded audio samples, so import the clip for automatic pitch extraction.',
      'PLAYER ONLY'
    );
    return;
  }

  if (isSunoUrl(value)) {
    const frame = document.createElement('iframe');
    frame.src = value;
    frame.title = 'Suno reference';
    referencePlayerEl.appendChild(frame);

    const link = document.createElement('a');
    link.href = value;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open Suno reference in a new tab';
    link.className = 'referenceOpenLink';
    referencePlayerEl.appendChild(link);
    referencePlayerEl.classList.remove('hidden');
    setReferenceStatus(
      'Suno link loaded as a reference. If the page blocks embedding or raw-audio access, import your Suno audio file for exact pitch extraction.',
      'LINK REFERENCE'
    );
    return;
  }

  if (looksLikeDirectAudio(value)) {
    void loadDirectAudio(value);
    return;
  }

  const link = document.createElement('a');
  link.href = value;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Open reference link';
  link.className = 'referenceOpenLink';
  referencePlayerEl.appendChild(link);
  referencePlayerEl.classList.remove('hidden');
  setReferenceStatus(
    'This source is saved as a reference link. Import audio if you want Pitch Cruzer to derive the target notes.',
    'LINK REFERENCE'
  );
}

async function loadReferenceFile(file: File): Promise<void> {
  clearReferencePlayer();
  setReferenceStatus('Decoding imported audio…', 'LOADING AUDIO');

  try {
    const bytes = await file.arrayBuffer();
    referenceAudioBuffer = await decodeReferenceBytes(bytes);
    referenceObjectUrl = URL.createObjectURL(file);
    installAudioPlayer(referenceObjectUrl);
    referenceAnalysisEl.classList.remove('hidden');
    setReferenceStatus(
      'Reference audio loaded. Choose the section you want Pitch Cruzer to turn into target notes.',
      'FULL ANALYSIS'
    );
  } catch {
    setReferenceStatus('I could not decode that audio file in this browser.', 'UNREADABLE');
  }
}

function collapseReferencePitches(midis: Array<number | null>): string[] {
  const groups: Array<{ midi: number; count: number }> = [];
  let currentMidi: number | null = null;
  let count = 0;

  const flush = () => {
    if (currentMidi !== null && count >= 2) groups.push({ midi: currentMidi, count });
    currentMidi = null;
    count = 0;
  };

  midis.forEach(value => {
    if (value === null) {
      flush();
      return;
    }
    const rounded = Math.round(value);
    if (currentMidi === null) {
      currentMidi = rounded;
      count = 1;
      return;
    }
    if (rounded === currentMidi) {
      count += 1;
      return;
    }
    flush();
    currentMidi = rounded;
    count = 1;
  });
  flush();

  const notes: string[] = [];
  groups.forEach(group => {
    const note = midiToNote(group.midi);
    if (notes[notes.length - 1] !== note) notes.push(note);
  });
  return notes.slice(0, 36);
}

async function analyzeReferenceSelection(): Promise<void> {
  if (!referenceAudioBuffer) {
    setReferenceStatus('Import accessible audio before analyzing pitch.', 'PLAYER ONLY');
    return;
  }

  const startSeconds = Math.max(0, Number(referenceStartEl.value) || 0);
  const requestedDuration = Math.max(3, Math.min(20, Number(referenceDurationEl.value) || 12));
  const duration = Math.min(requestedDuration, referenceAudioBuffer.duration - startSeconds);

  if (duration <= 0) {
    setReferenceStatus('The analysis start is beyond the end of the audio.', 'CHECK RANGE');
    return;
  }

  analysisProgressEl.classList.remove('hidden');
  referenceSequenceWrapEl.classList.add('hidden');
  analyzeReferenceButton.disabled = true;
  analysisProgressFillEl.style.width = '0%';
  analysisProgressTextEl.textContent = 'Analyzing pitch contour…';

  const sampleRate = referenceAudioBuffer.sampleRate;
  const channelCount = referenceAudioBuffer.numberOfChannels;
  const startSample = Math.floor(startSeconds * sampleRate);
  const endSample = Math.min(
    referenceAudioBuffer.length,
    Math.floor((startSeconds + duration) * sampleRate)
  );
  const step = Math.max(1, Math.floor(sampleRate * 0.15));
  const sourceFrameSize = 4096;
  const detected: Array<number | null> = [];
  const totalFrames = Math.max(1, Math.ceil((endSample - startSample) / step));
  let frameNumber = 0;

  for (let position = startSample; position + sourceFrameSize < endSample; position += step) {
    const downsampled = new Float32Array(2048);

    for (let i = 0; i < downsampled.length; i += 1) {
      const sourceIndex = position + i * 2;
      let value = 0;
      for (let channel = 0; channel < channelCount; channel += 1) {
        value += referenceAudioBuffer.getChannelData(channel)[sourceIndex] ?? 0;
      }
      downsampled[i] = value / channelCount;
    }

    const result = estimatePitch(downsampled, sampleRate / 2);
    detected.push(result ? frequencyToMidi(result.frequency) : null);
    frameNumber += 1;

    if (frameNumber % 8 === 0) {
      const progress = Math.min(100, (frameNumber / totalFrames) * 100);
      analysisProgressFillEl.style.width = progress.toFixed(0) + '%';
      analysisProgressTextEl.textContent = 'Analyzing… ' + progress.toFixed(0) + '%';
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  }

  derivedReferenceNotes = collapseReferencePitches(detected);
  analysisProgressFillEl.style.width = '100%';
  analyzeReferenceButton.disabled = false;

  if (derivedReferenceNotes.length === 0) {
    analysisProgressTextEl.textContent = 'No stable vocal pitch sequence found in this selection.';
    setReferenceStatus(
      'Try a section with a clearer isolated vocal, less percussion, or a shorter phrase.',
      'NO STABLE PITCH'
    );
    return;
  }

  referenceSequenceEl.innerHTML = derivedReferenceNotes
    .map(note => '<span class="chip">' + note + '</span>')
    .join('');
  referenceSequenceWrapEl.classList.remove('hidden');
  analysisProgressTextEl.textContent =
    'Found ' + derivedReferenceNotes.length + ' stable note targets.';
  setReferenceStatus(
    'Pitch Cruzer derived a practice contour from the accessible reference audio.',
    'TARGETS READY'
  );
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
      listeningDetailEl.textContent = 'Enter the lyric units and their notes, then tap Build phrase.';
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
        'Load a reference, then analyze accessible audio before the tuner can grade against it.';
    } else {
      listeningForTextEl.textContent = derivedReferenceNotes.join(' → ');
      listeningDetailEl.textContent =
        'Reference targets are ready. Current target: ' + target + '.';
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
}

function getTargetFrequency(): number {
  return midiToFrequency(noteToMidi(getActiveTarget()) ?? noteToMidi('G2')!);
}

function estimatePitch(
  buffer: Float32Array,
  sampleRate: number
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

  const minHz = 55;
  const maxHz = 420;
  const minLag = Math.floor(sampleRate / maxHz);
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
  if (phraseWords.length === 0 || phraseNotes.length === 0) {
    phraseNowEl.classList.add('hidden');
    return;
  }

  const currentIndex = phraseMode
    ? Math.min(sequenceIndex, phraseWords.length - 1)
    : cadencePlaying
      ? Math.min(cadenceIndex, phraseWords.length - 1)
      : Math.min(selectedPhraseIndex, phraseWords.length - 1);

  phraseUnitsEl.classList.remove('emptyPhrase');
  phraseUnitsEl.innerHTML = phraseWords.map((word, index) => {
    const note = phraseNotes[index] ?? '—';
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

    return '<button type="button" class="' + classes + '" data-phrase-index="' + index + '">' +
      '<span class="phraseUnitWord">' + word + '</span>' +
      '<span class="phraseUnitNote">' + note + '</span>' +
      '<select class="vowelSelect" data-vowel-index="' + index + '" aria-label="Vowel for ' + word + '">' + options + '</select>' +
    '</button>';
  }).join('');

  const word = phraseWords[currentIndex];
  const vowelKey = phraseVowels[currentIndex] ?? inferVowel(word);
  const profile = VOWEL_PROFILES[vowelKey] ?? VOWEL_PROFILES.UH;

  vowelCoachEl.classList.remove('hidden');
  coachWordEl.textContent = word;
  coachVowelEl.textContent = profile.label;
  mouthCueEl.textContent = profile.mouth;
  resonanceCueEl.textContent = profile.resonance;
  pitchCueEl.textContent = profile.pitch;

  if (phraseMode || cadencePlaying) {
    phraseNowEl.classList.remove('hidden');
    phraseNowWordEl.textContent = word;
    phraseNowVowelEl.textContent = profile.label;
  } else {
    phraseNowEl.classList.add('hidden');
  }

  phraseUnitsEl.querySelectorAll<HTMLElement>('[data-phrase-index]').forEach(element => {
    element.addEventListener('click', event => {
      if ((event.target as HTMLElement).tagName === 'SELECT') return;
      selectedPhraseIndex = Number(element.dataset.phraseIndex ?? 0);
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

function buildPhrase(): void {
  const words = splitPhraseUnits(lyricsTextEl.value);
  const notes = parseNoteList(phraseNotesEl.value);
  phraseWarningEl.classList.add('hidden');
  phraseWarningEl.textContent = '';

  if (words.length === 0 || notes.length === 0) {
    phraseWarningEl.textContent = 'Add both lyrics and target notes first.';
    phraseWarningEl.classList.remove('hidden');
    practicePhraseButton.disabled = true;
    return;
  }

  phraseWords = words;
  phraseNotes = notes.slice(0, words.length);
  phraseVowels = words.map((word, index) => phraseVowels[index] ?? inferVowel(word));
  selectedPhraseIndex = 0;

  if (words.length !== notes.length) {
    phraseWarningEl.textContent =
      'I found ' + words.length + ' lyric units and ' + notes.length +
      ' notes. Use | between lyric syllables so the counts match exactly.';
    phraseWarningEl.classList.remove('hidden');
  }

  practicePhraseButton.disabled = phraseNotes.length === 0;
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

async function playCadenceTone(note: string, durationMs: number): Promise<void> {
  const midi = noteToMidi(note);
  if (midi === null) return;

  const context = await getCueContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = midiToFrequency(midi);

  const now = context.currentTime;
  const duration = Math.max(0.08, Math.min(0.7, durationMs / 1000 * 0.58));
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.14, now + 0.012);
  gain.gain.setValueAtTime(0.14, now + Math.max(0.025, duration - 0.045));
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
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
  buildPhrase();
  if (phraseWords.length === 0 || phraseNotes.length === 0) return;

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
  const result = estimatePitch(buffer, audioContext.sampleRate);

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

    if (ratio > 1.88 && ratio < 2.12 && candidate / 2 >= 55) {
      candidate /= 2;
    } else if (ratio > 0.47 && ratio < 0.53 && candidate * 2 <= 420) {
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
  const context = audioContext ?? new AudioContext();
  if (!audioContext) audioContext = context;
  await context.resume();

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = getTargetFrequency();
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.03);
  gain.gain.setValueAtTime(0.18, context.currentTime + 0.6);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.85);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.9);
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

captureDesktopAudioButton.addEventListener('click', () => {
  void startDesktopCapture();
});

stopDesktopAudioButton.addEventListener('click', stopDesktopCapture);

vocalReduceSlider.addEventListener('input', updateDesktopMix);
backingLevelSlider.addEventListener('input', updateDesktopMix);

loadReferenceButton.addEventListener('click', loadReferenceLink);

referenceFileEl.addEventListener('change', () => {
  const file = referenceFileEl.files?.[0];
  if (file) void loadReferenceFile(file);
});

useCurrentTimeButton.addEventListener('click', () => {
  if (!referenceAudioElement) return;
  referenceStartEl.value = referenceAudioElement.currentTime.toFixed(1);
});

analyzeReferenceButton.addEventListener('click', () => {
  void analyzeReferenceSelection();
});

sendReferenceToCruiseButton.addEventListener('click', () => {
  if (derivedReferenceNotes.length === 0) return;
  sequenceTextEl.value = derivedReferenceNotes.join(' → ');
  phraseMode = false;
  cruiseOn = false;
  sequenceIndex = 0;
  renderSequence();
  sequenceTextEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

sendReferenceToPhraseButton.addEventListener('click', () => {
  if (derivedReferenceNotes.length === 0) return;
  phraseNotesEl.value = derivedReferenceNotes.join(' → ');
  practicePhraseButton.disabled = true;
  phraseNotesEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

buildPhraseButton.addEventListener('click', buildPhrase);

startCadenceButton.addEventListener('click', startCadence);
stopCadenceButton.addEventListener('click', () => stopCadence());

practicePhraseButton.addEventListener('click', () => {
  stopCadence(false);
  buildPhrase();
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
});

lyricsTextEl.addEventListener('input', () => {
  practicePhraseButton.disabled = true;
  if (cadencePlaying) stopCadence();
});

phraseNotesEl.addEventListener('input', () => {
  practicePhraseButton.disabled = true;
  if (cadencePlaying) stopCadence();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}

renderSequence();
applyModeVisibility();
setNoPitch();
