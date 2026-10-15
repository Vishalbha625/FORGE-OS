import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { sanitizeDisplayName } from './sanitize';

// Community accounts only. Signing in or out never reads, sends or deletes the
// health data in IndexedDB: that stays on the device whatever happens here.

export interface AuthResult {
  success: boolean;
  user?: User | null;
  session?: Session | null;
  error?: string;
}

export const NOT_CONFIGURED = 'Community features are not configured.';
const notConfigured: AuthResult = { success: false, error: NOT_CONFIGURED };

export interface PasswordChecks {
  length: boolean;
  letter: boolean;
  number: boolean;
}

export function checkPassword(password: string): PasswordChecks {
  return {
    length: password.length >= 8,
    letter: /\p{L}/u.test(password),
    number: /\d/.test(password),
  };
}

export const isPasswordValid = (password: string): boolean => Object.values(checkPassword(password)).every(Boolean);

const normalizeEmail = (email: string) => email.trim().toLowerCase();

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Something went wrong. Please try again.';
}

/** Turn a raw Supabase auth error into a sentence a person can act on. */
export function mapAuthError(error: unknown): string {
  const raw = errorMessage(error);
  const msg = raw.toLowerCase();
  if (msg.includes('already registered') || msg.includes('already exists')) return 'This email is already registered. Try signing in instead.';
  if (msg.includes('invalid login') || msg.includes('invalid credentials')) return 'Incorrect email or password.';
  if (msg.includes('email not confirmed')) return 'Please check your email to confirm your account.';
  if (msg.includes('too many requests') || msg.includes('rate limit')) return 'Too many attempts. Please wait a minute and try again.';
  if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('fetch failed') || msg.includes('load failed')) {
    return 'Network error. Check your connection and try again.';
  }
  return raw;
}

/**
 * Make sure the signed-in user has a public profile row. Needs a session
 * (RLS: id = auth.uid()), so with email confirmation on it runs at first
 * sign-in rather than at sign-up. Never throws: a missing row is retried
 * at the next sign-in.
 */
export async function ensureProfile(client: SupabaseClient, user: User): Promise<void> {
  const meta = user.user_metadata as { display_name?: unknown; full_name?: unknown; name?: unknown } | undefined;
  const fromMeta = sanitizeDisplayName(meta?.display_name ?? meta?.full_name ?? meta?.name);
  const displayName = fromMeta || sanitizeDisplayName(user.email?.split('@')[0]) || 'Athlete';
  const { error } = await client
    .from('profiles')
    .upsert({ id: user.id, display_name: displayName }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) console.error('Could not create the community profile.', error);
}

export async function signUpWithEmail(email: string, password: string, displayName: string): Promise<AuthResult> {
  const name = sanitizeDisplayName(displayName);
  if (!name) return { success: false, error: 'Please enter your name.' };
  const checks = checkPassword(password);
  if (!checks.length) return { success: false, error: 'Password must be at least 8 characters.' };
  if (!checks.letter || !checks.number) return { success: false, error: 'Password must contain both letters and numbers.' };

  const client = getSupabase();
  if (!client) return notConfigured;
  try {
    const { data, error } = await client.auth.signUp({
      email: normalizeEmail(email),
      password,
      options: { data: { display_name: name }, emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) return { success: false, error: mapAuthError(error) };
    if (data.user && data.session) {
      // Non-blocking: the account exists even if this insert fails.
      ensureProfile(client, data.user).catch((err) => console.error('Could not create the community profile.', err));
    }
    return { success: true, user: data.user, session: data.session };
  } catch (err) {
    return { success: false, error: mapAuthError(err) };
  }
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  const client = getSupabase();
  if (!client) return notConfigured;
  try {
    const { data, error } = await client.auth.signInWithPassword({ email: normalizeEmail(email), password });
    if (error) return { success: false, error: mapAuthError(error) };
    // Covers accounts that confirmed their email after signing up.
    ensureProfile(client, data.user).catch((err) => console.error('Could not create the community profile.', err));
    return { success: true, user: data.user, session: data.session };
  } catch (err) {
    return { success: false, error: mapAuthError(err) };
  }
}

/** Starts the Google redirect. On success the browser leaves the app. */
export async function signInWithGoogle(): Promise<AuthResult> {
  const client = getSupabase();
  if (!client) return notConfigured;
  try {
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) return { success: false, error: mapAuthError(error) };
    return { success: true };
  } catch (err) {
    return { success: false, error: mapAuthError(err) };
  }
}

/**
 * Ends the community session only. NEVER clear IndexedDB here: the athlete's
 * health data belongs to them and stays on this device after signing out (R1).
 */
export async function signOut(): Promise<AuthResult> {
  const client = getSupabase();
  if (!client) return notConfigured;
  try {
    const { error } = await client.auth.signOut();
    if (error) return { success: false, error: mapAuthError(error) };
    return { success: true, user: null, session: null };
  } catch (err) {
    return { success: false, error: mapAuthError(err) };
  }
}

export async function resetPassword(email: string): Promise<AuthResult> {
  const client = getSupabase();
  if (!client) return notConfigured;
  try {
    const { error } = await client.auth.resetPasswordForEmail(normalizeEmail(email), {
      redirectTo: `${window.location.origin}/auth/reset`,
    });
    if (error) return { success: false, error: mapAuthError(error) };
    return { success: true };
  } catch (err) {
    return { success: false, error: mapAuthError(err) };
  }
}

/** Sets a new password for the signed-in user (the reset link signs them in). */
export async function updatePassword(password: string): Promise<AuthResult> {
  if (!isPasswordValid(password)) return { success: false, error: 'Password must be at least 8 characters with letters and numbers.' };
  const client = getSupabase();
  if (!client) return notConfigured;
  try {
    const { data, error } = await client.auth.updateUser({ password });
    if (error) return { success: false, error: mapAuthError(error) };
    return { success: true, user: data.user };
  } catch (err) {
    return { success: false, error: mapAuthError(err) };
  }
}

export async function getSession(): Promise<AuthResult> {
  const client = getSupabase();
  if (!client) return { ...notConfigured, user: null, session: null };
  try {
    const { data, error } = await client.auth.getSession();
    if (error) return { success: false, user: null, session: null, error: mapAuthError(error) };
    return { success: true, user: data.session?.user ?? null, session: data.session };
  } catch (err) {
    return { success: false, user: null, session: null, error: mapAuthError(err) };
  }
}

/** Fired on window when this device gets a community account, so the local profile can record its id. */
export const AUTH_LINKED_EVENT = 'forge:auth-linked';
export interface AuthLinkedDetail {
  supabaseUserId: string;
}

export function notifyAuthLinked(supabaseUserId: string): void {
  window.dispatchEvent(new CustomEvent<AuthLinkedDetail>(AUTH_LINKED_EVENT, { detail: { supabaseUserId } }));
}
