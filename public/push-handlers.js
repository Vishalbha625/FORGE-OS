/* Forge OS push handlers, loaded into the generated service worker with
 * importScripts (vite.config.ts). The server writes every message from fixed
 * text, so a push never carries health data. */

/** Only paths inside the app: a push can't send the user to another site. */
function safePath(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') && !/[\\\u0000-\u001f]/.test(url) ? url : '/';
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const type = typeof data.type === 'string' ? data.type : 'default';
  const isReminder = type.startsWith('reminder');
  event.waitUntil(
    self.registration.showNotification(typeof data.title === 'string' && data.title ? data.title : 'Forge OS', {
      body: typeof data.body === 'string' && data.body ? data.body : 'You have a new notification',
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      // Reminders share their tag with the app's own reminder notification, so
      // an open app and a push never show the same reminder twice.
      tag: type,
      renotify: isReminder,
      data: { url: safePath(data.url) },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (new URL(client.url).origin === self.location.origin) {
          client.postMessage({ type: 'NAVIGATE', url: targetUrl });
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
