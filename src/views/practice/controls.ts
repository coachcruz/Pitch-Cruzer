import { prefs } from '../../ui/dom';

/**
 * The practice controls float over the stage as a small pill that can be dragged anywhere (by its
 * grip, with a mouse, finger or pen). Its spot is remembered as a fraction of the stage, so it stays
 * in the same place when the window is resized. The settings panel opens from the pill — above it
 * when the pill sits low, below it when it sits high.
 */
export function floatingControls(pill: HTMLElement, stage: HTMLElement, grip: HTMLElement, panel: HTMLElement): () => void {
  let spot = prefs.get<{ x: number; y: number }>('controls.spot', { x: 0.5, y: 0.94 });

  const place = () => {
    const width = stage.clientWidth, height = stage.clientHeight;
    const w = pill.offsetWidth, h = pill.offsetHeight;
    const left = Math.max(4, Math.min(width - w - 4, spot.x * width - w / 2));
    const top = Math.max(4, Math.min(height - h - 4, spot.y * height - h / 2));
    pill.style.left = left + 'px';
    pill.style.top = top + 'px';
    // Open the settings toward the roomier side, and keep them inside the stage.
    const below = top + h / 2 < height / 2;
    panel.classList.toggle('below', below);
    panel.style.maxHeight = Math.max(160, (below ? height - top - h : top) - 16) + 'px';
  };

  let drag: { id: number; dx: number; dy: number } | null = null;
  grip.addEventListener('pointerdown', event => {
    event.preventDefault();
    const rect = pill.getBoundingClientRect();
    drag = { id: event.pointerId, dx: event.clientX - (rect.left + rect.width / 2), dy: event.clientY - (rect.top + rect.height / 2) };
    grip.setPointerCapture(event.pointerId);
    pill.classList.add('dragging');
  });
  grip.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const box = stage.getBoundingClientRect();
    spot = {
      x: Math.max(0, Math.min(1, (event.clientX - drag.dx - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (event.clientY - drag.dy - box.top) / box.height))
    };
    place();
  });
  const drop = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    pill.classList.remove('dragging');
    prefs.set('controls.spot', spot);
  };
  grip.addEventListener('pointerup', drop);
  grip.addEventListener('pointercancel', drop);
  // Keyboard: arrow keys nudge the pill.
  grip.addEventListener('keydown', event => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    spot = { x: Math.max(0, Math.min(1, spot.x + move[0])), y: Math.max(0, Math.min(1, spot.y + move[1])) };
    place();
    prefs.set('controls.spot', spot);
  });

  const observer = new ResizeObserver(place);
  observer.observe(stage);
  observer.observe(pill);
  place();
  return () => observer.disconnect();
}
