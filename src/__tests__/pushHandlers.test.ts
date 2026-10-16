import { describe, it, expect, vi } from 'vitest';

// The service worker's push and notification-click handlers (public/push-handlers.js),
// run against a stand-in `self`.

declare const process: { cwd: () => string };
async function loadHandlers(clientsList: { url: string; focus: () => Promise<unknown>; postMessage: (m: unknown) => void }[] = []) {
  const fsModule = 'node:fs/promises';
  const { readFile } = (await import(/* @vite-ignore */ fsModule)) as { readFile: (p: string, enc: string) => Promise<string> };
  const code = await readFile(`${process.cwd()}/public/push-handlers.js`, 'utf8');
  const listeners: Record<string, (e: unknown) => void> = {};
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => undefined);
  const self = {
    location: { origin: 'https://forge.test' },
    registration: { showNotification },
    clients: { matchAll: vi.fn(async () => clientsList), openWindow },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners[type] = fn;
    },
  };
  new Function('self', code)(self);
  const fire = async (type: string, event: Record<string, unknown>) => {
    let waited: Promise<unknown> = Promise.resolve();
    listeners[type]({ ...event, waitUntil: (p: Promise<unknown>) => (waited = p) });
    await waited;
  };
  return { fire, showNotification, openWindow };
}

describe('service worker push handlers', () => {
  it('shows the server\'s text, tags reminders and keeps the tap target inside the app', async () => {
    const sw = await loadHandlers();
    await sw.fire('push', { data: { json: () => ({ title: 'Time to train', body: "Today's session is waiting.", url: '/', type: 'reminder_workout' }) } });
    expect(sw.showNotification).toHaveBeenCalledWith('Time to train', expect.objectContaining({ tag: 'reminder_workout', renotify: true, icon: '/icon-192.png', badge: '/badge-72.png', data: { url: '/' } }));
    await sw.fire('push', { data: { json: () => ({ title: 'Forge OS', body: 'x', url: 'https://evil.example/', type: 'kudos_received' }) } });
    expect(sw.showNotification).toHaveBeenLastCalledWith('Forge OS', expect.objectContaining({ renotify: false, data: { url: '/' } }));
    await sw.fire('push', { data: null });
    expect(sw.showNotification).toHaveBeenLastCalledWith('Forge OS', expect.objectContaining({ body: 'You have a new notification' }));
  });

  it('a tap focuses an open window and asks it to navigate, or opens one', async () => {
    const focus = vi.fn(async () => undefined);
    const postMessage = vi.fn();
    const open = await loadHandlers([{ url: 'https://forge.test/training', focus, postMessage }]);
    const close = vi.fn();
    await open.fire('notificationclick', { notification: { close, data: { url: '/community/post/p1' } } });
    expect(close).toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({ type: 'NAVIGATE', url: '/community/post/p1' });
    expect(focus).toHaveBeenCalled();
    expect(open.openWindow).not.toHaveBeenCalled();

    const closed = await loadHandlers([]);
    await closed.fire('notificationclick', { notification: { close: vi.fn(), data: { url: '/analytics' } } });
    expect(closed.openWindow).toHaveBeenCalledWith('/analytics');
  });
});
