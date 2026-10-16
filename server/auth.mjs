import { HttpError } from './http.mjs';

// Who is calling: the community account behind a Supabase access token.
// The same check as supabase-js auth.getUser(token): Supabase Auth itself
// says whether the token is valid (signature, expiry, sign-out), so a revoked
// session stops working here too. Verified tokens are remembered briefly so a
// burst of requests costs one lookup.

const CACHE_MS = 60_000;
const CACHE_MAX = 500;

/**
 * @param {{ supabaseUrl: string, apiKey: string, fetchImpl?: typeof fetch, now?: () => number }} opts
 * @returns {(req: import('node:http').IncomingMessage) => Promise<{ userId: string, token: string }>}
 */
export function createTokenVerifier({ supabaseUrl, apiKey, fetchImpl = fetch, now = Date.now }) {
  /** @type {Map<string, { userId: string, until: number }>} */
  const cache = new Map();

  return async function verifySupabaseToken(req) {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new HttpError(401, 'Sign in to the community first.');
    if (!supabaseUrl || !apiKey) throw new HttpError(503, 'Community sign-in is not set up on this server.');

    const hit = cache.get(token);
    if (hit && hit.until > now()) return { userId: hit.userId, token };

    let res;
    try {
      res = await fetchImpl(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`, { headers: { apikey: apiKey, Authorization: `Bearer ${token}` } });
    } catch {
      throw new HttpError(503, 'Could not reach community sign-in. Try again shortly.');
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(401, 'Your session has expired. Sign in again.');
    if (!res.ok) throw new HttpError(503, 'Community sign-in is unavailable right now.');
    const user = await res.json().catch(() => null);
    if (!user || typeof user.id !== 'string') throw new HttpError(401, 'Your session has expired. Sign in again.');

    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(token, { userId: user.id, until: now() + CACHE_MS });
    return { userId: user.id, token };
  };
}
