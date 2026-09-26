/** A small activity log shown under "Show details" while a song is prepared, to see where it stalls. */
export interface DiagEntry { at: number; text: string; tone: 'info' | 'ok' | 'warn' | 'error' }

const entries: DiagEntry[] = [];
const listeners = new Set<() => void>();
let startedAt = performance.now();

export function diagReset(): void {
  entries.length = 0;
  startedAt = performance.now();
  listeners.forEach(listener => listener());
}

export function diag(text: string, tone: DiagEntry['tone'] = 'info'): void {
  entries.push({ at: (performance.now() - startedAt) / 1000, text, tone });
  if (entries.length > 300) entries.splice(0, entries.length - 300);
  listeners.forEach(listener => listener());
}

export function diagEntries(): readonly DiagEntry[] { return entries; }

export function onDiag(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
