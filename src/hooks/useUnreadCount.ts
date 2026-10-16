import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../store/AuthContext';
import { getUnreadCount, markAllAsRead } from '../lib/notificationService';

/** Fired after notifications are read on this device, so every badge updates at once. */
export const NOTIFICATIONS_READ_EVENT = 'forge:notifications-read';
const POLL_MS = 60_000; // SWR polling, no Realtime (R9)

/**
 * Unread notifications for the signed-in member: fetched on mount, every
 * 60 s, when the app comes back to the foreground, and after reading.
 */
export function useUnreadCount() {
  const { user, isAuthenticated } = useAuth();
  const userId = isAuthenticated ? user?.id : undefined;
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const res = await getUnreadCount(userId);
    if (res.data !== null) setUnreadCount(res.data);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setUnreadCount(0);
      setLoading(false);
      return;
    }
    void refresh();
    const id = window.setInterval(() => document.visibilityState === 'visible' && void refresh(), POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    const onRead = () => void refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(NOTIFICATIONS_READ_EVENT, onRead);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(NOTIFICATIONS_READ_EVENT, onRead);
    };
  }, [userId, refresh]);

  /** Optimistic: the badge clears now, the server catches up. */
  const markAllRead = useCallback(async () => {
    if (!userId) return;
    const before = unreadCount;
    setUnreadCount(0);
    const res = await markAllAsRead(userId);
    if (res.error) setUnreadCount(before);
    else window.dispatchEvent(new Event(NOTIFICATIONS_READ_EVENT));
  }, [userId, unreadCount]);

  return { unreadCount, loading, markAllRead, refresh };
}
