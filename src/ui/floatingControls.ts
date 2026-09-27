/**
 * A small always-on-top window (Document Picture-in-Picture, Chrome/Edge 116+) with the recorder's
 * controls and a live view of the song's tab — so you can press Record/Stop while you're in Spotify,
 * Apple Music or any other tab, without switching back. Closing it ends the session (the caller
 * decides what that means: stop, stop sharing, close the song tab).
 */
export interface FloatingActions { record(): void; stop(): void; restart(): void; closed(): void }
export interface FloatingState { recording: boolean; seconds: number; level: number; title: string }

interface DocumentPiP { requestWindow(options: { width: number; height: number }): Promise<Window>; window: Window | null }
const pipApi = () => (window as unknown as { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture;

export class FloatingControls {
  private win: Window | null = null;

  static supported(): boolean { return Boolean(pipApi()); }
  get isOpen(): boolean { return this.win !== null && !this.win.closed; }

  /** Opens the window (needs a recent click). Returns false if the browser refused. */
  async open(video: MediaStream | null, actions: FloatingActions): Promise<boolean> {
    const api = pipApi();
    if (!api) return false;
    if (this.isOpen) return true;
    let win: Window;
    try { win = await api.requestWindow({ width: 340, height: video ? 330 : 150 }); } catch { return false; }
    this.win = win;
    // Same look as the app: copy its stylesheets into the floating window.
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach(node => win.document.head.appendChild(node.cloneNode(true)));
    win.document.body.className = 'floating';
    win.document.body.innerHTML = `
      ${video ? '<video id="fVideo" muted playsinline autoplay></video>' : ''}
      <strong id="fTitle" class="fTitle"></strong>
      <div class="fRow">
        <button id="fRecord" class="btn record">● Record</button>
        <button id="fStop" class="btn danger">■ Stop</button>
        <button id="fRestart" class="btn ghost" title="Throw away this take and start over">↺</button>
        <span id="fTime" class="mono">0:00</span>
      </div>
      <div class="vu"><span id="fMeter"></span></div>`;
    const videoEl = win.document.getElementById('fVideo') as HTMLVideoElement | null;
    if (videoEl && video) { videoEl.srcObject = video; void videoEl.play().catch(() => undefined); }
    win.document.getElementById('fRecord')!.addEventListener('click', () => actions.record());
    win.document.getElementById('fStop')!.addEventListener('click', () => actions.stop());
    win.document.getElementById('fRestart')!.addEventListener('click', () => actions.restart());
    win.addEventListener('pagehide', () => { this.win = null; actions.closed(); });
    return true;
  }

  update(state: FloatingState): void {
    const doc = this.isOpen ? this.win!.document : null;
    if (!doc) return;
    doc.getElementById('fTitle')!.textContent = state.title;
    doc.getElementById('fRecord')!.classList.toggle('hidden', state.recording);
    doc.getElementById('fStop')!.classList.toggle('hidden', !state.recording);
    const minutes = Math.floor(state.seconds / 60), seconds = Math.floor(state.seconds % 60);
    doc.getElementById('fTime')!.textContent = minutes + ':' + String(seconds).padStart(2, '0');
    doc.getElementById('fMeter')!.style.width = Math.round(state.level * 100) + '%';
  }

  close(): void {
    this.win?.close();
    this.win = null;
  }
}
