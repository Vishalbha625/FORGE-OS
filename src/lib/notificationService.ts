import { cursorFilter, paginate, parseCursor, PROFILE_COLS, run, toProfile, type CommunityProfile, type PaginatedResult, type ProfileRow, type ServiceResult } from './communityService';
import { sendPushToUser, type PushApi } from './pushService';

// The in-app notification inbox. The app writes a notification right after
// the action it is about; row-level security (supabase/notifications.sql)
// only accepts it if the action really happened, nobody is blocked, and the
// same event wasn't notified in the last 5 minutes. A refused insert is not an
// error here, just nothing to send. A new notification also goes out as a push
// (to reach the recipient when the app is closed).

export type NotificationType = 'kudos_received' | 'comment_received' | 'follow_request' | 'follow_accepted';

export interface AppNotification {
  id: string;
  type: NotificationType;
  actor: CommunityProfile;
  postId?: string;
  /** The post's title, when the post is still there to see. */
  postTitle?: string;
  commentId?: string;
  read: boolean;
  createdAt: string;
}

/** Only the last 90 days are shown; older rows are cleared out quarterly (see notifications.sql). */
export const NOTIFICATION_DAYS = 90;
const FORBIDDEN = 'forbidden';

const ok = <T>(data: T): ServiceResult<T> => ({ data, error: null });
const fail = <T>(error: string): ServiceResult<T> => ({ data: null, error });
const isUuid = (s: string | undefined) => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

const SELECT = `id, user_id, type, actor_id, post_id, comment_id, read, created_at, actor:profiles!notifications_actor_id_fkey(${PROFILE_COLS}), post:posts!notifications_post_id_fkey(title)`;

interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  actor_id: string;
  post_id: string | null;
  comment_id: string | null;
  read: boolean;
  created_at: string;
  actor: ProfileRow | null;
  post: { title: string } | null;
}

const toNotification = (r: NotificationRow): AppNotification => ({
  id: r.id,
  type: r.type,
  actor: toProfile(r.actor, r.actor_id),
  postId: r.post_id ?? undefined,
  postTitle: r.post?.title ?? undefined,
  commentId: r.comment_id ?? undefined,
  read: r.read,
  createdAt: r.created_at,
});

const since = (now: number) => new Date(now - NOTIFICATION_DAYS * 24 * 60 * 60 * 1000).toISOString();

/**
 * Tells `recipientId` about something `actorId` just did, in the inbox and as
 * a push. Resolves 'skipped' when there is nothing to send: yourself, a
 * duplicate within 5 minutes, a block, or an event the database can't confirm.
 */
export async function createNotification(
  type: NotificationType,
  actorId: string,
  recipientId: string,
  postId?: string,
  commentId?: string,
  push?: PushApi | null,
): Promise<ServiceResult<'created' | 'skipped'>> {
  if (!actorId || actorId === recipientId) return ok('skipped');
  if (!isUuid(recipientId) || (postId !== undefined && !isUuid(postId)) || (commentId !== undefined && !isUuid(commentId))) return fail('Invalid notification.');
  const row = { id: crypto.randomUUID(), user_id: recipientId, actor_id: actorId, type, post_id: postId, comment_id: commentId };
  // Insert only: the sender can't read the recipient's notifications back.
  const res = await run<typeof FORBIDDEN | null>((c) => c.from('notifications').insert(row), { write: true, allowDuplicate: true, onForbidden: FORBIDDEN });
  if (res.error) return fail(res.error);
  if (res.data === FORBIDDEN) return ok('skipped');
  if (push) void sendPushToUser(push, actorId, recipientId, type, postId);
  return ok('created');
}

/** Newest first, last 90 days. Notifications from someone now blocked are left out. */
export async function fetchNotifications(userId: string, cursor?: string, limit = 20, now = Date.now()): Promise<ServiceResult<PaginatedResult<AppNotification>>> {
  const after = cursor ? parseCursor(cursor) : null;
  if (cursor && !after) return fail('Invalid page cursor.');
  const res = await run<NotificationRow[]>((c) => {
    let q = c.from('notifications').select(SELECT).eq('user_id', userId).gt('created_at', since(now));
    if (after) q = q.or(cursorFilter(after, 'lt'));
    return q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  });
  if (res.error || !res.data) return fail(res.error ?? 'Could not load notifications.');
  const page = paginate(res.data, limit, toNotification);
  // A block hides the actor's profile, and with it their notifications.
  const visible = res.data.slice(0, limit).filter((r) => r.actor !== null).map(toNotification);
  return ok({ ...page, data: visible });
}

/** Unread notifications from the last 90 days (a HEAD request: no rows travel). */
export async function getUnreadCount(userId: string, now = Date.now()): Promise<ServiceResult<number>> {
  const res = await run<number | null>((c) =>
    c
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false)
      .gt('created_at', since(now))
      .then((r) => ({ data: r.count, error: r.error, status: r.status })),
  );
  if (res.error) return fail(res.error);
  return ok(res.data ?? 0);
}

export async function markAsRead(notificationId: string, userId: string): Promise<ServiceResult<void>> {
  const res = await run((c) => c.from('notifications').update({ read: true }).eq('id', notificationId).eq('user_id', userId), { write: true });
  return res.error ? fail(res.error) : ok(undefined);
}

export async function markAllAsRead(userId: string): Promise<ServiceResult<void>> {
  const res = await run((c) => c.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false), { write: true });
  return res.error ? fail(res.error) : ok(undefined);
}

export async function deleteNotification(notificationId: string, userId: string): Promise<ServiceResult<void>> {
  const res = await run((c) => c.from('notifications').delete().eq('id', notificationId).eq('user_id', userId), { write: true });
  return res.error ? fail(res.error) : ok(undefined);
}

/** What a notification says, and where tapping it goes. */
export function describeNotification(n: Pick<AppNotification, 'type' | 'actor' | 'postId'>, myUserId: string): { text: string; href: string } {
  const name = n.actor.display_name;
  switch (n.type) {
    case 'kudos_received':
      return { text: `${name} gave your post kudos`, href: n.postId ? `/community/post/${n.postId}` : '/community' };
    case 'comment_received':
      return { text: `${name} commented on your post`, href: n.postId ? `/community/post/${n.postId}` : '/community' };
    case 'follow_request':
      // Requests are accepted from your own followers list.
      return { text: `${name} wants to follow you`, href: `/community/profile/${myUserId}/followers` };
    case 'follow_accepted':
      return { text: `${name} accepted your follow request`, href: `/community/profile/${n.actor.id}` };
  }
}
