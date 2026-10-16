import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Plus, RefreshCw, Search, WifiOff } from 'lucide-react';
import { useAuth } from '../../store/AuthContext';
import { useFeed } from '../../hooks/useFeed';
import { getProfile, type CommunityPost } from '../../lib/communityService';
import { PostCard } from './PostCard';
import { CreatePostSheet } from './CreatePostSheet';
import { EditPostSheet } from './EditPostSheet';
import { Avatar, myDisplayName } from './shared';
import { SkeletonPost } from '../../components/Skeleton';
import { PushSoftAsk } from '../settings/PushSoftAsk';

export function FeedPage() {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const feed = useFeed();
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<CommunityPost | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasMore, loadMore } = feed;
  // The name and photo from your community profile (it can be edited), fetched
  // once per visit, not on every poll. Until then: the name you signed up with.
  const [me, setMe] = useState<{ name: string; avatar?: string } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    getProfile(userId).then((res) => live && res.data && setMe({ name: res.data.display_name, avatar: res.data.avatar_path }));
    return () => {
      live = false;
    };
  }, [userId]);

  // Infinite scroll: fetch the next page as the end of the list comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void loadMore(), { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore, feed.posts.length]);

  const name = me?.name ?? myDisplayName(user);

  return (
    <div className="pb-8">
      <header className="mb-4 mt-3 flex items-center gap-3">
        <Link to={`/community/profile/${userId}`} aria-label="Your profile" className="shrink-0">
          <Avatar name={name} path={me?.avatar} />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-xl font-medium tracking-tight">Forge OS community</h1>
        <button className="grid h-9 w-9 place-items-center rounded-md border border-border text-foreground/80 hover:text-foreground disabled:opacity-40" onClick={() => void feed.refresh()} disabled={feed.refreshing || feed.isOffline} aria-label="Refresh feed">
          <RefreshCw className={`h-4 w-4 ${feed.refreshing ? 'motion-safe:animate-spin' : ''}`} aria-hidden />
        </button>
        <Link to="/community/search" className="grid h-9 w-9 place-items-center rounded-md border border-border text-foreground/80 hover:text-foreground" aria-label="Search the community">
          <Search className="h-4 w-4" aria-hidden />
        </Link>
      </header>

      <PushSoftAsk variant="social" />

      {feed.isOffline && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-warn/40 px-3 py-2 text-xs text-warn">
          <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden /> You are offline. Showing cached posts.
        </p>
      )}

      {feed.loading && feed.posts.length === 0 ? (
        <div className="space-y-3" role="status" aria-label="Loading the feed">
          {[0, 1, 2].map((i) => <SkeletonPost key={i} />)}
        </div>
      ) : feed.error && feed.posts.length === 0 ? (
        <div className="py-12 text-center">
          <p className="font-medium">The feed didn't load</p>
          <p className="mt-1 text-sm text-muted">{feed.error}</p>
          <button className="btn-outline mt-4" onClick={() => void feed.refresh()}>Try again</button>
        </div>
      ) : feed.posts.length === 0 ? (
        <div className="py-12 text-center">
          <p className="font-medium">No posts yet</p>
          <p className="mt-1 text-sm text-muted">Be the first to share your training.</p>
          <button className="btn-outline mt-4" onClick={() => setComposing(true)}>New post</button>
        </div>
      ) : (
        <div className="space-y-3">
          {feed.posts.map((post) => (
            <PostCard key={post.id} post={post} currentUserId={userId} onChange={feed.upsertPost} onRemove={feed.removePost} onEdit={setEditing} />
          ))}
          <div ref={sentinel} aria-hidden className="h-px" />
          {feed.loadingMore && (
            <div className="flex justify-center py-3 text-muted" role="status" aria-label="Loading more posts">
              <Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden />
            </div>
          )}
          {!hasMore && feed.posts.length > 5 && <p className="py-3 text-center text-xs text-muted">You're all caught up.</p>}
        </div>
      )}

      <div className="fixed bottom-20 z-30" style={{ right: 'max(1rem, calc((100vw - 28rem) / 2 + 1rem))' }}>
        <button className="btn-solid h-14 w-14 p-0" aria-label="New post" onClick={() => setComposing(true)}>
          <Plus className="h-6 w-6" aria-hidden />
        </button>
      </div>

      <CreatePostSheet open={composing} onClose={() => setComposing(false)} userId={userId} onCreated={feed.upsertPost} />
      <EditPostSheet post={editing} userId={userId} onClose={() => setEditing(null)} onSaved={feed.upsertPost} />
    </div>
  );
}
