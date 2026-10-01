/**
 * Find a song on YouTube and play it inside the app (YouTube's official embedded player), so it can
 * be played, paused, restarted and recorded without leaving the page.
 */
import { apiFetch } from './api';
export interface VideoResult { id: string; title: string; channel: string; thumbnail: string }

let searchAvailable: Promise<boolean> | null = null;

/** Is in-app YouTube search set up (YOUTUBE_API_KEY on Netlify)? */
export function youtubeSearchAvailable(): Promise<boolean> {
  searchAvailable ??= apiFetch('/api/youtube', { signal: AbortSignal.timeout(8000) })
    .then(response => (response.ok ? response.json() : { available: false }))
    .then((body: { available?: boolean }) => Boolean(body.available))
    .catch(() => false);
  return searchAvailable;
}

export async function searchYouTube(query: string): Promise<VideoResult[]> {
  const response = await apiFetch('/api/youtube?q=' + encodeURIComponent(query), { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('YouTube search is unavailable right now.');
  return response.json();
}

/** The video id in any YouTube link (watch, youtu.be, shorts, embed, music.youtube.com), or null. */
export function youtubeId(value: string): string | null {  try {
    const url = new URL(value.trim());
    const host = url.hostname.replace(/^(www|m|music)\./, '');
    if (host === 'youtu.be') return url.pathname.slice(1, 12) || null;
    if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
    const id = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1];
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * "Artist - Song (Official Music Video) [HD]" → "Artist - Song": video titles carry extras that stop a
 * lyrics search from matching.
 */
export function cleanSongTitle(title: string): string {
  return title
    .replace(/[([][^)\]]*(official|video|audio|lyrics?|visuali[sz]er|hd|4k|remaster|live|mv|m\/v)[^)\]]*[)\]]/gi, ' ')
    .replace(/\s*[|｜].*$/, '')
    .replace(/\b(official (music )?video|lyric video|official audio)\b/gi, ' ')
    .replace(/\s+[-–]?\s*lyrics?\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Privacy-enhanced embed URL for a reference video: YouTube's no-cookie player, no autoplay,
 * and no related videos from other channels (rel=0). The id is validated to YouTube's 11-char
 * format first, so it interpolates safely. Reference-only: the app never downloads from it.
 */
export function referenceEmbedUrl(videoId: string): string {
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Not a YouTube video id.');
  return 'https://www.youtube-nocookie.com/embed/' + videoId + '?rel=0';
}

// ---------------------------------------------------------------- embedded player (IFrame Player API)

interface YTPlayer {
  playVideo(): void; pauseVideo(): void; seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number; getDuration(): number; getPlayerState(): number;
  getVideoData(): { title?: string; author?: string }; destroy(): void;
}
declare global {
  interface Window {
    YT?: { Player: new (element: HTMLElement | string, options: object) => YTPlayer; PlayerState: Record<string, number> };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiReady: Promise<void> | null = null;
function loadApi(): Promise<void> {
  apiReady ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) { resolve(); return; }
    window.onYouTubeIframeAPIReady = () => resolve();
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { apiReady = null; reject(new Error('YouTube’s player could not be loaded.')); };
    document.head.appendChild(script);
  });
  return apiReady;
}

export type PlayerStatus = 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued';
const STATUS: Record<number, PlayerStatus> = { [-1]: 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued' };

export class EmbeddedVideo {
  private player: YTPlayer | null = null;
  status: PlayerStatus = 'unstarted';
  onStatus: ((status: PlayerStatus) => void) | null = null;

  /** Puts the player for `videoId` inside `host` and resolves when it can be controlled. */
  async mount(host: HTMLElement, videoId: string): Promise<void> {
    await loadApi();
    this.destroy();
    host.innerHTML = '<div></div>';
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('The YouTube player didn’t start. Check your connection and try again.')), 20000);
      this.player = new window.YT!.Player(host.firstElementChild as HTMLElement, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => { window.clearTimeout(timer); resolve(); },
          onStateChange: (event: { data: number }) => {
            this.status = STATUS[event.data] ?? this.status;
            this.onStatus?.(this.status);
          },
          onError: () => { window.clearTimeout(timer); reject(new Error('This video can’t be played inside other sites. Pick another result.')); }
        }
      });
    });
  }

  play(): void { this.player?.playVideo(); }
  pause(): void { this.player?.pauseVideo(); }
  restart(): void { this.player?.seekTo(0, true); this.player?.playVideo(); }
  get time(): number { return this.player?.getCurrentTime() ?? 0; }
  get duration(): number { return this.player?.getDuration() ?? 0; }
  get title(): string { return this.player?.getVideoData().title ?? ''; }

  destroy(): void {
    this.player?.destroy();
    this.player = null;
    this.status = 'unstarted';
  }
}
