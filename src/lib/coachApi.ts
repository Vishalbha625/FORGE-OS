import type { Settings } from '../db/types';

// Where the coach server lives. Same origin by default (`npm start` serves both);
// set VITE_COACH_URL at build time, or a URL in Profile, when the app is on Vercel
// and the server is on Render. The Profile value wins so you can change it without
// a rebuild.

const normalize = (u: string) => u.trim().replace(/\/+$/, '');

export function coachBaseUrl(settings: Settings | null): string {
  return normalize(settings?.coachUrl || import.meta.env.VITE_COACH_URL || '');
}

/** fetch() against the coach server, adding the access token when one is saved. */
export function coachFetch(settings: Settings | null, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (settings?.coachToken) headers.set('Authorization', `Bearer ${settings.coachToken}`);
  return fetch(`${coachBaseUrl(settings)}${path}`, { ...init, headers });
}
