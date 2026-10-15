import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, MessageCircle, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { deletePost, toggleKudos, type CommunityPost } from '../../lib/communityService';
import { deduplicatedMutation, isMutationPending } from '../../lib/deduplicatedMutation';
import { queueCommunityWrite } from '../../lib/offlineQueueProcessor';
import { getRelativeTime } from '../../lib/relativeTime';
import { getDB } from '../../db/database';
import { useToast } from '../../store/toast';
import { useConfirm } from '../../store/confirm';
import { Avatar, PostPhoto, VisibilityIcon, isOffline, postStats } from './shared';

interface PostCardProps {
  post: CommunityPost;
  currentUserId: string;
  /** The post changed here (kudos, edit): keep the feed and cache in step. */
  onChange?: (post: CommunityPost) => void;
  onRemove?: (postId: string) => void;
  onEdit?: (post: CommunityPost) => void;
  /** Detail view: full caption and the full-size photo. */
  expanded?: boolean;
}

const LONG_CAPTION = 180;

export function PostCard({ post, currentUserId, onChange, onRemove, onEdit, expanded = false }: PostCardProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const kudosKey = `kudos-${post.id}`;
  const [kudos, setKudos] = useState({ on: post.user_has_kudosed, count: post.kudos_count });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isMine = post.author_id === currentUserId;
  const stats = postStats(post);
  const longCaption = (post.caption?.length ?? 0) > LONG_CAPTION || (post.caption?.split('\n').length ?? 0) > 3;

  // Take the server's numbers on refresh, unless our own change is still in flight.
  useEffect(() => {
    if (!isMutationPending(kudosKey)) setKudos({ on: post.user_has_kudosed, count: post.kudos_count });
  }, [post.user_has_kudosed, post.kudos_count, kudosKey]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const giveKudos = async () => {
    if (isMutationPending(kudosKey)) return; // double tap
    const before = kudos;
    const after = { on: !before.on, count: Math.max(0, before.count + (before.on ? -1 : 1)) };
    setKudos(after); // optimistic
    const updated = { ...post, user_has_kudosed: after.on, kudos_count: after.count };

    if (isOffline()) {
      await queueCommunityWrite(await getDB(), 'toggleKudos', { userId: currentUserId, postId: post.id, currentlyKudosed: before.on });
      onChange?.(updated);
      toast('Saved offline. Will sync when you are back online.');
      return;
    }
    const res = await deduplicatedMutation(kudosKey, () => toggleKudos(post.id, currentUserId, before.on));
    if (res === null) return;
    if (res.error) {
      setKudos(before);
      toast(`Kudos not saved. ${res.error}`);
      return;
    }
    onChange?.(updated);
  };

  const remove = async () => {
    setMenuOpen(false);
    const ok = await confirm({
      title: 'Delete this post?',
      description: 'It will be removed from the community for everyone, with its comments and kudos. Your training logs on this device are not affected.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    if (isOffline()) {
      await queueCommunityWrite(await getDB(), 'deletePost', { userId: currentUserId, postId: post.id });
      onRemove?.(post.id);
      toast('Deleted here. Will sync when you are back online.');
      return;
    }
    const res = await deletePost(post.id, currentUserId);
    if (res.error) {
      toast(`Could not delete. ${res.error}`);
      return;
    }
    onRemove?.(post.id);
    toast('Post deleted');
  };

  return (
    <article className="card relative p-4" aria-labelledby={`post-${post.id}-title`}>
      <header className="flex items-start gap-3">
        <Avatar name={post.author.display_name} />
        <div className="min-w-0 flex-1">
          <Link to={`/community/profile/${post.author_id}`} className="block truncate text-sm font-medium hover:text-brand">
            {post.author.display_name}
          </Link>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <time dateTime={post.created_at}>{getRelativeTime(post.created_at)}</time>
            <span aria-hidden>·</span>
            <VisibilityIcon visibility={post.visibility} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {post.is_pr && <span className="pill border-good/40 text-good">PR</span>}
          {isMine && (onEdit || onRemove) && (
            <div className="relative" ref={menuRef}>
              <button className="grid h-8 w-8 place-items-center rounded-md text-muted hover:text-foreground" aria-label="Post options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </button>
              {menuOpen && (
                <div role="menu" className="absolute right-0 top-9 z-20 w-36 overflow-hidden rounded-lg border bg-card py-1 text-sm animate-rise" style={{ borderColor: 'var(--card-edge)' }}>
                  {onEdit && (
                    <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-secondary" onClick={() => { setMenuOpen(false); onEdit(post); }}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                    </button>
                  )}
                  {onRemove && (
                    <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-left text-bad hover:bg-secondary" onClick={remove}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="mt-3 space-y-2">
        <span className="pill border-border text-foreground/80">{post.activity_type}</span>
        <h2 id={`post-${post.id}-title`} className="font-medium leading-snug">{post.title}</h2>
        {stats.length > 0 && (
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums text-foreground/80">
            {stats.map((s) => <span key={s}>{s}</span>)}
          </p>
        )}
        {post.station_detail && <p className="whitespace-pre-line text-sm text-foreground/80">{post.station_detail}</p>}
        {post.caption && (
          <div className="text-sm">
            <p className={`whitespace-pre-line ${expanded ? '' : 'line-clamp-3'}`}>{post.caption}</p>
            {!expanded && longCaption && (
              <Link to={`/community/post/${post.id}`} className="link mt-1 inline-block">Read more</Link>
            )}
          </div>
        )}
        {post.photo_path && <PostPhoto path={post.photo_path} variant={expanded ? 'full' : 'thumb'} />}
      </div>

      <footer className="mt-3 flex items-center gap-1 border-t border-border pt-2 text-sm">
        <button
          className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors ${kudos.on ? 'text-bad' : 'text-muted hover:text-foreground'}`}
          aria-pressed={kudos.on}
          aria-label={kudos.on ? 'Remove kudos' : 'Give kudos'}
          onClick={giveKudos}
        >
          <Heart className="h-4 w-4" fill={kudos.on ? 'currentColor' : 'none'} aria-hidden />
          <span className="tabular-nums">{kudos.count}</span>
        </button>
        <Link to={`/community/post/${post.id}`} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-muted hover:text-foreground" aria-label={`Comments (${post.comment_count})`}>
          <MessageCircle className="h-4 w-4" aria-hidden />
          <span className="tabular-nums">{post.comment_count}</span>
        </Link>
      </footer>
    </article>
  );
}
