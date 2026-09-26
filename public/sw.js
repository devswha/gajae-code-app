// Push receiver for the installed web app. This worker deliberately has no
// fetch handler: nothing is cached and there is no offline mode, so a rebuild
// plus reload always serves the current assets. Its only jobs are to show a
// pushed notification and to bring the app to the pushed session on tap.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Gajae Code App', body: event.data.text() };
  }
  const data = payload.data || {};
  event.waitUntil(self.registration.showNotification(payload.title || 'Gajae Code App', {
    body: payload.body || '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    data,
    tag: data.tag || `${data.sessionId || 'global'}:${data.code || 'default'}`,
    renotify: true,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const sessionId = event.notification.data?.sessionId;
  const urlPath = sessionId ? `/session/${sessionId}` : '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const client = clients.find((candidate) => candidate.url.startsWith(self.location.origin));
    if (!client) return self.clients.openWindow(urlPath);
    await client.focus();
    // The client owns navigation; a window reload would drop its live socket.
    client.postMessage({ type: 'notification:navigate', urlPath });
    return undefined;
  }));
});
