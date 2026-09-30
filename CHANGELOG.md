# Changelog

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
