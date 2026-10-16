import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../store/AppContext';
import { useAuth } from '../../store/AuthContext';
import { usePushApi } from '../../hooks/usePushApi';
import { getPushPermission, getVapidPublicKey, isPushSupported, mutedCategories, subscribeToPush, unsubscribeFromPush } from '../../lib/pushService';
import type { PushCategory } from '../../db/types';

export type PushState = 'unsupported' | 'signed_out' | 'checking' | 'unavailable' | 'denied' | 'off' | 'on';

export const SOFT_ASK_DISMISSED_KEY = 'push_softask_dismissed_at';
export const SOFT_ASK_DENIED_KEY = 'push_softask_denied';
const storage = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: the banner may show again, that's all */
    }
  },
};
export { storage as pushStorage };

// One lookup per server per page load: is push set up there?
const serverReady = new Map<string, Promise<boolean>>();
const isServerReady = (baseUrl: string) => {
  let p = serverReady.get(baseUrl);
  if (!p) {
    p = getVapidPublicKey(baseUrl).then(Boolean);
    serverReady.set(baseUrl, p);
  }
  return p;
};

/** Push on this device: where it stands, and turning it on, off and per category. */
export function usePushControls() {
  const { settings, saveSettings } = useApp();
  const { isAuthenticated, isSupabaseAvailable } = useAuth();
  const api = usePushApi();
  const [ready, setReady] = useState<boolean | null>(null);
  const [permission, setPermission] = useState(getPushPermission);
  const [busy, setBusy] = useState(false);

  const baseUrl = api?.baseUrl;
  useEffect(() => {
    if (baseUrl === undefined) return;
    let live = true;
    isServerReady(baseUrl).then((r) => live && setReady(r));
    return () => {
      live = false;
    };
  }, [baseUrl]);

  const enabled = settings?.push?.enabled === true;
  const state: PushState = !isPushSupported()
    ? 'unsupported'
    : !isSupabaseAvailable || !isAuthenticated
      ? 'signed_out'
      : permission === 'denied'
        ? 'denied'
        : ready === null
          ? 'checking'
          : !ready
            ? 'unavailable'
            : enabled && permission === 'granted'
              ? 'on'
              : 'off';

  /** Asks the browser (only now, after a tap), then subscribes this device. */
  const enable = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!api || !settings) return { success: false, error: 'Sign in to the community first.' };
    setBusy(true);
    try {
      let p = getPushPermission();
      if (p === 'default') {
        p = await Notification.requestPermission();
        setPermission(p);
      }
      if (p === 'denied') storage.set(SOFT_ASK_DENIED_KEY, '1');
      if (p !== 'granted') return { success: false, error: 'Notifications are blocked for this site.' };
      const res = await subscribeToPush(api, { muted: mutedCategories(settings.push) });
      if (res.success) await saveSettings({ ...settings, push: { categories: settings.push?.categories, enabled: true } });
      return res;
    } finally {
      setBusy(false);
    }
  }, [api, settings, saveSettings]);

  const disable = useCallback(async () => {
    if (!settings) return;
    setBusy(true);
    try {
      // Turning it off first lets the reminder sync cancel any scheduled pushes.
      await saveSettings({ ...settings, push: { categories: settings.push?.categories, enabled: false } });
      if (api) await unsubscribeFromPush(api);
    } finally {
      setBusy(false);
    }
  }, [api, settings, saveSettings]);

  const setCategory = useCallback(
    async (category: PushCategory, on: boolean) => {
      if (!settings) return;
      const push = { enabled, categories: { ...settings.push?.categories, [category]: on } };
      await saveSettings({ ...settings, push });
      // Social pushes are filtered by the server, so it has to hear about this one.
      if (category === 'social' && enabled && api) await subscribeToPush(api, { muted: mutedCategories(push) });
    },
    [api, enabled, settings, saveSettings],
  );

  return { state, busy, enable, disable, setCategory, push: settings?.push };
}
