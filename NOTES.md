# Notes

A short running log of what changed and why, newest first. Add an entry with every merged change:
the date, the PR, one line per change, and the reason.

## 2026-09-29 — PR #35 (merged)

- **Always dark.** The light theme is removed; the page is dark whatever the device's appearance setting. The owner asked for a persistent dark mode.
- **Mic check and settings in one panel.** It shows on the progress card while a song is prepared, and in ⚙ → "🎤 Mic check & settings". It has the mic picker, "Singing mic" (asks for no noise suppression, automatic volume or voice isolation), and speakers/headphones. Why: iPhone Voice Isolation, Bluetooth mics and blocked Mac mics were failing silently.
- **Sync check.** You clap to 8 clicks, and the measured delay lines up recordings, scores and the staff. Why: Bluetooth latency of 150–300 ms that the browser doesn't report.
- **Level meters** in the controls for the mic, the artist and the music.
- **Pitch: fewer octave-low errors.** Octave-low readings for tenor, alto and soprano dropped from 10–25% to 0–5%. `NOTES_VERSION` is now 3, so saved songs re-find their notes when opened.
- **🎵 "What to practice" button** holds the part, Sing along or Echo, and Repeat. They had been scattered through settings.
- **Build my song:**
  - lines are picked in the karaoke view;
  - the cue is the artist's last two words;
  - only the stretch sung so far is put together;
  - the panel was cleaned up (square corners, no play bar covering it).
- **Takes are kept until the window closes**, and survive a reload. The review page got its own Singer and Music sliders (singer off by default), so the guide can be taken out after recording.
- **Lyrics:**
  - lines break at Whisper's punctuation;
  - words keep Whisper's order;
  - Chinese and Japanese get no spaces;
  - over-stretched made-up words are dropped;
  - Redo always listens first.
  Why: measured on Creative Commons a cappellas, Whisper hears about 96% of words correctly, but the app was garbling them into lines afterwards.

## Before 2026-09-28

PRs #25–#34 are merged; see `git log --merges` for details. They include the Groq identify-song model fallback and the live lyrics pipeline checks from #28.
