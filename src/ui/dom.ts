export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

export function el<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error('Missing element ' + selector);
  return found;
}

export function toast(message: string, tone: 'info' | 'error' = 'info'): void {
  const node = document.createElement('div');
  node.className = 'toast toast-' + tone;
  node.setAttribute('role', 'status');
  node.textContent = message;
  document.body.appendChild(node);
  window.setTimeout(() => node.classList.add('toast-out'), 3800);
  window.setTimeout(() => node.remove(), 4300);
}

export const prefs = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem('pc.' + key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch { return fallback; }
  },
  set(key: string, value: unknown): void {
    try { localStorage.setItem('pc.' + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }
};
