const CACHE_NAME = "kurogames-mobile-shell-v5";
const SHELL_URLS = [
  "/games/mobile/",
  "/games/mobile/mobile.css?v=20261126mobilefix1",
  "/games/mobile/mobile.js?v=20261126mobilefix1",
  "/games/mobile/manifest.webmanifest?v=20261126mobilefix1",
  "/games/mobile/subpage.css?v=20261126mobilefix1",
  "/games/mobile/subpage.js?v=20261126mobilefix1"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_URLS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("kurogames-mobile-shell-") && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/games/mobile/")) return;

  const isShellAsset = url.pathname === "/games/mobile/" ||
    url.pathname === "/games/mobile/index.html" ||
    url.pathname === "/games/mobile/mobile.css" ||
    url.pathname === "/games/mobile/mobile.js" ||
    url.pathname === "/games/mobile/manifest.webmanifest" ||
    url.pathname === "/games/mobile/subpage.css" ||
    url.pathname === "/games/mobile/subpage.js";

  if (!isShellAsset) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok && url.pathname === "/games/mobile/") {
          const cache = await caches.open(CACHE_NAME);
          cache.put("/games/mobile/", fresh.clone());
        }
        return fresh;
      } catch (_) {
        return (await caches.match("/games/mobile/")) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, fresh.clone());
    }
    return fresh;
  })());
});