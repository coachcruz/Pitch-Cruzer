/**
 * Every /api/* request goes through here (or requestJson in lalal.ts, which uses the same header).
 * The key is baked in at build time from VITE_PITCH_CRUZER_APP_KEY and must match the
 * PITCH_CRUZER_APP_KEY env var the Netlify functions check. It's a speed bump against drive-by
 * abuse, not a secret — the per-IP quotas on the server do the real damage control.
 */
export function appKeyHeader(): Record<string, string> {
  const key = import.meta.env.VITE_PITCH_CRUZER_APP_KEY as string | undefined;
  return key ? { 'x-app-key': key } : {};
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: { ...appKeyHeader(), ...(init.headers as Record<string, string> | undefined) },
  });
}
