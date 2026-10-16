import { vi } from 'vitest';
import { createApp } from '../../server/app.mjs';
import { createTokenVerifier } from '../../server/auth.mjs';
import { FakeBackend } from './integration/fakeBackend';

// Runs the real server routing on a random port, with a stateful fake
// Supabase behind it: the admin client is the service role (no row-level
// security), and each user's client acts as that user.

export interface RunningServer {
  url: string;
  backend: FakeBackend;
  /** Bearer token for a user id (accepted by the fake Supabase Auth). */
  tokenFor: (userId: string) => string;
  close: () => Promise<void>;
}

type AppOptions = Parameters<typeof createApp>[0];

export async function startServer(build: (deps: { backend: FakeBackend; admin: ReturnType<FakeBackend['client']>; asUser: (token: string) => ReturnType<FakeBackend['client']> }) => Partial<AppOptions>): Promise<RunningServer> {
  const backend = new FakeBackend();
  const users = new Map<string, string>();
  const tokenFor = (userId: string) => {
    const token = `token-${userId}`;
    users.set(token, userId);
    return token;
  };
  // Supabase Auth's GET /auth/v1/user: 200 with the user for a known token.
  const authFetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const token = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /, '') ?? '';
    const id = users.get(token);
    return new Response(JSON.stringify(id ? { id } : { msg: 'invalid JWT' }), { status: id ? 200 : 401 });
  });
  const admin = backend.client('service');
  const asUser = (token: string) => backend.client({ uid: users.get(token) ?? null });
  const server = createApp({
    distDir: '/nonexistent',
    verifyUser: createTokenVerifier({ supabaseUrl: 'https://supabase.test', apiKey: 'anon', fetchImpl: authFetch as unknown as typeof fetch }),
    log: { error: () => {} },
    ...build({ backend, admin, asUser }),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // The app has no Node type definitions (R17): the address is { port } for a TCP listener.
  const { port } = server.address() as unknown as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    backend,
    tokenFor,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** POST (or GET without a body) as JSON, returning status and parsed body. */
export async function call(url: string, opts: { token?: string; body?: unknown; method?: string } = {}) {
  const res = await fetch(url, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}
