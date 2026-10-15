import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Supabase is used for the community only. Health data never goes through it.
// The anon key is public by design; Row Level Security enforces access.

let client: SupabaseClient | null = null;
let warned = false;

function readEnv(): { url: string; anonKey: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  return url && anonKey ? { url, anonKey } : null;
}

export function isSupabaseConfigured(): boolean {
  return readEnv() !== null;
}

/** The shared client, created on first use. Null when the env vars are missing. */
export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  const env = readEnv();
  if (!env) {
    if (!warned) {
      console.warn('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Community features stay offline.');
      warned = true;
    }
    return null;
  }
  try {
    client = createClient(env.url, env.anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
        flowType: 'pkce',
        detectSessionInUrl: true,
      },
      global: { headers: { 'x-client-info': 'forge-os-pwa/1.0' } },
      // One retry policy, ours (retry.ts + circuitBreaker.ts): the built-in one
      // would retry reads for ~7 s before the feed could fall back to its cache.
      // The timeout stops a stalled connection from hanging a request forever.
      db: { retry: false, timeout: 15_000 },
    });
  } catch (err) {
    // A malformed URL must not take the app down.
    console.warn('Supabase client could not be created.', err);
    return null;
  }
  return client;
}

/** Test helper: forget the cached client. */
export function resetSupabaseClient(): void {
  client = null;
  warned = false;
}
