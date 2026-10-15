import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase } from '../lib/supabase';
import { getSession } from '../lib/authService';

// Community sign-in state. Health features never depend on it.

export interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAuthenticated: boolean;
  isSupabaseAvailable: boolean;
}

interface AuthContextValue extends AuthState {
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const isSupabaseAvailable = getSupabase() !== null;
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseAvailable);

  useEffect(() => {
    const client = getSupabase();
    if (!client) {
      setLoading(false);
      return;
    }
    let active = true;
    getSession().then((res) => {
      if (!active) return;
      setSession(res.session ?? null);
      setLoading(false);
    });
    const { data } = client.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      setLoading(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const refreshSession = async () => {
      const client = getSupabase();
      if (!client) return;
      const { data, error } = await client.auth.refreshSession();
      if (!error) setSession(data.session);
    };
    return {
      user: session?.user ?? null,
      session,
      loading,
      isAuthenticated: session !== null,
      isSupabaseAvailable,
      refreshSession,
    };
  }, [session, loading, isSupabaseAvailable]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider.');
  return ctx;
}
