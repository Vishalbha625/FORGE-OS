import { randomUUID } from 'node:crypto';
import { isUuid } from './http.mjs';

// Web Push for Forge OS (VAPID). Four endpoints:
//   POST /api/push/subscribe    { endpoint, p256dh, authKey, deviceTag?, muted? }
//   POST /api/push/unsubscribe  { endpoint }
//   POST /api/push/send         { recipientId, type, postId? }
//   POST /api/push/schedule     { type, fireAt | null }
//
// Every message is written here, from fixed text, never by the client: a push
// can't carry health data (R1), and nobody can put words in it. A social push
// is only sent after the database confirms the event happened (the kudos row
// exists, the follow is pending, ...), so a signed-in member can't spam others.
// Subscriptions are written with the caller's own token (row-level security
// applies); reading someone else's subscriptions to deliver a push needs the
// service role and happens only here.

export const SOCIAL_TYPES = ['kudos_received', 'comment_received', 'follow_request', 'follow_accepted'];
const SOCIAL_ALIASES = { kudos: 'kudos_received', comment: 'comment_received' };

/** Reminder pushes: type -> category (for muting), title, body, where a tap goes. */
export const REMINDER_PUSHES = {
  reminder_workout: { category: 'workout', title: 'Time to train', body: "Today's session is waiting.", url: '/' },
  reminder_missing: { category: 'workout', title: 'Log your workout', body: 'Did you train today? Log it so your history stays accurate.', url: '/training' },
  reminder_meal_breakfast: { category: 'meals', title: 'Meal log', body: "Don't forget to log breakfast.", url: '/nutrition' },
  reminder_meal_lunch: { category: 'meals', title: 'Meal log', body: "Don't forget to log lunch.", url: '/nutrition' },
  reminder_meal_dinner: { category: 'meals', title: 'Meal log', body: "Don't forget to log dinner.", url: '/nutrition' },
  reminder_water: { category: 'water', title: 'Hydration', body: 'Stay hydrated. Have a glass of water and log it.', url: '/hydration' },
  reminder_bedtime: { category: 'sleep', title: 'Wind down', body: 'Time to start your bedtime routine.', url: '/sleep' },
  reminder_weigh: { category: 'weigh_in', title: 'Weekly weigh-in', body: 'Weigh in before breakfast for a consistent trend.', url: '/body' },
  reminder_review: { category: 'weekly_review', title: 'Weekly review', body: 'Check your weekly progress.', url: '/analytics' },
  reminder_race: { category: 'race', title: 'Race countdown', body: 'Your race countdown has moved on a day.', url: '/' },
};

export const CATEGORIES = ['social', 'workout', 'meals', 'water', 'sleep', 'weigh_in', 'weekly_review', 'race'];

const DEDUP_MS = 5 * 60_000; // the same social event pushes at most once per 5 minutes
const SEND_LIMIT = 30; // social pushes per sender per minute
const MAX_SCHEDULE_AHEAD_MS = 8 * 24 * 60 * 60_000;
const COMMENT_WINDOW_MS = 10 * 60_000;
const SOCIAL_TTL_SEC = 24 * 60 * 60;
const REMINDER_TTL_SEC = 30 * 60; // a reminder that arrives hours late is noise

const ok = (status, body) => ({ status, body });
const bad = (message) => ok(400, { error: message });

const looksBase64Url = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max && /^[A-Za-z0-9_-]+={0,2}$/.test(s);

/**
 * @param {{
 *   admin: import('@supabase/supabase-js').SupabaseClient,
 *   asUser: (token: string) => import('@supabase/supabase-js').SupabaseClient,
 *   webpush: { sendNotification: (sub: { endpoint: string, keys: { p256dh: string, auth: string } }, payload: string, options?: object) => Promise<unknown> },
 *   now?: () => number,
 *   log?: Pick<Console, 'warn' | 'error'>,
 * }} deps
 */
