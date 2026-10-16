import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, Flag, Loader2, MoreHorizontal, ShieldBan } from 'lucide-react';
import { useAuth } from '../../store/AuthContext';
import { useToast } from '../../store/toast';
import { useConfirm } from '../../store/confirm';
import { deduplicatedMutation, isMutationPending } from '../../lib/deduplicatedMutation';
import {
  getFollowCounts, getFollowStatus, getPostCount, getProfile, getProfilePosts, removeFollow, requestFollow, uploadAvatar,
  type CommunityPost, type CommunityProfile, type FollowStatus,
} from '../../lib/communityService';
import { PostCard } from './PostCard';
import { EditPostSheet } from './EditPostSheet';
import { EditProfileSheet } from './EditProfileSheet';
import { BlockReportSheet, type BlockReportMode } from './BlockReportSheet';
import { Avatar } from './shared';
import { SkeletonAvatar, SkeletonLine, SkeletonPost } from '../../components/Skeleton';
import { useSocialNotify } from './useSocialNotify';

interface Counts { posts?: number; followers?: number; following?: number }

export function ProfilePage() {
  const { userId: profileId = '' } = useParams();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const isMe = profileId === me;
  const toast = useToast();
  const notifySocial = useSocialNotify();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<CommunityProfile | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Counts>({});
  const [follow, setFollow] = useState<FollowStatus>('none');
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [postsLoading, setPostsLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheet, setSheet] = useState<BlockReportMode | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editingPost, setEditingPost] = useState<CommunityPost | null>(null);
  const [uploading, setUploading] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const loadPosts = useCallback(async (after?: string) => {
    setPostsLoading(true);
    const res = await getProfilePosts(profileId, me, after);
    setPostsLoading(false);
    if (res.data) {
      const page = res.data;
      setPosts((prev) => (after ? [...prev, ...page.data.filter((p) => !prev.some((x) => x.id === p.id))] : page.data));
      setCursor(page.nextCursor);
    }
  }, [profileId, me]);

  const load = useCallback(async () => {
    setState('loading');
    const res = await getProfile(profileId);
    if (!res.data) {
      // RLS hides profiles across a block: that looks exactly like "not found".
      setState(res.error === 'Profile not found.' ? 'missing' : 'error');
      setError(res.error);
      return;
    }
    setProfile(res.data);
    setState('ready');
    const [postCount, followCounts, status] = await Promise.all([
      getPostCount(profileId),
      getFollowCounts(profileId),
      isMe ? Promise.resolve(null) : getFollowStatus(me, profileId),
    ]);
    setCounts({ posts: postCount.data ?? undefined, followers: followCounts.data?.followers, following: followCounts.data?.following });
    if (status?.data) setFollow(status.data);
    void loadPosts();
  }, [profileId, me, isMe, loadPosts]);

  useEffect(() => {
    setPosts([]);
    setCursor(null);
    setFollow('none');
    void load();
  }, [load]);

  const followKey = `follow-${profileId}`;
  const changeFollow = async () => {
    if (!profile || isMutationPending(followKey)) return;
    const before = follow;
    if (before !== 'none') {
      const ok = await confirm(before === 'pending'
        ? { title: 'Cancel your follow request?', description: `${profile.display_name} won't see the request any more.`, confirmLabel: 'Cancel request', cancelLabel: 'Keep it' }
        : { title: `Unfollow ${profile.display_name}?`, description: "You'll stop seeing their followers-only posts.", confirmLabel: 'Unfollow', cancelLabel: 'Stay' });
      if (!ok) return;
    }
    const after: FollowStatus = before === 'none' ? 'pending' : 'none';
    setFollow(after); // optimistic
    if (before === 'accepted') setCounts((c) => ({ ...c, followers: c.followers !== undefined ? Math.max(0, c.followers - 1) : undefined }));
    const res = await deduplicatedMutation(followKey, () => (before === 'none' ? requestFollow(me, profileId) : removeFollow(me, profileId)));
    if (res?.error) {
      setFollow(before);
      if (before === 'accepted') setCounts((c) => ({ ...c, followers: c.followers !== undefined ? c.followers + 1 : undefined }));
      toast(`That didn't work. ${res.error}`);
    } else if (res && before === 'none') {
      toast(`Follow request sent to ${profile.display_name}`);
      notifySocial('follow_request', profileId);
    } else if (res && before === 'accepted') {
      void loadPosts(); // their followers-only posts are no longer yours to see
    }
  };

  const changePhoto = async (file: File | undefined) => {
    if (!file || !profile) return;
    setUploading(true);
    const res = await uploadAvatar(me, file);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
    if (res.error || !res.data) {
      toast(`Photo not saved. ${res.error ?? ''}`.trim());
      return;
    }
    setProfile({ ...profile, avatar_path: undefined });
    setTimeout(() => setProfile((p) => (p ? { ...p, avatar_path: res.data ?? undefined } : p)), 0);
    toast('Photo updated');
  };

  const back = (
    <Link to="/community" className="link mb-3 mt-3 inline-flex items-center gap-1.5">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Back to the feed
    </Link>
  );

  if (state === 'loading') {
    return (
      <div>
        {back}
        <div className="space-y-4" role="status" aria-label="Loading profile">
          <div className="flex items-center gap-4">
            <SkeletonAvatar size="lg" />
            <div className="flex-1 space-y-2">
              <SkeletonLine width="w-1/2" />
              <SkeletonLine width="w-1/3" />
            </div>
          </div>
          <SkeletonLine width="w-3/4" />
          <SkeletonPost />
        </div>
      </div>
    );
  }
  if (state !== 'ready' || !profile) {
    return (
      <div>
        {back}
        <div className="py-10 text-center">
          <p className="font-medium">{state === 'missing' ? 'This athlete is not available' : "The profile didn't load"}</p>
          <p className="mt-1 text-sm text-muted">{state === 'missing' ? 'The account may not exist, or one of you has blocked the other.' : error}</p>
          {state === 'error' && <button className="btn-outline mt-4" onClick={() => void load()}>Try again</button>}
        </div>
      </div>
    );
  }

  const stat = (n: number | undefined, label: string, to?: string) => {
    const body = (
      <>
        <span className="block text-lg font-medium tabular-nums">{n ?? '–'}</span>
        <span className="text-xs text-muted">{label}</span>
      </>
    );
    return to ? <Link to={to} className="flex-1 rounded-lg py-1 text-center hover:bg-secondary">{body}</Link> : <div className="flex-1 py-1 text-center">{body}</div>;
  };

  return (
    <div className="pb-8">
      {back}
      <section className="card p-4" aria-labelledby="profile-name">
        <div className="flex items-start gap-4">
          {/* Outside the button: a control inside a control confuses screen readers. */}
          {isMe && <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => changePhoto(e.target.files?.[0])} />}
          {isMe ? (
            <button className="relative shrink-0 rounded-full" onClick={() => fileRef.current?.click()} aria-label="Change profile photo" disabled={uploading}>
              <Avatar name={profile.display_name} path={profile.avatar_path} size="lg" />
              <span className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full border border-border bg-card">
                {uploading ? <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden /> : <Camera className="h-3.5 w-3.5" aria-hidden />}
              </span>
            </button>
          ) : (
            <Avatar name={profile.display_name} path={profile.avatar_path} size="lg" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h1 id="profile-name" className="truncate text-xl font-medium tracking-tight">{profile.display_name}</h1>
              {!isMe && (
                <div className="relative" ref={menuRef}>
                  <button className="grid h-8 w-8 place-items-center rounded-md text-muted hover:text-foreground" aria-label="More options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
                    <MoreHorizontal className="h-4 w-4" aria-hidden />
                  </button>
                  {menuOpen && (
                    <div role="menu" className="absolute right-0 top-9 z-20 w-40 overflow-hidden rounded-lg border bg-card py-1 text-sm animate-rise" style={{ borderColor: 'var(--card-edge)' }}>
                      <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-secondary" onClick={() => { setMenuOpen(false); setSheet('report'); }}>
                        <Flag className="h-3.5 w-3.5" aria-hidden /> Report
                      </button>
                      <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-left text-bad hover:bg-secondary" onClick={() => { setMenuOpen(false); setSheet('block'); }}>
                        <ShieldBan className="h-3.5 w-3.5" aria-hidden /> Block
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            {profile.bio && <p className="mt-1 whitespace-pre-line text-sm text-foreground/80">{profile.bio}</p>}
          </div>
        </div>
        {profile.goals.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {profile.goals.map((g) => <span key={g} className="pill border-border text-foreground/80">{g}</span>)}
          </div>
        )}
        <div className="mt-4 flex border-t border-border pt-3">
          {stat(counts.posts, 'Posts')}
          {stat(counts.followers, 'Followers', `/community/profile/${profile.id}/followers`)}
          {stat(counts.following, 'Following', `/community/profile/${profile.id}/following`)}
        </div>
        <div className="mt-4">
          {isMe ? (
            <button className="btn-outline w-full" onClick={() => setEditingProfile(true)}>Edit profile</button>
          ) : follow === 'none' ? (
            <button className="btn-solid w-full" onClick={changeFollow}>Follow</button>
          ) : (
            <button className="btn-outline w-full" onClick={changeFollow} aria-label={follow === 'pending' ? 'Requested, tap to cancel' : 'Following, tap to unfollow'}>
              {follow === 'pending' ? 'Requested' : 'Following'}
            </button>
          )}
        </div>
      </section>

      <h2 className="mb-2 mt-6 text-sm font-medium">Posts</h2>
      {posts.length === 0 && !postsLoading && (
        <p className="py-6 text-center text-sm text-muted">
          {isMe ? "You haven't shared anything yet." : follow === 'accepted' ? 'No posts yet.' : 'No public posts yet.'}
        </p>
      )}
      <div className="space-y-3">
        {posts.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            currentUserId={me}
            onChange={(next) => setPosts((list) => list.map((x) => (x.id === next.id ? next : x)))}
            onRemove={(id) => { setPosts((list) => list.filter((x) => x.id !== id)); setCounts((c) => ({ ...c, posts: c.posts !== undefined ? Math.max(0, c.posts - 1) : undefined })); }}
            onEdit={setEditingPost}
          />
        ))}
      </div>
      {postsLoading && <div className="flex justify-center py-4 text-muted" role="status" aria-label="Loading posts"><Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden /></div>}
      {cursor && !postsLoading && <button className="btn-ghost mt-3 w-full" onClick={() => void loadPosts(cursor)}>Show more posts</button>}

      <EditProfileSheet profile={profile} open={editingProfile} onClose={() => setEditingProfile(false)} onSaved={setProfile} />
      <EditPostSheet post={editingPost} userId={me} onClose={() => setEditingPost(null)} onSaved={(next) => setPosts((list) => list.map((x) => (x.id === next.id ? next : x)))} />
      <BlockReportSheet mode={sheet} onClose={() => setSheet(null)} currentUserId={me} target={{ userId: profile.id, name: profile.display_name }} />
    </div>
  );
}
