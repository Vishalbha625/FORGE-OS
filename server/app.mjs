import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { HttpError, readJson, sendJson } from './http.mjs';

// The HTTP server: CORS, routing and the built app. Features plug in as
// handlers, so tests can run the real routing with fakes behind it.
//
//   GET  /api/health                  is the server up, and what is configured
//   POST /api/coach                   AI coach (coach.mjs), COACH_ACCESS_TOKEN
//   GET  /api/push/config             VAPID public key (public)
//   POST /api/push/{subscribe,unsubscribe,send,schedule}   Supabase sign-in
//   GET  /api/strava/{auth-url,activities}, POST /api/strava/{exchange,disconnect}   Supabase sign-in
//   anything else                     the built app from dist/, SPA fallback

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * @typedef {{ userId: string, token: string }} Caller
 * @typedef {{ status: number, body: unknown }} RouteResult
 * @typedef {(caller: Caller, body: Record<string, unknown>, url: URL) => Promise<RouteResult>} Route
 *
 * @param {{
 *   distDir: string,
 *   allowedOrigins?: string[],
 *   accessToken?: string,
 *   health?: () => Record<string, unknown>,
 *   coach?: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>,
 *   verifyUser?: (req: http.IncomingMessage) => Promise<Caller>,
 *   push?: ReturnType<typeof import('./push.mjs').createPush> | null,
 *   pushPublicKey?: string,
 *   strava?: Record<string, Route> | null,
 *   log?: Pick<Console, 'error'>,
 * }} opts
 */
export function createApp(opts) {
  const { distDir, allowedOrigins = [], accessToken = '', log = console } = opts;

  /** CORS headers for this request: only for an allow-listed Origin. */
  function corsHeaders(req) {
    const origin = req.headers.origin;
    if (!origin || !allowedOrigins.includes(origin)) return {};
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '600',
    };
  }

  /** Constant-time check of the coach's Bearer token, when one is configured. */
  function coachAuthorized(req) {
    if (!accessToken) return true;
    const header = req.headers.authorization ?? '';
    const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
    const expected = Buffer.from(accessToken);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /** Signed-in routes: method + path -> handler, and which feature they need. */
  /** @type {Record<string, { feature: 'push' | 'strava', run: Route }>} */
  const routes = {};
  const push = opts.push;
  if (push) {
    routes['POST /api/push/subscribe'] = { feature: 'push', run: (c, b) => push.subscribe(c, b) };
    routes['POST /api/push/unsubscribe'] = { feature: 'push', run: (c, b) => push.unsubscribe(c, b) };
    routes['POST /api/push/send'] = { feature: 'push', run: (c, b) => push.send(c, b) };
    routes['POST /api/push/schedule'] = { feature: 'push', run: (c, b) => push.schedule(c, b) };
  }
  for (const [key, run] of Object.entries(opts.strava ?? {})) routes[key] = { feature: 'strava', run };
  const knownPaths = new Set([
    '/api/push/subscribe', '/api/push/unsubscribe', '/api/push/send', '/api/push/schedule',
    '/api/strava/auth-url', '/api/strava/exchange', '/api/strava/activities', '/api/strava/disconnect',
  ]);

  async function handleSignedIn(req, res, url) {
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) {
      const exists = Object.keys(routes).some((k) => k.endsWith(` ${url.pathname}`));
      if (exists) return sendJson(res, 405, { error: 'Method not allowed.' });
      const feature = url.pathname.startsWith('/api/push/') ? 'Push notifications are' : 'Strava import is';
      return sendJson(res, 503, { error: `${feature} not set up on this server.` });
    }
    if (!opts.verifyUser) return sendJson(res, 503, { error: 'Community sign-in is not set up on this server.' });
    try {
      const caller = await opts.verifyUser(req);
      const body = req.method === 'POST' ? await readJson(req) : {};
      const result = await route.run(caller, body, url);
      return sendJson(res, result.status, result.body);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      log.error('[api] unexpected error:', err?.message ?? err);
      return sendJson(res, 500, { error: 'Something went wrong on the server.' });
    }
  }

  async function serveStatic(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end('Bad path');
      return;
    }
    // Resolve inside dist/ only, which blocks ../ traversal.
    let file = path.resolve(distDir, '.' + rel);
    if (!file.startsWith(distDir + path.sep) && file !== distDir) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const st = await stat(file);
      if (st.isDirectory()) file = path.join(file, 'index.html');
    } catch {
      // Unknown path without an extension → SPA route → index.html
      if (path.extname(file)) {
        res.writeHead(404).end('Not found');
        return;
      }
      file = path.join(distDir, 'index.html');
    }
    try {
      const body = await readFile(file);
      const ext = path.extname(file);
      const immutable = rel.startsWith('/assets/');
      res.writeHead(200, {
        'content-type': MIME[ext] ?? 'application/octet-stream',
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Build not found. Run `npm run build` first (or use `npm start`).');
    }
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    // Baseline hardening and CORS on every response (writeHead merges these with its own headers).
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (allowedOrigins.length) res.setHeader('Vary', 'Origin');
    for (const [k, v] of Object.entries(corsHeaders(req))) res.setHeader(k, v);

    // Preflight. Allowed origins get the headers above; others get none, so the browser blocks them.
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/api/health' && req.method === 'GET') return sendJson(res, 200, { ok: true, ...(opts.health?.() ?? {}) });
    if (url.pathname === '/api/coach') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST.' });
      if (!coachAuthorized(req)) return sendJson(res, 401, { error: 'Access token missing or wrong. Enter it in Profile, AI coach.' });
      if (!opts.coach) return sendJson(res, 503, { error: 'Coach server is not configured.' });
      return opts.coach(req, res);
    }
    if (url.pathname === '/api/push/config' && req.method === 'GET') {
      return sendJson(res, 200, { enabled: Boolean(push && opts.pushPublicKey), publicKey: push ? opts.pushPublicKey ?? null : null });
    }
    if (knownPaths.has(url.pathname)) return handleSignedIn(req, res, url);
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' });
    return serveStatic(req, res);
  });
}
