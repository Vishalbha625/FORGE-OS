import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../store/AuthContext';
import { getDB } from '../db/database';
import { fetchFeed, type CommunityPost } from '../lib/communityService';
import { getCachedFeed, getCacheMeta, mergeFeedUpdate, setCachedFeed } from '../lib/feedCache';

// Stale-while-revalidate feed: show the cached feed at once, fetch fresh in the
// background, poll every 60 s while the app is focused and online. No realtime
// subscriptions (R9).

const POLL_MS = 60_000;
const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

export interface FeedState {
  posts: CommunityPost[];
  /** True only until the first data (cached or fresh) is ready. */
  loading: boolean;
  /** A background fetch is running. */
  refreshing: boolean;
  /** Shown only when there is nothing cached to fall back on. */
  error: string | null;
  hasMore: boolean;
  isOffline: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
}

export function useFeed(pageSize = 20): FeedState {
  const { user } = useAuth();
  const userId = user?.id;
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isOffline, setIsOffline] = useState(!isOnline());

  const mounted = useRef(true);
  const postsRef = useRef<CommunityPost[]>([]);
  const cursor = useRef<string | null>(null);
  const generation = useRef(0); // bumps on refresh, so late load-more results are dropped
  const loadingMore = useRef(false);

  const show = (next: CommunityPost[]) => {
    postsRef.current = next;
    setPosts(next);
  };

  const refresh = useCallback(async () => {
    if (!userId) return;
    if (!isOnline()) {
      setIsOffline(true);
      setLoading(false);
      if (postsRef.current.length === 0) setError("You're offline. The feed will load when you're back online.");
      return;
    }
    const gen = ++generation.current;
    setRefreshing(true);
    const res = await fetchFeed(userId, undefined, pageSize);
    if (!mounted.current || gen !== generation.current) return;
    setRefreshing(false);
    setLoading(false);
    if (res.error || !res.data) {
      // Cached posts on screen: keep them and stay quiet.
      setError(postsRef.current.length ? null : res.error ?? 'Could not load the feed.');
      return;
    }
    const page = res.data;
    show(page.data);
    cursor.current = page.nextCursor;
    setHasMore(page.hasMore);
    setError(null);
    try {
      await setCachedFeed(await getDB(), page.data, page.nextCursor, userId);
    } catch (err) {
      console.warn('Could not cache the feed.', err);
    }
  }, [userId, pageSize]);

  const loadMore = useCallback(async () => {
    if (!userId || !cursor.current || loadingMore.current || !isOnline()) return;
    loadingMore.current = true;
    const gen = generation.current;
    try {
      const res = await fetchFeed(userId, cursor.current, pageSize);
      if (!mounted.current || gen !== generation.current || res.error || !res.data) return;
      const page = res.data;
      const seen = new Set(postsRef.current.map((p) => p.id));
      show([...postsRef.current, ...page.data.filter((p) => !seen.has(p.id))]);
      cursor.current = page.nextCursor;
      setHasMore(page.hasMore);
      await mergeFeedUpdate(await getDB(), page.data, page.nextCursor).catch((err) => console.warn('Could not cache the feed.', err));
    } finally {
      loadingMore.current = false;
    }
  }, [userId, pageSize]);

  // Mount (and account change): cached feed first, then fresh.
  useEffect(() => {
    mounted.current = true;
    // A different account starts from a clean slate, never the last one's posts.
    show([]);
    cursor.current = null;
    setHasMore(false);
    setError(null);
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const db = await getDB();
        const meta = await getCacheMeta(db);
        if (!cancelled && meta?.userId === userId) {
          const cached = await getCachedFeed(db);
          if (!cancelled && cached.length) {
            show(cached);
            cursor.current = meta.nextCursor;
            setHasMore(Boolean(meta.nextCursor));
            setLoading(false);
          }
        }
      } catch (err) {
        console.warn('Could not read the cached feed.', err);
      }
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refresh]);

  // Poll while focused and online; refresh as soon as the tab comes back.
  useEffect(() => {
    if (!userId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && document.hasFocus() && isOnline()) void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onOnline = () => {
      setIsOffline(false);
      void refresh();
    };
    const onOffline = () => setIsOffline(true);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [userId, refresh]);

  useEffect(() => () => {
    mounted.current = false;
  }, []);

  return { posts, loading, refreshing, error, hasMore, isOffline, refresh, loadMore };
}
