import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../store/AppContext';
import { usePushApi } from '../../hooks/usePushApi';
import { getExistingSubscription, getPushPermission, mutedCategories, subscribeToPush } from '../../lib/pushService';

/** A path inside the app, or null: a notification can't send anyone to another site. */
export function safeAppPath(url: unknown): string | null {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') && !/[\\\u0000-\u001f]/.test(url) ? url : null;
}

/**
 * Background push plumbing while the app is open:
 * - a tapped notification (service worker message) opens its screen in place;
 * - once per session, re-saves this device's subscription, subscribing again
 *   if the browser dropped it, so pushes keep arriving.
 */
export function PushRuntime() {
  const navigate = useNavigate();
  const { settings } = useApp();
  const api = usePushApi();
  const checked = useRef(false);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      const path = data?.type === 'NAVIGATE' ? safeAppPath(data.url) : null;
      if (path) navigate(path);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);

  const enabled = settings?.push?.enabled === true;
  useEffect(() => {
    if (checked.current || !enabled || !api || getPushPermission() !== 'granted') return;
    checked.current = true;
    void (async () => {
      const existing = await getExistingSubscription().catch(() => null);
      const res = await subscribeToPush(api, { muted: mutedCategories(settings?.push) });
      if (!res.success) console.warn(`Push subscription ${existing ? 'refresh' : 'renewal'} failed: ${res.error ?? 'unknown'}`);
    })();
  }, [enabled, api, settings?.push]);

  return null;
}
