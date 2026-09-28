import type { StoredSong } from './lib/library';
import type { SongBuffers } from './lib/prepare';

/** The song that is open right now (it may or may not be saved to the library). */
export const session: {
  song: StoredSong | null; buffers: SongBuffers | null; saved: boolean; lyricsJobs: Map<string, Promise<void>>;
  busy: (() => boolean) | null;
} = {
  song: null,
  buffers: null,
  saved: false,
  /** Songs whose lyrics are still being written in the background (practice can already start). */
  lyricsJobs: new Map(),
  /** Set by the open screen: true while it's in the middle of something (playing, recording…) — see lib/update. */
  busy: null
};

/** Fired on window when a song's background lyrics are ready: detail = song id. */
export const LYRICS_READY = 'pc:lyrics-ready';
