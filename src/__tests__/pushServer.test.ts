import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPush } from '../../server/push.mjs';
import { call, startServer, type RunningServer } from './serverHarness';

const VISHAL = '11111111-1111-4111-8111-111111111111';
const RIYA = '22222222-2222-4222-8222-222222222222';
const POST = '99999999-9999-4999-8999-999999999999';
const sub = (n: string, extra: Record<string, unknown> = {}) => ({ endpoint: `https://push.example/${n}`, p256dh: 'BPk3', authKey: 'a2V5', ...extra });

let server: RunningServer;
let sendNotification: ReturnType<typeof vi.fn>;
let clock = Date.parse('2026-10-16T06:00:00Z');

async function start() {
  sendNotification = vi.fn(async (s: { endpoint: string }) => {
    if (s.endpoint.includes('gone')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
    return { statusCode: 201 };
  });
  let push: ReturnType<typeof createPush> | undefined;
  server = await startServer(({ admin, asUser }) => {
    push = createPush({ admin, asUser, webpush: { sendNotification }, now: () => clock, log: { warn: () => {}, error: () => {} } });
    return { push, pushPublicKey: 'BPUBLIC' };
  });
  const b = server.backend;
  b.addUser(VISHAL, 'Vishal Bhardwaj');
  b.addUser(RIYA, 'Riya Sharma');
  b.tables.posts.push({ id: POST, author_id: RIYA, visibility: 'public', title: 'Sled push', created_at: '2026-10-16T05:00:00Z' });
  return push!;
}

afterEach(async () => {
  await server?.close();
  clock = Date.parse('2026-10-16T06:00:00Z');
});

describe('push server', () => {
  it('refuses every push endpoint without a valid sign-in', async () => {
    await start();
    for (const path of ['send', 'subscribe', 'unsubscribe', 'schedule']) {
      const res = await call(`${server.url}/api/push/${path}`, { body: { recipientId: RIYA, type: 'kudos_received', postId: POST } });
      expect(res.status, path).toBe(401);
    }
    expect((await call(`${server.url}/api/push/send`, { token: 'forged', body: { recipientId: RIYA, type: 'kudos_received' } })).status).toBe(401);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('deletes a subscription the push service says is gone (410)', async () => {
    await start();
    const riya = server.tokenFor(RIYA);
    await call(`${server.url}/api/push/subscribe`, { token: riya, body: sub('gone-phone', { deviceTag: 'phone' }) });
    await call(`${server.url}/api/push/subscribe`, { token: riya, body: sub('laptop') });
    server.backend.tables.kudos.push({ post_id: POST, user_id: VISHAL, created_at: '2026-10-16T05:59:00Z' });

    const res = await call(`${server.url}/api/push/send`, { token: server.tokenFor(VISHAL), body: { recipientId: RIYA, type: 'kudos_received', postId: POST } });
    expect(res).toEqual({ status: 200, body: { sent: true, deviceCount: 1 } });
    expect(server.backend.tables.push_subscriptions.map((s) => s.endpoint)).toEqual(['https://push.example/laptop']);
  });

  it('saves subscriptions with the caller\'s own rights, updates them in place, and removes them', async () => {
    await start();
    const riya = server.tokenFor(RIYA);
    expect((await call(`${server.url}/api/push/subscribe`, { token: riya, body: sub('a') })).status).toBe(201);
    expect((await call(`${server.url}/api/push/subscribe`, { token: riya, body: sub('a', { muted: ['social'] }) })).status).toBe(201);
    expect(server.backend.tables.push_subscriptions).toEqual([expect.objectContaining({ user_id: RIYA, endpoint: 'https://push.example/a', muted: ['social'] })]);
    expect(server.backend.log.filter((c) => c.table === 'push_subscriptions' && c.op === 'upsert').map((c) => c.as)).toEqual([RIYA, RIYA]);

    expect((await call(`${server.url}/api/push/subscribe`, { token: riya, body: { ...sub('b'), endpoint: 'http://insecure.example/x' } })).status).toBe(400);
    expect((await call(`${server.url}/api/push/subscribe`, { token: riya, body: sub('b', { muted: ['everything'] }) })).status).toBe(400);
    expect((await call(`${server.url}/api/push/unsubscribe`, { token: riya, body: { endpoint: 'https://push.example/a' } })).body).toEqual({ unsubscribed: true });
    expect(server.backend.tables.push_subscriptions).toEqual([]);
  });

  it('writes the message itself, and only after checking the event happened', async () => {
    await start();
    await call(`${server.url}/api/push/subscribe`, { token: server.tokenFor(RIYA), body: sub('phone') });
    const vishal = server.tokenFor(VISHAL);
    const kudos = { recipientId: RIYA, type: 'kudos_received', postId: POST, title: 'You won a prize', body: 'Click here' };

    // No kudos row yet: nothing is sent.
    expect((await call(`${server.url}/api/push/send`, { token: vishal, body: kudos })).body).toMatchObject({ sent: false, reason: 'not_found' });
    server.backend.tables.kudos.push({ post_id: POST, user_id: VISHAL, created_at: '2026-10-16T05:59:00Z' });
    expect((await call(`${server.url}/api/push/send`, { token: vishal, body: kudos })).body).toEqual({ sent: true, deviceCount: 1 });
    const payload = JSON.parse(sendNotification.mock.calls[0][1] as string) as Record<string, unknown>;
    expect(payload).toEqual({ title: 'Forge OS', body: 'Vishal Bhardwaj gave your post kudos', url: `/community/post/${POST}`, type: 'kudos_received' });

    // The same event again within 5 minutes: once is enough.
    expect((await call(`${server.url}/api/push/send`, { token: vishal, body: kudos })).body).toMatchObject({ sent: false, reason: 'duplicate' });
    // A follow request that doesn't exist is refused; one that does goes to the recipient's own followers page.
    expect((await call(`${server.url}/api/push/send`, { token: vishal, body: { recipientId: RIYA, type: 'follow_request' } })).body).toMatchObject({ reason: 'not_found' });
    server.backend.tables.follows.push({ follower_id: VISHAL, followee_id: RIYA, status: 'pending', created_at: '2026-10-16T06:00:00Z' });
    await call(`${server.url}/api/push/send`, { token: vishal, body: { recipientId: RIYA, type: 'follow_request' } });
    expect(JSON.parse(sendNotification.mock.calls[1][1] as string)).toMatchObject({ body: 'Vishal Bhardwaj wants to follow you', url: `/community/profile/${RIYA}/followers` });
  });

  it('respects blocks and the recipient\'s muted categories', async () => {
    await start();
    await call(`${server.url}/api/push/subscribe`, { token: server.tokenFor(RIYA), body: sub('phone', { muted: ['social'] }) });
    server.backend.tables.kudos.push({ post_id: POST, user_id: VISHAL, created_at: '2026-10-16T05:59:00Z' });
    const vishal = server.tokenFor(VISHAL);
    expect((await call(`${server.url}/api/push/send`, { token: vishal, body: { recipientId: RIYA, type: 'kudos_received', postId: POST } })).body).toEqual({ sent: false, deviceCount: 0 });

    server.backend.tables.blocks.push({ blocker_id: RIYA, blocked_id: VISHAL, created_at: '2026-10-16T06:00:00Z' });
    clock += 10 * 60_000;
    expect((await call(`${server.url}/api/push/send`, { token: vishal, body: { recipientId: RIYA, type: 'kudos_received', postId: POST } })).body).toMatchObject({ reason: 'blocked' });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('schedules reminder pushes with fixed text, replaces and cancels them, and sends them when due', async () => {
    const push = await start();
    const riya = server.tokenFor(RIYA);
    await call(`${server.url}/api/push/subscribe`, { token: riya, body: sub('phone') });
    const at = new Date(clock + 30 * 60_000).toISOString();
    expect((await call(`${server.url}/api/push/schedule`, { token: riya, body: { type: 'reminder_workout', fireAt: at } })).status).toBe(201);
    expect((await call(`${server.url}/api/push/schedule`, { token: riya, body: { type: 'reminder_workout', fireAt: at } })).status).toBe(201);
    expect((await call(`${server.url}/api/push/schedule`, { token: riya, body: { type: 'reminder_water', fireAt: at } })).status).toBe(201);
    expect((await call(`${server.url}/api/push/schedule`, { token: riya, body: { type: 'reminder_water', fireAt: null } })).body).toEqual({ scheduled: false });
    expect((await call(`${server.url}/api/push/schedule`, { token: riya, body: { type: 'free_text', fireAt: at } })).status).toBe(400);
    expect((await call(`${server.url}/api/push/schedule`, { token: riya, body: { type: 'reminder_meal_lunch', fireAt: '2027-12-01T00:00:00Z' } })).status).toBe(400);
    expect(push.scheduledCount()).toBe(1);

    expect(await push.tick()).toBe(0);
    clock += 31 * 60_000;
    expect(await push.tick()).toBe(1);
    expect(JSON.parse(sendNotification.mock.calls[0][1] as string)).toEqual({ title: 'Time to train', body: "Today's session is waiting.", url: '/', type: 'reminder_workout' });
    expect(push.scheduledCount()).toBe(0);
  });

  it('publishes its VAPID public key and says when push is off', async () => {
    await start();
    expect((await call(`${server.url}/api/push/config`)).body).toEqual({ enabled: true, publicKey: 'BPUBLIC' });
    await server.close();
    server = await startServer(() => ({}));
    expect((await call(`${server.url}/api/push/config`)).body).toEqual({ enabled: false, publicKey: null });
    expect((await call(`${server.url}/api/push/send`, { token: server.tokenFor(VISHAL), body: {} })).status).toBe(503);
  });
});