export function createPush({ admin, asUser, webpush, now = Date.now, log = console }) {
  /** @type {Map<string, number>} */
  const recent = new Map();
  /** @type {Map<string, number[]>} */
  const sendTimes = new Map();
  /** In memory: lost on restart. The app's foreground reminders stay the reliable path. */
  /** @type {Map<string, { id: string, userId: string, type: string, fireAt: number }>} */
  const scheduled = new Map();

  async function blockedBetween(a, b) {
    const { data, error } = await admin
      .from('blocks')
      .select('blocker_id')
      .or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`)
      .limit(1);
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  }

  async function postAuthor(postId) {
    const { data } = await admin.from('posts').select('author_id').eq('id', postId).maybeSingle();
    return data?.author_id;
  }

  /** Did `sender` really do this to `recipient`? Checked with the service role. */
  async function eventHappened(type, sender, recipient, postId) {
    if (type === 'kudos_received' || type === 'comment_received') {
      if (!isUuid(postId) || (await postAuthor(postId)) !== recipient) return false;
      if (type === 'kudos_received') {
        const { data } = await admin.from('kudos').select('post_id').eq('post_id', postId).eq('user_id', sender).maybeSingle();
        return !!data;
      }
      const since = new Date(now() - COMMENT_WINDOW_MS).toISOString();
      const { data } = await admin.from('comments').select('id').eq('post_id', postId).eq('author_id', sender).gt('created_at', since).limit(1);
      return (data ?? []).length > 0;
    }
    const [follower, followee, status] = type === 'follow_request' ? [sender, recipient, 'pending'] : [recipient, sender, 'accepted'];
    const { data } = await admin.from('follows').select('status').eq('follower_id', follower).eq('followee_id', followee).maybeSingle();
    return data?.status === status;
  }

  async function senderName(userId) {
    const { data } = await admin.from('profiles').select('display_name').eq('id', userId).maybeSingle();
    const name = typeof data?.display_name === 'string' ? data.display_name.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    return name || 'Someone';
  }

  function socialMessage(type, name, sender, recipient, postId) {
    switch (type) {
      case 'kudos_received':
        return { body: `${name} gave your post kudos`, url: `/community/post/${postId}` };
      case 'comment_received':
        return { body: `${name} commented on your post`, url: `/community/post/${postId}` };
      case 'follow_request':
        // Requests are accepted from your own followers list.
        return { body: `${name} wants to follow you`, url: `/community/profile/${recipient}/followers` };
      default:
        return { body: `${name} accepted your follow request`, url: `/community/profile/${sender}` };
    }
  }

  /** Delivers to every device of `userId` that hasn't muted `category`. Never throws. */
  async function deliver(userId, category, payload, ttl) {
    const { data: subs, error } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth_key, muted').eq('user_id', userId);
    if (error) {
      log.warn('[push] could not read subscriptions:', error.message);
      return 0;
    }
    let sent = 0;
    for (const sub of subs ?? []) {
      if (Array.isArray(sub.muted) && sub.muted.includes(category)) continue;
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, JSON.stringify(payload), { TTL: ttl, urgency: 'normal' });
        sent++;
      } catch (err) {
        const code = err?.statusCode;
        if (code === 404 || code === 410) {
          // The browser dropped this subscription: forget it.
          await admin.from('push_subscriptions').delete().eq('id', sub.id);
        } else {
          log.warn('[push] delivery failed:', code ?? err?.message ?? err);
        }
      }
    }
    return sent;
  }

  function overLimit(sender) {
    const t = now();
    const times = (sendTimes.get(sender) ?? []).filter((x) => t - x < 60_000);
    if (times.length >= SEND_LIMIT) return true;
    times.push(t);
    sendTimes.set(sender, times);
    return false;
  }

  return {
    async subscribe(user, body) {
      const { endpoint, p256dh, authKey } = body;
      const deviceTag = body.deviceTag ?? 'default';
      const muted = body.muted ?? [];
      if (typeof endpoint !== 'string' || endpoint.length > 1000 || !endpoint.startsWith('https://')) {
        return bad('`endpoint` must be the https URL from the browser.');
      }
      if (!looksBase64Url(p256dh, 200) || !looksBase64Url(authKey, 100)) return bad('`p256dh` and `authKey` must be the base64url keys from the browser.');
      if (!['default', 'phone', 'desktop'].includes(deviceTag)) return bad('`deviceTag` must be phone, desktop or default.');
      if (!Array.isArray(muted) || muted.some((c) => !CATEGORIES.includes(c))) return bad(`\`muted\` must list categories from: ${CATEGORIES.join(', ')}.`);
      const row = { user_id: user.userId, endpoint, p256dh, auth_key: authKey, device_tag: deviceTag, muted, updated_at: new Date(now()).toISOString() };
      const { error } = await asUser(user.token).from('push_subscriptions').upsert(row, { onConflict: 'user_id,endpoint' });
      if (error) {
        log.error('[push] subscribe failed:', error.message);
        return ok(500, { error: 'Could not save the subscription.' });
      }
      return ok(201, { subscribed: true });
    },

    async unsubscribe(user, body) {
      if (typeof body.endpoint !== 'string' || !body.endpoint) return bad('`endpoint` is required.');
      const { error } = await asUser(user.token).from('push_subscriptions').delete().eq('user_id', user.userId).eq('endpoint', body.endpoint);
      if (error) log.warn('[push] unsubscribe failed:', error.message);
      return ok(200, { unsubscribed: !error });
    },

    /** Best effort: always 200 unless the request itself is malformed. */
    async send(user, body) {
      const type = SOCIAL_ALIASES[body.type] ?? body.type;
      const { recipientId, postId } = body;
      if (!SOCIAL_TYPES.includes(type)) return bad(`\`type\` must be one of: ${SOCIAL_TYPES.join(', ')}.`);
      if (!isUuid(recipientId)) return bad('`recipientId` must be a user id.');
      if (postId !== undefined && !isUuid(postId)) return bad('`postId` must be a post id.');
      if (recipientId === user.userId) return ok(200, { sent: false, reason: 'self', deviceCount: 0 });
      try {
        const key = `${user.userId}:${recipientId}:${type}:${postId ?? ''}`;
        const last = recent.get(key);
        if (last !== undefined && now() - last < DEDUP_MS) return ok(200, { sent: false, reason: 'duplicate', deviceCount: 0 });
        if (overLimit(user.userId)) return ok(200, { sent: false, reason: 'rate_limited', deviceCount: 0 });
        if (await blockedBetween(user.userId, recipientId)) return ok(200, { sent: false, reason: 'blocked', deviceCount: 0 });
        if (!(await eventHappened(type, user.userId, recipientId, postId))) return ok(200, { sent: false, reason: 'not_found', deviceCount: 0 });
        recent.set(key, now());
        const message = socialMessage(type, await senderName(user.userId), user.userId, recipientId, postId);
        const deviceCount = await deliver(recipientId, 'social', { title: 'Forge OS', ...message, type }, SOCIAL_TTL_SEC);
        return ok(200, { sent: deviceCount > 0, deviceCount });
      } catch (err) {
        log.error('[push] send failed:', err?.message ?? err);
        return ok(200, { sent: false, reason: 'error', deviceCount: 0 });
      }
    },

    async schedule(user, body) {
      const { type, fireAt } = body;
      if (!Object.prototype.hasOwnProperty.call(REMINDER_PUSHES, type)) return bad(`\`type\` must be one of: ${Object.keys(REMINDER_PUSHES).join(', ')}.`);
      const key = `${user.userId}:${type}`;
      if (fireAt === null) {
        scheduled.delete(key);
        return ok(200, { scheduled: false });
      }
      const at = typeof fireAt === 'string' ? Date.parse(fireAt) : NaN;
      if (!Number.isFinite(at) || at < now() - 60_000 || at > now() + MAX_SCHEDULE_AHEAD_MS) return bad('`fireAt` must be an ISO time within the next 8 days.');
      // One pending push per reminder type: rescheduling replaces it.
      const id = scheduled.get(key)?.id ?? randomUUID();
      scheduled.set(key, { id, userId: user.userId, type, fireAt: at });
      return ok(201, { scheduled: true, id });
    },

    /** Sends the reminders that are due. Called every minute. */
    async tick() {
      const due = [...scheduled.entries()].filter(([, s]) => s.fireAt <= now());
      for (const [key, s] of due) {
        scheduled.delete(key);
        const r = REMINDER_PUSHES[s.type];
        await deliver(s.userId, r.category, { title: r.title, body: r.body, url: r.url, type: s.type }, REMINDER_TTL_SEC);
      }
      return due.length;
    },

    /** For the health check and tests. */
    scheduledCount: () => scheduled.size,
  };
}
