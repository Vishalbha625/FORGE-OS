import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  bufferToBase64Url, detectDeviceTag, isPushSupported, mutedCategories, scheduleReminderPush, sendPushToUser, subscribeToPush, unsubscribeFromPush,
  urlBase64ToUint8Array, type PushApi,
} from '../lib/pushService';

// A throwaway VAPID public key (public keys are safe to commit).
const VAPID = 'BNSEg12kB_yg6NRXYXxSjPlIxUO7LSWo0MUrShzFxxnOT9WusilA53kGHg-ZlfI-gufHWeQ3Z7YQaYyDEaNll1k';
const API: PushApi = { baseUrl: 'https://coach.test', accessToken: 'user-token' };
const bytes = (...n: number[]) => new Uint8Array(n).buffer;

function fakeBrowser(existing: PushSubscription | null = null) {
  const unsubscribe = vi.fn(async () => true);
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    getKey: (k: string) => (k === 'p256dh' ? bytes(1, 2, 3, 250) : bytes(9, 8, 7)),
    unsubscribe,
  } as unknown as PushSubscription;
  const pushManager = { getSubscription: vi.fn(async () => existing), subscribe: vi.fn(async (_opts: PushSubscriptionOptionsInit) => subscription) };
  vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve({ pushManager }) }, userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile' });
  vi.stubGlobal('window', { PushManager: class {}, Notification: class {} });
  vi.stubGlobal('Notification', { permission: 'granted' });
  return { pushManager, subscription, unsubscribe };
}

const fetchOk = (body: unknown = {}, status = 200) => vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;

beforeEach(() => vi.stubEnv('VITE_VAPID_PUBLIC_KEY', VAPID));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('pushService', () => {
  it('subscribes with the VAPID key and saves the subscription on the server', async () => {
    const { pushManager } = fakeBrowser();
    const fetchMock = fetchOk({ subscribed: true }, 201);
    vi.stubGlobal('fetch', fetchMock);

    expect(await subscribeToPush(API, { muted: ['social'] })).toEqual({ success: true });
    const opts = pushManager.subscribe.mock.calls[0][0];
    expect(opts.userVisibleOnly).toBe(true);
    expect(Array.from(opts.applicationServerKey as Uint8Array)).toEqual(Array.from(urlBase64ToUint8Array(VAPID)));
    expect((opts.applicationServerKey as Uint8Array).length).toBe(65);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://coach.test/api/push/subscribe');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer user-token');
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'AQID-g', authKey: 'CQgH', deviceTag: 'phone', muted: ['social'] });
  });

  it('unsubscribes in the browser and tells the server', async () => {
    const { subscription, unsubscribe } = fakeBrowser();
    fakeBrowser(subscription);
    const fetchMock = fetchOk({ unsubscribed: true });
    vi.stubGlobal('fetch', fetchMock);

    expect(await unsubscribeFromPush(API)).toEqual({ success: true });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://coach.test/api/push/unsubscribe');
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' });
  });

  it('sendPushToUser names the event (never message text) and never throws', async () => {
    const fetchMock = fetchOk({ sent: true });
    vi.stubGlobal('fetch', fetchMock);
    await sendPushToUser(API, 'me', 'them', 'kudos_received', 'post-1');
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ recipientId: 'them', type: 'kudos_received', postId: 'post-1' });

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(sendPushToUser(API, 'me', 'them', 'comment_received', 'post-1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('sendPushToUser sends nothing about yourself', async () => {
    const fetchMock = fetchOk();
    vi.stubGlobal('fetch', fetchMock);
    await sendPushToUser(API, 'me', 'me', 'kudos_received', 'post-1');
    await sendPushToUser({ ...API, accessToken: '' }, 'me', 'them', 'kudos_received', 'post-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is not supported without PushManager', () => {
    fakeBrowser();
    expect(isPushSupported()).toBe(true);
    vi.stubGlobal('window', { Notification: class {} });
    expect(isPushSupported()).toBe(false);
  });

  it('schedules a reminder push with its fire time, and cancels with null', async () => {
    const fetchMock = fetchOk({ scheduled: true }, 201);
    vi.stubGlobal('fetch', fetchMock);
    await scheduleReminderPush(API, 'reminder_workout', new Date('2026-10-17T01:00:00Z'));
    await scheduleReminderPush(API, 'reminder_water', null);
    expect(fetchMock.mock.calls[0][0]).toBe('https://coach.test/api/push/schedule');
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ type: 'reminder_workout', fireAt: '2026-10-17T01:00:00.000Z' });
    expect(bodyOf(fetchMock.mock.calls[1])).toEqual({ type: 'reminder_water', fireAt: null });
  });

  it('reports a server that has push switched off, without asking the browser', async () => {
    const { pushManager } = fakeBrowser();
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');
    vi.stubGlobal('fetch', fetchOk({ enabled: false, publicKey: null }));
    expect(await subscribeToPush(API)).toEqual({ success: false, error: "Notifications aren't set up on the server yet." });
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('converts keys, tags devices and lists muted categories', () => {
    expect(bufferToBase64Url(urlBase64ToUint8Array('AQID-g').buffer)).toBe('AQID-g');
    expect(detectDeviceTag('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('desktop');
    expect(detectDeviceTag('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('phone');
    expect(mutedCategories({ enabled: true, categories: { social: false, water: false, meals: true } })).toEqual(['social', 'water']);
    expect(mutedCategories(undefined)).toEqual([]);
  });
});
