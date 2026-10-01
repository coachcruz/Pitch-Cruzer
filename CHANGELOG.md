# Changelog

## 2026-10-01 — YouTube reference video (reference-only)

- **Reference video (listening only).** The Add-a-song card has an optional "Reference video"
  field: paste any YouTube link (watch, youtu.be, shorts, embed) and it's validated on the spot.
  The link is kept with the song and can be watched from the practice screen's ⋯ menu, in
  YouTube's privacy-enhanced player (no cookies, no autoplay, no related videos).
- **It never becomes the song.** The video is for listening only — nothing is downloaded from
  YouTube and it never goes through stem separation. The song still comes from the audio file
  you upload. The link can be changed or removed anytime from the same ⋯ menu dialog.
- New `tests/youtube.test.ts`: link parsing across all URL formats plus the embed-URL builder.

## 2026-09-30 — Take playback, count-in dots, and Redo-lyrics reattempt fixes

Three reported defects fixed:

- **Take review no longer ducks the music.** The live mic stayed open while a saved take
  played back, and on phones the active capture session could make the system duck the
  background music and the original singer under the take's voice. The mic is now paused
  for the take's playback and brought back afterward exactly as it was. If you toggle the
  mic yourself mid-take, your choice wins — no auto-restore.
- **Count-in dots come back.** A song whose beat detection once saved "none found" never
  retried, so its silent count-in dots never appeared no matter how the detector improved.
  A saved miss is now re-estimated, so every song gets its adaptive count-in (3 dots for
  3/4, 4 for 4/4).
- **Redo lyrics is now a true reattempt.** It used to listen from scratch and lead with
  language detection. Now the first listen's words guide the second: they're passed to the
  transcription as context so it mainly goes after what was missed or misheard, and
  anything the fresh pass still misses but the first pass caught (over real singing) is
  kept. Language detection is unchanged.

## 2026-09-30 — Practice UI consolidation: Voices, EQ, duets, section coaching

The three level meters in the floating controls (mic · singer · music) are now buttons.
Tapping one opens the **Voices** panel with three tabs — no new floating buttons, and nothing
was removed from the pill:

- **🎤 Mic tab** — mic on/off, input-device selection, an optional second live mic
  (desktop Chrome/Edge; most phones only allow one input route), "hear my mic" monitor
  level, and the mic check. The two mic signals are mixed for the monitor, the meter and
  the recording; per-singer scoring still comes from the duet line assignment.
- **🎙 Singer tab** — original-singer Mute / Guide / Full presets and volume, plus
  "Sing with a partner": lower/higher initial assignment, editable **Singer One** /
  **Singer Two** names (saved per song), and an "Assign lines in Karaoke" shortcut.
  Karaoke line buttons now show the singer names instead of You/Them.
- **🎶 Music tab** — background-track volume plus new **bass and treble EQ** (±12 dB
  shelves on the music bus; the singer and mic are untouched). EQ settings persist.

The ⚙ settings panel now only holds scoring/display options (forgive octave, count-in,
simple staff, voice types). The 🎵 practice panel is unchanged.

**Section detection fix:** consecutive same-kind sections are now merged (keeping the
first section's ID), so untagged songs no longer produce absurd results like Verse 1–13.
Sections of the same kind separated by anything else (Verse → Chorus → Verse) stay
separate.

**Section coaching:** tapping a karaoke line's percentage opens coaching for the whole
containing section — section score, coverage, strengths, weaknesses, and up to three
words sung notably flat or sharp with a vowel-shaping suggestion. Word tips are coaching
suggestions from measured pitch, not a diagnosis of the singer's mouth or throat.

Technical: `Player.setEQ(bassDb, trebleDb)` (`src/lib/player.ts`); `LiveMic.addSecondMic()`
/ `removeSecondMic()` (`src/lib/mic.ts`); `duetNames()` and per-song `duet.names`
(`src/lib/duet.ts`, `src/lib/analysis.ts`); `sectionCoaching()` with signed word-level
mean-cent errors (`src/lib/score.ts`); consecutive section merge in `buildSections`
(`src/lib/analysis.ts`).
