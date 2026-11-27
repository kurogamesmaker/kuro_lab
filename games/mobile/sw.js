// One-time cleanup worker for retired KURO GAMES mobile installs.
// It removes the old cached app, sends open app windows to the common game library,
// and unregisters itself. This file is intentionally kept until old installs update.
self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter(name => name.startsWith("kurogames-mobile-shell-"))
        .map(name => caches.delete(name))
    );
    await self.clients.claim();
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(windows.map(async client => {
      try {
        const pathname = new URL(client.url).pathname;
        if (pathname === "/games/mobile" || pathname.startsWith("/games/mobile/")) {
          await client.navigate("/games/");
        }
      } catch (_) {}
    }));
    await self.registration.unregister();
  })());
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/games/mobile/")) return;
  event.respondWith(Response.redirect(new URL("/games/", self.location.origin), 302));
});
