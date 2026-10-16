import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn() }));

import { getSupabase } from '../lib/supabase';
import {
  signUpWithEmail, signInWithEmail, signOut, updatePassword, mapAuthError, notifyAuthLinked, AUTH_LINKED_EVENT,
} from '../lib/authService';
import { returnPath } from '../features/auth/AuthShell';

const mockedGetSupabase = vi.mocked(getSupabase);
const user = { id: 'user-1', email: 'vishal@example.com', user_metadata: { display_name: 'Vishal' } };

function fakeClient() {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const client = {
    auth: {
      signUp: vi.fn().mockResolvedValue({ data: { user, session: { user } }, error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ data: { user, session: { user } }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn(() => ({ upsert })),
  };
  mockedGetSupabase.mockReturnValue(client as unknown as SupabaseClient);
  return { client, upsert };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetSupabase.mockReturnValue(null);
  vi.stubGlobal('window', { location: { origin: 'https://forge.test' }, dispatchEvent: vi.fn() });
});

describe('authService', () => {
  it('rejects a password shorter than 8 characters', async () => {
    const { client } = fakeClient();
    expect(await signUpWithEmail('a@b.co', 'abc123', 'Vishal')).toEqual({ success: false, error: 'Password must be at least 8 characters.' });
    expect(client.auth.signUp).not.toHaveBeenCalled();
  });

  it('rejects a password without numbers', async () => {
    const { client } = fakeClient();
    const res = await signUpWithEmail('a@b.co', 'lettersonly', 'Vishal');
    expect(res).toEqual({ success: false, error: 'Password must contain both letters and numbers.' });
    expect(client.auth.signUp).not.toHaveBeenCalled();
  });

  it('rejects an empty or whitespace-only display name', async () => {
    fakeClient();
    expect((await signUpWithEmail('a@b.co', 'abcd1234', '')).success).toBe(false);
    expect(await signUpWithEmail('a@b.co', 'abcd1234', '   ')).toEqual({ success: false, error: 'Please enter your name.' });
  });

  it('reports "not configured" when Supabase is missing', async () => {
    const expected = { success: false, error: 'Community features are not configured.' };
    expect(await signUpWithEmail('a@b.co', 'abcd1234', 'Vishal')).toEqual(expected);
    expect(await signInWithEmail('a@b.co', 'abcd1234')).toEqual(expected);
    expect(await signOut()).toEqual(expected);
  });

  it('signs up, normalises the email, stores the name and creates the profile row', async () => {
    const { client, upsert } = fakeClient();
    const res = await signUpWithEmail('  Vishal@Example.COM ', 'abcd1234', '  Vishal  ');
    expect(res).toMatchObject({ success: true, user: { id: 'user-1' } });
    expect(client.auth.signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: 'vishal@example.com',
      options: expect.objectContaining({ data: { display_name: 'Vishal' } }),
    }));
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledWith({ id: 'user-1', display_name: 'Vishal' }, { onConflict: 'id', ignoreDuplicates: true }));
  });

  it('maps "Invalid login credentials" to a friendly message', () => {
    expect(mapAuthError({ message: 'Invalid login credentials' })).toBe('Incorrect email or password.');
    expect(mapAuthError(new Error('User already registered'))).toBe('This email is already registered. Try signing in instead.');
    expect(mapAuthError(new TypeError('Failed to fetch'))).toBe('Network error. Check your connection and try again.');
    expect(mapAuthError({ message: 'Something odd' })).toBe('Something odd');
  });

  it('a failed profile insert does not fail the sign-up', async () => {
    const { upsert } = fakeClient();
    upsert.mockResolvedValue({ error: { message: 'permission denied' } });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await signUpWithEmail('a@b.co', 'abcd1234', 'Vishal')).success).toBe(true);
    await vi.waitFor(() => expect(err).toHaveBeenCalled());
    err.mockRestore();
  });

  it('sign out only ends the Supabase session and never touches IndexedDB', async () => {
    const { client } = fakeClient();
    const idb = { open: vi.fn(), deleteDatabase: vi.fn() };
    vi.stubGlobal('indexedDB', idb);
    expect(await signOut()).toMatchObject({ success: true });
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
    expect(idb.open).not.toHaveBeenCalled();
    expect(idb.deleteDatabase).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('validates a new password before updating it', async () => {
    const { client } = fakeClient();
    expect((await updatePassword('short1')).success).toBe(false);
    expect(client.auth.updateUser).not.toHaveBeenCalled();
    expect((await updatePassword('newpass123')).success).toBe(true);
  });

  it('announces a linked account with the user id', () => {
    const dispatch = vi.fn();
    vi.stubGlobal('window', { dispatchEvent: dispatch });
    notifyAuthLinked('user-1');
    const event = dispatch.mock.calls[0][0] as CustomEvent<{ supabaseUserId: string }>;
    expect(event.type).toBe(AUTH_LINKED_EVENT);
    expect(event.detail).toEqual({ supabaseUserId: 'user-1' });
  });
});

describe('returnPath (where sign-in goes back to)', () => {
  const at = (from: unknown) => returnPath({ state: { from } });
  it('goes back to a page on this site', () => {
    expect(at('/community/post/abc?x=1')).toBe('/community/post/abc?x=1');
    expect(returnPath({ state: null })).toBe('/');
  });
  it('never leaves the site, even through backslashes or control characters', () => {
    for (const evil of ['//evil.com', '/\\evil.com', '/\\\\evil.com', '/\t/evil.com', 'https://evil.com', 'evil.com', 42]) expect(at(evil)).toBe('/');
  });
});
