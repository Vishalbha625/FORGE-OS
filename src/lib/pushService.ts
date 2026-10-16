import type { PushCategory, PushSettings } from '../db/types';

// Web Push from the browser side: the native PushManager, no SDK (R17).
// Subscriptions go to the coach server, which keeps them in Supabase and sends
// the pushes. The browser never sends message text: it names an event (or a
// reminder) and the server writes the words, so no health data can end up in
// a push (R1) and the VAPID private key stays on the server (R4).

export interface PushApi {
  /** Coach server base URL ('' = same origin). */
  baseUrl: string;
  /** The signed-in community session's access token. */
  accessToken: string;
}

export const PUSH_CATEGORIES: { key: PushCategory; label: string }[] = [
  { key: 'social', label: 'Kudos, comments and follows' },
  { key: 'workout', label: 'Workout and missing log' },
  { key: 'meals', label: 'Meal logging' },
  { key: 'water', label: 'Water' },
  { key: 'sleep', label: 'Bedtime' },
  { key: 'weigh_in', label: 'Weekly weigh-in' },
  { key: 'weekly_review', label: 'Weekly review' },
  { key: 'race', label: 'Race countdown' },
];

/** Social events the server can push about. */
export type SocialPushType = 'kudos_received' | 'comment_received' | 'follow_request' | 'follow_accepted';

/** Reminder pushes the server knows the text for. */
export type ReminderPushType =
  | 'reminder_workout'
  | 'reminder_missing'
  | 'reminder_meal_breakfast'
  | 'reminder_meal_lunch'
  | 'reminder_meal_dinner'
  | 'reminder_water'
  | 'reminder_bedtime'
  | 'reminder_weigh'
  | 'reminder_review'
  | 'reminder_race';

const PERMISSION_UNSUPPORTED = 'unsupported';

export function isPushSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
}

export function getPushPermission(): NotificationPermission | typeof PERMISSION_UNSUPPORTED {
  return isPushSupported() ? Notification.permission : PERMISSION_UNSUPPORTED;
}

/** Is this category on? Missing settings or keys mean on. */
export const categoryOn = (push: PushSettings | undefined, c: PushCategory) => push?.categories?.[c] !== false;

/** Categories switched off, as the server stores them on the subscription. */
export const mutedCategories = (push: PushSettings | undefined): PushCategory[] => PUSH_CATEGORIES.map((c) => c.key).filter((c) => !categoryOn(push, c));

/** The VAPID key format: base64url without padding, to bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function bufferToBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function detectDeviceTag(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): 'phone' | 'desktop' {
  return /Mobile|Android|iPhone|iPad/i.test(userAgent) ? 'phone' : 'desktop';
}

const post = (api: PushApi, path: string, body: unknown) =>
  fetch(`${api.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${api.accessToken}` },
    body: JSON.stringify(body),
  });

/** Reads and discards a response body, so the browser can finish (and reuse) the connection. */
const drain = (res: Response) => res.text().then(() => undefined, () => undefined);

const errorOf = async (res: Response, fallback: string) => {
  const json = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof json.error === 'string' ? json.error : fallback;
};

/** The server's public key: from the build (VITE_VAPID_PUBLIC_KEY) or asked from the server. */
export async function getVapidPublicKey(baseUrl: string): Promise<string | undefined> {
  const fromBuild = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim();
  if (fromBuild) return fromBuild;
  try {
    const res = await fetch(`${baseUrl}/api/push/config`);
    const json = (await res.json()) as { enabled?: unknown; publicKey?: unknown };
    return json.enabled === true && typeof json.publicKey === 'string' && json.publicKey ? json.publicKey : undefined;
  } catch {
    return undefined;
  }
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/**
 * Subscribes this browser (asking for nothing: call it after permission is
 * granted) and saves the subscription on the server. Reuses an existing one.
 */
export async function subscribeToPush(api: PushApi, opts: { muted?: PushCategory[] } = {}): Promise<{ success: boolean; error?: string }> {
  if (!isPushSupported()) return { success: false, error: 'Push notifications are not supported in this browser.' };
  if (Notification.permission !== 'granted') return { success: false, error: 'Notifications are not allowed for this site.' };
  try {
    const key = await getVapidPublicKey(api.baseUrl);
    if (!key) return { success: false, error: "Notifications aren't set up on the server yet." };
    const registration = await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
    const res = await post(api, '/api/push/subscribe', {
      endpoint: subscription.endpoint,
      p256dh: bufferToBase64Url(subscription.getKey('p256dh')),
      authKey: bufferToBase64Url(subscription.getKey('auth')),
      deviceTag: detectDeviceTag(),
      muted: opts.muted ?? [],
    });
    if (!res.ok) return { success: false, error: await errorOf(res, 'Could not turn on notifications.') };
    await drain(res);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error && err.message ? err.message : 'Could not turn on notifications.' };
  }
}

/** Removes the subscription from the browser and the server. */
export async function unsubscribeFromPush(api: PushApi): Promise<{ success: boolean }> {
  try {
    const subscription = await getExistingSubscription();
    if (!subscription) return { success: true };
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    // The browser side is what matters; a leftover server row is deleted on the next 410.
    await post(api, '/api/push/unsubscribe', { endpoint }).then(drain, () => undefined);
    return { success: true };
  } catch (err) {
    console.warn('Could not turn off notifications.', err);
    return { success: false };
  }
}

/**
 * Asks the server to tell `recipientId` about something you just did. Fire and
 * forget: never throws, never blocks the action that caused it. The server
 * checks the event really happened before sending anything.
 */
export async function sendPushToUser(api: PushApi, currentUserId: string, recipientId: string, type: SocialPushType, postId?: string): Promise<void> {
  if (!recipientId || recipientId === currentUserId || !api.accessToken) return;
  try {
    await drain(await post(api, '/api/push/send', { recipientId, type, postId }));
  } catch (err) {
    console.warn('Push not sent.', err);
  }
}

/** Schedules (or with null, cancels) a reminder push for this account. Fire and forget. */
export async function scheduleReminderPush(api: PushApi, type: ReminderPushType, fireAt: Date | null): Promise<void> {
  if (!api.accessToken) return;
  try {
    await drain(await post(api, '/api/push/schedule', { type, fireAt: fireAt ? fireAt.toISOString() : null }));
  } catch (err) {
    console.warn('Reminder push not scheduled.', err);
  }
}
