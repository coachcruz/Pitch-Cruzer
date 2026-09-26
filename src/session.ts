import type { StoredSong } from './lib/library';
import type { SongBuffers } from './lib/prepare';

/** The song that is open right now (it may or may not be saved to the library). */
export const session: { song: StoredSong | null; buffers: SongBuffers | null; saved: boolean } = {
  song: null,
  buffers: null,
  saved: false
};
