import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../store/AuthContext';
import { useToast } from '../../store/toast';
import { describeNotification, fetchNotifications, markAllAsRead, markAsRead, type AppNotification } from '../../lib/notificationService';
import { getRelativeTime } from '../../lib/relativeTime';
import { NOTIFICATIONS_READ_EVENT } from '../../hooks/useUnreadCount';
import { Avatar } from '../community/shared';
import { SkeletonAvatar, SkeletonLine } from '../../components/Skeleton';

const PULL_PX = 70;

/** The inbox: kudos, comments and follows from the last 90 days. */
export function NotificationsPage() {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const navigate = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pull, setPull] = useState(0);
  const pullStart = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setBusy(true);
    const res = await fetchNotifications(userId);
    setBusy(false);
    if (res.error || !res.data) {
      setError(res.error ?? 'Could not load notifications.');
      setState((s) => (s === 'ready' ? s : 'error'));
      return;
    }
    setItems(res.data.data);
    setCursor(res.data.nextCursor);
    setError(null);
    setState('ready');
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!cursor) return;
    setBusy(true);
    const res = await fetchNotifications(userId, cursor);
    setBusy(false);
    if (res.error || !res.data) return toast(res.error ?? 'Could not load more.');
    const more = res.data;
    setItems((list) => [...list, ...more.data.filter((n) => !list.some((x) => x.id === n.id))]);
    setCursor(more.nextCursor);
  };

  const open = (n: AppNotification) => {
    if (!n.read) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      void markAsRead(n.id, userId).then(() => window.dispatchEvent(new Event(NOTIFICATIONS_READ_EVENT)));
    }
    navigate(describeNotification(n, userId).href);
  };

  const readAll = async () => {
    const before = items;
    setItems((list) => list.map((x) => ({ ...x, read: true })));
    const res = await markAllAsRead(userId);
    if (res.error) {
      setItems(before);
      toast(`Not marked read. ${res.error}`);
      return;
    }
    window.dispatchEvent(new Event(NOTIFICATIONS_READ_EVENT));
  };

  // Pull to refresh: drag down from the top of the page.
  const onTouchStart = (e: React.TouchEvent) => {
    pullStart.current = window.scrollY <= 0 ? e.touches[0].clientY : null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (pullStart.current === null) return;
    setPull(Math.max(0, Math.min(PULL_PX * 1.5, e.touches[0].clientY - pullStart.current)));
  };
  const onTouchEnd = () => {
    if (pull >= PULL_PX) void load();
    pullStart.current = null;
    setPull(0);
  };

  const unread = items.some((n) => !n.read);

  return (
    <div className="pb-8" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {pull > 0 && (
        <p className="py-2 text-center text-xs text-muted" aria-hidden style={{ height: pull / 2 }}>
          {pull >= PULL_PX ? 'Release to refresh' : 'Pull to refresh'}
        </p>
      )}
      <header className="mb-4 mt-3 flex items-center gap-3">
        <h1 className="min-w-0 flex-1 text-xl font-medium tracking-tight">Notifications</h1>
        {unread && (
          <button className="btn-outline h-9 px-3 text-sm" onClick={() => void readAll()}>Mark all read</button>
        )}
        <button className="grid h-9 w-9 place-items-center rounded-md border border-border text-foreground/80 hover:text-foreground disabled:opacity-40" onClick={() => void load()} disabled={busy} aria-label="Refresh notifications">
          <RefreshCw className={`h-4 w-4 ${busy ? 'motion-safe:animate-spin' : ''}`} aria-hidden />
        </button>
      </header>

      {state === 'loading' ? (
        <ul className="space-y-2" role="status" aria-label="Loading notifications">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="card flex items-center gap-3 p-3" aria-hidden>
              <SkeletonAvatar />
              <div className="flex-1 space-y-2">
                <SkeletonLine width="w-2/3" />
                <SkeletonLine width="w-1/4" />
              </div>
            </li>
          ))}
        </ul>
      ) : state === 'error' ? (
        <div className="py-12 text-center">
          <p className="font-medium">Notifications didn't load</p>
          <p className="mt-1 text-sm text-muted">{error}</p>
          <button className="btn-outline mt-4" onClick={() => void load()}>Try again</button>
        </div>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted">No notifications yet. Interact with the community and they'll show up here.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((n) => {
              const { text } = describeNotification(n, userId);
              return (
                <li key={n.id}>
                  <button
                    onClick={() => open(n)}
                    className={`card flex w-full items-center gap-3 p-3 text-left transition-colors hover:border-[color:var(--card-edge-hover)] ${n.read ? '' : 'bg-stone-50 dark:bg-stone-800/50'}`}
                  >
                    <Avatar name={n.actor.display_name} path={n.actor.avatar_path} />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${n.read ? 'text-foreground/80' : 'font-medium'}`}>{text}</span>
                      <span className="block truncate text-xs text-muted">
                        {n.postTitle ? `${n.postTitle} · ` : ''}
                        {getRelativeTime(n.createdAt)}
                      </span>
                    </span>
                    {!n.read && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-foreground" aria-label="Unread" role="img" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {cursor && (
            <button className="btn-ghost mt-3 w-full" onClick={() => void loadMore()} disabled={busy}>
              {busy ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
