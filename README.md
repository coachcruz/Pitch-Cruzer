# Pitch Cruzer

A sing-along practice app for shy singers, learners and groups of friends.

1. **Add a song**: upload a file, paste a link (Suno / direct audio links download automatically), or record the song from another browser tab (YouTube, Spotify, Apple Music…).
2. **Pitch Cruzer prepares it once**: LALAL.AI separates the lead vocal, backing vocals and music; the app then finds every note the singer hits, writes out the lyrics (Whisper, in the browser), and splits the song into intro / verse / pre-chorus / chorus / bridge / outro.
3. **Practice**: pick one or more sections (or any range of lyric lines), loop them, turn the original singer up, down or off, and sing along with karaoke lyrics that show the note and octave for every syllable. A scrolling note lane shows the artist's notes and your live voice.
4. **Record yourself**: get a score, per-line feedback and a coaching tip, listen back, download the mix, and save takes to a local leaderboard.

Songs and takes are stored on the device (IndexedDB), so a song only uses LALAL.AI minutes once.

## Setup

```bash
npm install
npm run dev          # UI only (no server functions)
netlify dev          # UI + server functions (needs the Netlify CLI)
npm run build
```

Set the environment variable **`LALAL_API_KEY`** on Netlify (Site settings → Environment variables) and redeploy.
Without it the app still works using the full mix ("Continue without separating"), but the singer can't be turned down.

## How it's built

| Part | Where |
| --- | --- |
| Server functions (chunked upload via Netlify Blobs, link import, LALAL.AI proxy) | `netlify/functions`, `netlify/lib` |
| Pitch tracking (YIN, in a Web Worker) | `src/lib/yin.ts`, `src/lib/pitch.worker.ts` |
| Notes, syllables, lyric lines, section detection | `src/lib/analysis.ts` |
| Lyrics transcription (Whisper via transformers.js, in a Web Worker) | `src/lib/transcribe.worker.ts` |
| Synced multi-stem playback | `src/lib/player.ts` |
| Mic pitch + sample-accurate recording | `src/lib/mic.ts`, `public/recorder-worklet.js` |
| Scoring + mixdown | `src/lib/score.ts` |
| Screens | `src/views/home.ts`, `src/views/practice.ts`, `src/views/tuner.ts` |

Notes: streaming services (YouTube, Spotify, Apple Music) don't allow downloads, so those songs are captured by recording the tab while it plays (Chrome/Edge desktop).
Uploads are sent in 4 MB chunks because Netlify functions reject request bodies over ~6 MB.
