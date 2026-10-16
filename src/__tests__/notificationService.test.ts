import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn() }));

import { getSupabase } from '../lib/supabase';
import { supabaseCircuit } from '../lib/circuitBreaker';
import {
  createNotification, deleteNotification, describeNotification, fetchNotifications, getUnreadCount, markAllAsRead, markAsRead,
} from '../lib/notificationService';
import { FakeBackend } from './integration/fakeBackend';

const VISHAL = '11111111-1111-4111-8111-111111111111';
const RIYA = '22222222-2222-4222-8222-222222222222';
const ARJUN = '33333333-3333-4333-8333-333333333333';
const POST = '99999999-9999-4999-8999-999999999999';
const NOW = Date.UTC(2026, 9, 16, 6, 0, 0);

let backend: FakeBackend;
beforeEach(() => {
  backend = new FakeBackend();
  backend.addUser(VISHAL, 'Vishal Bhardwaj');
  backend.addUser(RIYA, 'Riya Sharma');
  backend.addUser(ARJUN, 'Arjun Mehta');
  backend.tables.posts.push({ id: POST, author_id: RIYA, visibility: 'public', title: 'Sled push PB', created_at: '2026-10-15T05:00:00Z' });
  vi.mocked(getSupabase).mockReturnValue(backend.client());
  supabaseCircuit.reset();
});
afterEach(() => vi.unstubAllGlobals());

const kudos = (from: string) => backend.tables.kudos.push({ post_id: POST, user_id: from, created_at: backend.now() });

describe('notificationService', () => {
  it('creates the notification for the recipient, unread, and pushes it', async () => {
    kudos(VISHAL);
    backend.as(VISHAL);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"sent":true}'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await createNotification('kudos_received', VISHAL, RIYA, POST, undefined, { baseUrl: 'https://coach.test', accessToken: 't' });
    expect(res).toEqual({ data: 'created', error: null });
    expect(backend.tables.notifications).toEqual([expect.objectContaining({ user_id: RIYA, actor_id: VISHAL, type: 'kudos_received', post_id: POST, comment_id: null, read: false })]);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock.mock.calls[0][0]).toBe('https://coach.test/api/push/send');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ recipientId: RIYA, type: 'kudos_received', postId: POST });
  });

  it('never notifies you about yourself', async () => {
    backend.as(RIYA);
    expect((await createNotification('kudos_received', RIYA, RIYA, POST)).data).toBe('skipped');
    expect(backend.calls('notifications', 'insert')).toEqual([]);
  });

  it('notifies the same event at most once in 5 minutes', async () => {
    kudos(VISHAL);
    backend.as(VISHAL);
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const push = { baseUrl: '', accessToken: 't' };
    expect((await createNotification('kudos_received', VISHAL, RIYA, POST, undefined, push)).data).toBe('created');
    // Kudos removed and given again straight away.
    expect((await createNotification('kudos_received', VISHAL, RIYA, POST, undefined, push)).data).toBe('skipped');
    expect(backend.tables.notifications).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1); // a skipped notification sends no push either
    backend.advance(6 * 60_000);
    expect((await createNotification('kudos_received', VISHAL, RIYA, POST)).data).toBe('created');
  });

  it('skips events that never happened and anyone blocked', async () => {
    backend.as(VISHAL);
    expect((await createNotification('kudos_received', VISHAL, RIYA, POST)).data).toBe('skipped'); // no kudos given
    backend.tables.follows.push({ follower_id: VISHAL, followee_id: RIYA, status: 'pending', created_at: backend.now() });
    backend.tables.blocks.push({ blocker_id: RIYA, blocked_id: VISHAL, created_at: backend.now() });
    expect((await createNotification('follow_request', VISHAL, RIYA)).data).toBe('skipped');
    expect(backend.tables.notifications).toEqual([]);
  });

  it('lists newest first with the actor\'s name and the post title, a page at a time', async () => {
    kudos(VISHAL);
    kudos(ARJUN);
    backend.tables.follows.push({ follower_id: ARJUN, followee_id: RIYA, status: 'pending', created_at: backend.now() });
    backend.as(VISHAL);
    await createNotification('kudos_received', VISHAL, RIYA, POST);
    backend.as(ARJUN);
    await createNotification('kudos_received', ARJUN, RIYA, POST);
    await createNotification('follow_request', ARJUN, RIYA);

    backend.as(RIYA);
    const first = await fetchNotifications(RIYA, undefined, 2, NOW);
    expect(first.data?.data.map((n) => [n.type, n.actor.display_name, n.postTitle])).toEqual([
      ['follow_request', 'Arjun Mehta', undefined],
      ['kudos_received', 'Arjun Mehta', 'Sled push PB'],
    ]);
    expect(first.data?.hasMore).toBe(true);
    const second = await fetchNotifications(RIYA, first.data!.nextCursor!, 2, NOW);
    expect(second.data?.data.map((n) => n.actor.display_name)).toEqual(['Vishal Bhardwaj']);
    expect(second.data?.hasMore).toBe(false);
    // Older than 90 days: not shown.
    expect((await fetchNotifications(RIYA, undefined, 20, NOW + 91 * 24 * 3600_000)).data?.data).toEqual([]);
    // Nobody else can read them.
    backend.as(VISHAL);
    expect((await fetchNotifications(VISHAL, undefined, 20, NOW)).data?.data).toEqual([]);
  });

  it('counts unread, marks one or all read, and deletes', async () => {
    kudos(VISHAL);
    kudos(ARJUN);
    backend.as(VISHAL);
    await createNotification('kudos_received', VISHAL, RIYA, POST);
    backend.as(ARJUN);
    await createNotification('kudos_received', ARJUN, RIYA, POST);

    backend.as(RIYA);
    expect((await getUnreadCount(RIYA, NOW)).data).toBe(2);
    const [newest, older] = (await fetchNotifications(RIYA, undefined, 20, NOW)).data!.data;
    await markAsRead(newest.id, RIYA);
    expect((await getUnreadCount(RIYA, NOW)).data).toBe(1);
    await markAllAsRead(RIYA);
    expect((await getUnreadCount(RIYA, NOW)).data).toBe(0);
    expect(backend.tables.notifications.every((n) => n.read === true)).toBe(true);
    await deleteNotification(older.id, RIYA);
    expect(backend.tables.notifications.map((n) => n.id)).toEqual([newest.id]);
  });

  it('describes each notification and where a tap goes', () => {
    const actor = { id: ARJUN, display_name: 'Arjun Mehta', goals: [], created_at: '' };
    expect(describeNotification({ type: 'kudos_received', actor, postId: POST }, RIYA)).toEqual({ text: 'Arjun Mehta gave your post kudos', href: `/community/post/${POST}` });
    expect(describeNotification({ type: 'comment_received', actor, postId: POST }, RIYA).text).toBe('Arjun Mehta commented on your post');
    expect(describeNotification({ type: 'follow_request', actor }, RIYA)).toEqual({ text: 'Arjun Mehta wants to follow you', href: `/community/profile/${RIYA}/followers` });
    expect(describeNotification({ type: 'follow_accepted', actor }, RIYA)).toEqual({ text: 'Arjun Mehta accepted your follow request', href: `/community/profile/${ARJUN}` });
  });
});
