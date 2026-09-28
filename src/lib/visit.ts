/**
 * This visit: from opening the app in a window or tab until that window is closed. It lives in
 * sessionStorage, which survives reloads, switching tabs or apps, and a phone reclaiming the page from
 * memory — but not closing the window. Takes you haven't saved are kept for the visit (see library).
 */
let fallback: string | null = null;

export function visitId(): string {
  try {
    let id = sessionStorage.getItem('pc.visit');
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('pc.visit', id); }
    return id;
  } catch {
    fallback ??= crypto.randomUUID();
    return fallback;
  }
}

/** A small value kept for this visit (null when storage is unavailable). */
export const visitStore = {
  get(key: string): string | null { try { return sessionStorage.getItem('pc.' + key); } catch { return null; } },
  set(key: string, value: string | null): void {
    try { if (value === null) sessionStorage.removeItem('pc.' + key); else sessionStorage.setItem('pc.' + key, value); } catch { /* unavailable */ }
  }
};

/**
 * Which visits are still open. Each open window marks itself alive every minute (and whenever it's
 * looked at again); a visit not seen for 10 minutes is taken as closed. That way opening the app in a
 * second tab never throws out the takes of a first tab that's still open.
 */
const ALIVE_MS = 10 * 60 * 1000;
const readVisits = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem('pc.visits') ?? '{}'); } catch { return {}; } };

export function markVisitAlive(): void {
  const now = Date.now();
  const visits = Object.fromEntries(Object.entries(readVisits()).filter(([, seen]) => now - seen < 24 * 3600 * 1000));
  visits[visitId()] = now;
  try { localStorage.setItem('pc.visits', JSON.stringify(visits)); } catch { /* unavailable */ }
}

export function openVisits(): Set<string> {
  const now = Date.now();
  const open = new Set(Object.entries(readVisits()).filter(([, seen]) => now - seen < ALIVE_MS).map(([id]) => id));
  open.add(visitId());
  return open;
}
