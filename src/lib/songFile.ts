/**
 * Which file the user meant, and whether it can be a song — all the checks on a picked or dropped file,
 * in one place (no browser APIs, so they're unit-tested).
 */

/** The parts of a File these checks need (a real File fits). */
export interface FileLike { name: string; type: string; size: number }

const AUDIO_EXT = /\.(mp3|wav|wave|m4a|aac|flac|ogg|oga|opus|aiff?|wma)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|mkv|webm|avi|3gp)$/i;
const IMAGE_EXT = /\.(jpe?g|png|heic|heif|gif|webp|tiff?|bmp)$/i;
export const SONG_FILE_EXT = /\.pitchcruzer$/i;

export const isVideo = (file: FileLike) => /^video\//.test(file.type) || VIDEO_EXT.test(file.name);
export const isAudio = (file: FileLike) => /^audio\//.test(file.type) || AUDIO_EXT.test(file.name);
export const isImage = (file: FileLike) => /^image\//.test(file.type) || IMAGE_EXT.test(file.name);
export const isSongFile = (file: FileLike) => SONG_FILE_EXT.test(file.name);

/**
 * The song among picked/dropped files. Dragging a video (from Photos, a screen-recording preview…)
 * often brings a small preview picture along: pictures are never taken; of the rest, sound/video wins,
 * and the biggest file wins among those.
 */
export function pickSongFile<T extends FileLike>(files: Iterable<T> | null | undefined): T | undefined {
  const list = [...(files ?? [])].filter(file => !isImage(file));
  const media = list.filter(file => isAudio(file) || isVideo(file) || isSongFile(file));
  return (media.length ? media : list).sort((a, b) => b.size - a.size)[0];
}

const MB = 1024 * 1024;

/** Why this file can't be added (plain words), or null if it can be tried. */
export function fileProblem(file: FileLike | undefined): string | null {
  if (!file) return 'That was a picture, not the song. Pick the video or audio file itself.';
  if (isImage(file)) return 'That’s a picture, not the song. Pick the video or audio file itself.';
  if (isSongFile(file)) return null;
  const limit = isVideo(file) ? 1024 : 200;
  if (file.size > limit * MB) return 'That file is over ' + (limit === 1024 ? '1 GB' : '200 MB') + '.';
  if (file.size < 200 * 1024) {
    return '“' + file.name + '” is only ' + Math.max(1, Math.round(file.size / 1024)) + ' KB — too small to be a song. '
      + 'Songs “downloaded” in Spotify or Apple Music are locked to those apps, and a file still in iCloud needs downloading first.';
  }
  return null;
}

/**
 * The song's name from a file name, or '' when the name says nothing about the song (screen
 * recordings and camera files are named by date or number).
 */
export function songNameFromFile(fileName: string): string {
  const name = fileName.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_+/g, ' ').trim();
  const meaningless = /^(recorded song|rpreplay|screen ?recording|img|vid|mov|trim|video|audio|recording|untitled|new recording)\b/i.test(name)
    || /^[\d\s:._-]+$/.test(name)
    || /^screen shot|^screenshot/i.test(name);
  return meaningless ? '' : name;
}
