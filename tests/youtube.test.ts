import { describe, expect, it } from 'vitest';
import { referenceEmbedUrl, youtubeId } from '../src/lib/youtube';

const ID = 'dQw4w9WgXcQ';

describe('youtubeId', () => {
  it('reads a watch URL, ignoring extra params', () => {
    expect(youtubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(youtubeId(`https://www.youtube.com/watch?v=${ID}&t=42s&list=abc`)).toBe(ID);
    expect(youtubeId(`https://youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(youtubeId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(youtubeId(`https://music.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('reads youtu.be, shorts, embed and live links', () => {
    expect(youtubeId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(youtubeId(`https://www.youtu.be/${ID}?si=xyz`)).toBe(ID);
    expect(youtubeId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(youtubeId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
    expect(youtubeId(`https://www.youtube.com/live/${ID}`)).toBe(ID);
    expect(youtubeId(`https://www.youtube-nocookie.com/embed/${ID}`)).toBe(ID);
  });

  it('tolerates surrounding whitespace', () => {
    expect(youtubeId(`  https://youtu.be/${ID} \n`)).toBe(ID);
  });

  it('rejects non-YouTube links and garbage', () => {
    expect(youtubeId('https://vimeo.com/12345')).toBeNull();
    expect(youtubeId('https://www.youtube.com/')).toBeNull();
    expect(youtubeId('https://www.youtube.com/watch')).toBeNull();
    expect(youtubeId('not a link')).toBeNull();
    expect(youtubeId('')).toBeNull();
    expect(youtubeId(`https://www.youtube.com/watch?v=short`)).toBeNull();
    expect(youtubeId(`https://www.youtube.com/watch?v=${ID}toolong`)).toBeNull();
    expect(youtubeId('https://fakeyoutube.com/watch?v=' + ID)).toBeNull();
  });
});

describe('referenceEmbedUrl', () => {
  it('builds the privacy-enhanced embed URL with no related videos', () => {
    const url = referenceEmbedUrl(ID);
    expect(url).toBe(`https://www.youtube-nocookie.com/embed/${ID}?rel=0`);
    expect(url).not.toContain('autoplay');
  });

  it('refuses anything that is not an 11-char video id', () => {
    expect(() => referenceEmbedUrl('short')).toThrow();
    expect(() => referenceEmbedUrl('')).toThrow();
    expect(() => referenceEmbedUrl('https://youtu.be/' + ID)).toThrow();
    expect(() => referenceEmbedUrl(ID + 'X')).toThrow();
  });
});
