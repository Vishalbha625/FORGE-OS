import { describe, it, expect, vi, afterEach } from 'vitest';
import { getSupabase, isSupabaseConfigured, resetSupabaseClient } from '../lib/supabase';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetSupabaseClient();
});

describe('supabase client', () => {
  it('returns null and warns once when env vars are missing, without throwing', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(isSupabaseConfigured()).toBe(false);
    expect(getSupabase()).toBeNull();
    expect(getSupabase()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('creates one shared client when configured', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key');
    expect(isSupabaseConfigured()).toBe(true);
    const client = getSupabase();
    expect(client).not.toBeNull();
    expect(getSupabase()).toBe(client);
  });
});
