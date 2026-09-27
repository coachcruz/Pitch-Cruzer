import { describe, expect, it } from 'vitest';
import { fileProblem, pickSongFile, songNameFromFile } from '../src/lib/songFile';

const MB = 1024 * 1024;
const file = (name: string, type: string, size: number) => ({ name, type, size });

describe('picking the song file', () => {
  it('takes the video, not the preview picture that comes along when dragging', () => {
    const preview = file('Screen Recording.jpg', 'image/jpeg', 100 * 1024);
    const video = file('Screen Recording.mov', 'video/quicktime', 180 * MB);
    expect(pickSongFile([preview, video])).toBe(video);
    expect(pickSongFile([video, preview])).toBe(video);
  });
  it('never takes a picture, even alone', () => {
    expect(pickSongFile([file('cover.png', 'image/png', 2 * MB)])).toBeUndefined();
    expect(fileProblem(undefined)).toMatch(/picture/);
  });
  it('takes audio even with no type (some browsers leave it empty)', () => {
    const song = file('song.m4a', '', 6 * MB);
    expect(pickSongFile([song])).toBe(song);
  });
});

describe('checking the file', () => {
  it('a 0.1 MB "song" is refused with the reason', () => {
    expect(fileProblem(file('Song.m4a', 'audio/mp4', 100 * 1024))).toMatch(/too small/);
  });
  it('a normal song or a big screen recording is fine', () => {
    expect(fileProblem(file('Song.mp3', 'audio/mpeg', 6 * MB))).toBeNull();
    expect(fileProblem(file('RPReplay_Final1695.MP4', 'video/mp4', 600 * MB))).toBeNull();
  });
  it('too big is refused', () => {
    expect(fileProblem(file('Song.wav', 'audio/wav', 300 * MB))).toMatch(/200 MB/);
    expect(fileProblem(file('Movie.mov', 'video/quicktime', 2000 * MB))).toMatch(/1 GB/);
  });
  it('a saved Pitch Cruzer song is always accepted', () => {
    expect(fileProblem(file('My Song.pitchcruzer', '', 20 * 1024))).toBeNull();
  });
});

describe('the song name from a file name', () => {
  it('keeps real names', () => {
    expect(songNameFromFile('Kid Rock - Picture.mp3')).toBe('Kid Rock - Picture');
    expect(songNameFromFile('my_song_final.wav')).toBe('my song final');
  });
  it('ignores names that are just dates or numbers', () => {
    for (const name of ['RPReplay_Final1695846123.MP4', 'ScreenRecording_09-27-2026 21-03-11_1.MP4', 'Screen Recording 2026-09-27 at 9.03.11 PM.mov',
      'IMG_1234.MOV', 'VID_20260927.mp4', '20260927_210311.mp4', 'Recorded song 9/27/2026.wav', 'New Recording 12.m4a']) {
      expect(songNameFromFile(name), name).toBe('');
    }
  });
});
