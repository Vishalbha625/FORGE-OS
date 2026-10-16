import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Send, Trash2 } from 'lucide-react';
import { useAuth } from '../../store/AuthContext';
import { useToast } from '../../store/toast';
import { useConfirm } from '../../store/confirm';
import { getDB } from '../../db/database';
import { addComment, deleteComment, fetchComments, getPost, type CommunityComment, type CommunityPost } from '../../lib/communityService';
import { mergeFeedUpdate, removeFromCache } from '../../lib/feedCache';
import { queueCommunityWrite } from '../../lib/offlineQueueProcessor';
import { sanitizeComment } from '../../lib/sanitize';
import { getRelativeTime } from '../../lib/relativeTime';
import { PostCard } from './PostCard';
import { EditPostSheet } from './EditPostSheet';
import { Avatar, isOffline, myDisplayName } from './shared';
import { SkeletonCard, SkeletonLine, SkeletonPost } from '../../components/Skeleton';
import { useSocialNotify } from './useSocialNotify';
import { PushSoftAsk } from '../settings/PushSoftAsk';

type CommentState = 'sending' | 'queued';
interface ShownComment extends CommunityComment {
  state?: CommentState;
}

export function PostDetailPage() {
  const { postId = '' } = useParams();
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const navigate = useNavigate();
  const toast = useToast();
  const notifySocial = useSocialNotify();
  const confirm = useConfirm();

  const [post, setPost] = useState<CommunityPost | null>(null);
  const [postState, setPostState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [postError, setPostError] = useState<string | null>(null);
  const [comments, setComments] = useState<ShownComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<CommunityPost | null>(null);

  /** Show and cache a changed post, so the feed agrees when you go back. */
  const keep = useCallback((next: CommunityPost) => {
    setPost(next);
    getDB().then((db) => mergeFeedUpdate(db, [next])).catch(() => {});
  }, []);

  // Cached copy first (works offline), then the server's.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const cached = (await (await getDB()).get('socialCache', postId)) as CommunityPost | undefined;
        if (live && cached?.author) {
          setPost(cached);
          setPostState('ready');
        }
      } catch {
        /* no cache: wait for the network */
      }
      if (isOffline()) {
        if (live) setPostState((s) => (s === 'ready' ? s : 'error'));
        if (live) setPostError("You're offline and this post isn't saved on this device.");
        return;
      }
      const res = await getPost(postId, userId);
      if (!live) return;
      if (res.data) {
        keep(res.data);
        setPostState('ready');
      } else if (res.error === 'Post not found.') {
        setPostState('missing');
        getDB().then((db) => removeFromCache(db, postId)).catch(() => {});
      } else {
        setPostState((s) => (s === 'ready' ? s : 'error'));
        setPostError(res.error);
      }
    })();
    return () => {
      live = false;
    };
  }, [postId, userId, keep]);

  const loadComments = useCallback(async (after?: string) => {
    setCommentsLoading(true);
    const res = await fetchComments(postId, after);
    setCommentsLoading(false);
    if (res.error || !res.data) {
      setCommentsError(res.error ?? 'Could not load comments.');
      return;
    }
    const page = res.data;
    setCommentsError(null);
    setComments((prev) => {
      const seen = new Set(prev.map((c) => c.id));
      return [...(after ? prev : prev.filter((c) => c.state)), ...page.data.filter((c) => !seen.has(c.id))];
    });
    setCursor(page.nextCursor);
  }, [postId]);

  useEffect(() => {
    if (isOffline()) {
      setCommentsLoading(false);
      setCommentsError("Comments load when you're back online.");
      return;
    }
    void loadComments();
  }, [loadComments]);

  const bumpCount = (delta: number) => setPost((p) => {
    if (!p) return p;
    const next = { ...p, comment_count: Math.max(0, p.comment_count + delta) };
    getDB().then((db) => mergeFeedUpdate(db, [next])).catch(() => {});
    return next;
  });

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = sanitizeComment(text);
    if (!body || !user) return;
    const id = crypto.randomUUID();
    const optimistic: ShownComment = {
      id, post_id: postId, author_id: userId, body, created_at: new Date().toISOString(),
      author: { id: userId, display_name: myDisplayName(user), goals: [], created_at: '' },
      state: isOffline() ? 'queued' : 'sending',
    };
    setText('');
    setComments((c) => [...c, optimistic]); // oldest first, so a new comment goes at the end
    bumpCount(1);

    if (optimistic.state === 'queued') {
      await queueCommunityWrite(await getDB(), 'addComment', { userId, postId, body, commentId: id });
      return;
    }
    const res = await addComment(postId, userId, body, id);
    if (res.error || !res.data) {
      setComments((c) => c.filter((x) => x.id !== id));
      bumpCount(-1);
      setText(body);
      toast(`Comment not sent. ${res.error ?? ''}`.trim());
      return;
    }
    const saved = res.data;
    setComments((c) => c.map((x) => (x.id === id ? saved : x)));
    if (post) notifySocial('comment_received', post.author_id, post.id, saved.id);
  };

  const removeComment = async (c: ShownComment) => {
    const ok = await confirm({ title: 'Delete this comment?', description: 'It will be removed for everyone.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    if (isOffline()) {
      await queueCommunityWrite(await getDB(), 'deleteComment', { userId, commentId: c.id });
    } else {
      const res = await deleteComment(c.id, userId);
      if (res.error) {
        toast(`Could not delete. ${res.error}`);
        return;
      }
    }
    setComments((list) => list.filter((x) => x.id !== c.id));
    bumpCount(-1);
  };

  const back = (
    <Link to="/community" className="link mb-3 mt-3 inline-flex items-center gap-1.5">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Back to the feed
    </Link>
  );

  if (postState === 'loading') {
    return (
      <div>
        {back}
        <div className="space-y-3" role="status" aria-label="Loading the post">
          <SkeletonPost />
          <SkeletonLine width="w-1/3" />
          <SkeletonCard />
        </div>
      </div>
    );
  }
  if (postState === 'missing' || (postState === 'error' && !post)) {
    return (
      <div>
        {back}
        <div className="py-10 text-center">
          <p className="font-medium">{postState === 'missing' ? 'This post is not available' : "The post didn't load"}</p>
          <p className="mt-1 text-sm text-muted">{postState === 'missing' ? 'It may have been deleted, or its author changed who can see it.' : postError}</p>
        </div>
      </div>
    );
  }
  if (!post) return null;

  return (
    <div className="pb-40">
      {back}
      <PostCard post={post} currentUserId={userId} expanded onChange={keep} onEdit={setEditing} onRemove={() => navigate('/community', { replace: true })} />
      <div className="mt-4">
        <PushSoftAsk variant="social" />
      </div>

      <section className="mt-5" aria-labelledby="comments-title">
        <h2 id="comments-title" className="mb-2 text-sm font-medium">Comments</h2>
        {comments.length === 0 && !commentsLoading && !commentsError && <p className="text-sm text-muted">No comments yet.</p>}
        {commentsError && comments.length === 0 && (
          <p className="text-sm text-muted">
            {commentsError} {!isOffline() && <button className="link" onClick={() => void loadComments()}>Try again</button>}
          </p>
        )}
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <Link to={`/community/profile/${c.author_id}`} tabIndex={-1} aria-hidden className="shrink-0">
                <Avatar name={c.author.display_name} path={c.author.avatar_path} size="sm" />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs">
                  <Link to={`/community/profile/${c.author_id}`} className="truncate font-medium hover:text-brand">{c.author.display_name}</Link>
                  <span className="text-muted">
                    {c.state === 'queued' ? 'Waiting to send' : c.state === 'sending' ? 'Sending' : getRelativeTime(c.created_at)}
                  </span>
                </div>
                <p className={`whitespace-pre-line text-sm ${c.state ? 'text-muted' : ''}`}>{c.body}</p>
              </div>
              {c.author_id === userId && c.state !== 'sending' && (
                <button className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:text-bad" aria-label="Delete comment" onClick={() => removeComment(c)}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
        {commentsLoading && (
          <div className="flex justify-center py-3 text-muted" role="status" aria-label="Loading comments">
            <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
          </div>
        )}
        {cursor && !commentsLoading && (
          <button className="link mt-3" onClick={() => void loadComments(cursor)}>Show more comments</button>
        )}
      </section>

      <form onSubmit={send} className="fixed inset-x-0 bottom-16 z-30 border-t border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-md gap-2 px-4 py-2">
          <input className="field" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Add a comment" aria-label="Add a comment" />
          <button type="submit" className="btn-soft shrink-0" disabled={!text.trim()} aria-label="Send comment">
            <Send className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </form>

      <EditPostSheet post={editing} userId={userId} onClose={() => setEditing(null)} onSaved={keep} />
    </div>
  );
}
