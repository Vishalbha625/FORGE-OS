import { useMemo } from 'react';
import { useAuth } from '../store/AuthContext';
import { useApp } from '../store/AppContext';
import { coachBaseUrl } from '../lib/coachApi';
import type { PushApi } from '../lib/pushService';

/** Where and as whom to talk to the push server; null when not signed in. */
export function usePushApi(): PushApi | null {
  const { session } = useAuth();
  const { settings } = useApp();
  const token = session?.access_token;
  const baseUrl = coachBaseUrl(settings);
  return useMemo(() => (token ? { baseUrl, accessToken: token } : null), [token, baseUrl]);
}
