import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../store/AuthContext';
import { getDB } from '../db/database';
import { fetchFeed, getFollowingIds, type CommunityPost } from '../lib/communityService';
import { QUEUE_SYNCED_EVENT } from '../lib/offlineQueueProcessor';
import { getCachedFeed, getCacheMeta, mergeFeedUpdate, removeFromCache, setCachedFeed } from '../lib/feedCache';

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
  /** A next page is being fetched. */
  loadingMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Show a new or changed post now (and cache it): new posts go on top. */
  upsertPost: (post: CommunityPost) => void;
  /** Drop a post from the screen and the cache. */
  removePost: (postId: string) => void;
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
  const [loadingMore, setLoadingMore] = useState(false);

  const mounted = useRef(true);
  const postsRef = useRef<CommunityPost[]>([]);
  const cursor = useRef<string | null>(null);
  const generation = useRef(0); // bumps on refresh, so late load-more results are dropped
  const fetchingMore = useRef(false);
  // Who you follow, for followers-only posts. Reloaded on mount and manual
  // refresh only, not on every 60 s poll.
  const followees = useRef<string[] | undefined>(undefined);

  const show = (next: CommunityPost[]) => {
    postsRef.current = next;
    setPosts(next);
  };

  const load = useCallback(async (reloadFollowing: boolean) => {
    if (!userId) return;
    if (!isOnline()) {
      setIsOffline(true);
      setLoading(false);
      if (postsRef.current.length === 0) setError("You're offline. The feed will load when you're back online.");
      return;
    }
    const gen = ++generation.current;
    setRefreshing(true);
    if (reloadFollowing || !followees.current) {
      const f = await getFollowingIds(userId);
      if (f.data) followees.current = f.data; // on failure keep the last list we had
    }
    const res = await fetchFeed(userId, undefined, pageSize, followees.current ?? []);
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

  /** Manual refresh: also re-checks who you follow. */
  const refresh = useCallback(() => load(true), [load]);
  const poll = useCallback(() => load(false), [load]);

  const loadMore = useCallback(async () => {
    if (!userId || !cursor.current || fetchingMore.current || !isOnline()) return;
    fetchingMore.current = true;
    setLoadingMore(true);
    const gen = generation.current;
    try {
      const res = await fetchFeed(userId, cursor.current, pageSize, followees.current ?? []);
      if (!mounted.current || gen !== generation.current || res.error || !res.data) return;
      const page = res.data;
      const seen = new Set(postsRef.current.map((p) => p.id));
      show([...postsRef.current, ...page.data.filter((p) => !seen.has(p.id))]);
      cursor.current = page.nextCursor;
      setHasMore(page.hasMore);
      await mergeFeedUpdate(await getDB(), page.data, page.nextCursor).catch((err) => console.warn('Could not cache the feed.', err));
    } finally {
      fetchingMore.current = false;
      if (mounted.current) setLoadingMore(false);
    }
  }, [userId, pageSize]);

  const upsertPost = useCallback((post: CommunityPost) => {
    const exists = postsRef.current.some((p) => p.id === post.id);
    show(exists ? postsRef.current.map((p) => (p.id === post.id ? post : p)) : [post, ...postsRef.current]);
    setError(null);
    getDB().then((db) => mergeFeedUpdate(db, [post])).catch((err) => console.warn('Could not cache the post.', err));
  }, []);

  const removePost = useCallback((postId: string) => {
    show(postsRef.current.filter((p) => p.id !== postId));
    getDB().then((db) => removeFromCache(db, postId)).catch((err) => console.warn('Could not update the cached feed.', err));
  }, []);

  // Mount (and account change): cached feed first, then fresh.
  useEffect(() => {
    mounted.current = true;
    // A different account starts from a clean slate, never the last one's posts.
    show([]);
    cursor.current = null;
    followees.current = undefined;
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
      if (document.visibilityState === 'visible' && document.hasFocus() && isOnline()) void poll();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    const onOnline = () => {
      setIsOffline(false);
      void poll();
    };
    const onOffline = () => setIsOffline(true);
    const onSynced = () => void poll();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener(QUEUE_SYNCED_EVENT, onSynced);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener(QUEUE_SYNCED_EVENT, onSynced);
    };
  }, [userId, poll]);

  useEffect(() => () => {
    mounted.current = false;
  }, []);

  return { posts, loading, refreshing, error, hasMore, isOffline, loadingMore, refresh, loadMore, upsertPost, removePost };
}
