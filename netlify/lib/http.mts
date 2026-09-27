declare const Netlify: { env: { get(name: string): string | undefined } };

/** Shared helpers for every function: JSON responses and environment variables. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function env(name: string): string | null {
  return Netlify.env.get(name) || null;
}
