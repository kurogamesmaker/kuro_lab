const KURO_CACHE = 'kuro-shell-v2';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('kuro-shell-') && key !== KURO_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (_) { payload = { body: event.data ? event.data.text() : '新しい通知があります' }; }
  const title = payload.title || 'KURO';
  const options = {
    body: payload.body || '新しいメッセージが届いたよ',
    icon: '/assets/brand/logo/kurolab_icon_maru_160.png?v=20261122forcefavicon3',
    badge: '/assets/brand/logo/kurolab_icon_maru_160.png?v=20261122forcefavicon3',
    tag: payload.tag || 'kuro-message',
    renotify: true,
    data: { url: payload.url || '/sns/mobile/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const fallback = new URL('/sns/mobile/', self.location.origin);
    let targetUrl = fallback;
    try {
      const requested = new URL(event.notification.data?.url || fallback.href, self.location.origin);
      // Notifications may navigate only within KURO SNS, never another site or an unrelated KURO page.
      if (requested.origin === self.location.origin && (requested.pathname === '/sns/v2' || requested.pathname.startsWith('/sns/'))) {
        targetUrl = requested;
      }
    } catch (_) {}
    const target = targetUrl.href;
    const appPrefix = new URL('/sns/', self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appWindow = windows.find(client => client.url.startsWith(appPrefix) && 'focus' in client);
    if (appWindow) {
      await appWindow.focus();
      if ('navigate' in appWindow) await appWindow.navigate(target);
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
