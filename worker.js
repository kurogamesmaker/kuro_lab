const SUPABASE_URL = "https://cprvpphlfpmiegjiutjn.supabase.co";
const SUPABASE_KEY = "sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn";
const ALLOWED_PREFIXES = ["/rest/v1/", "/auth/v1/", "/storage/v1/"];
const ALLOWED_FUNCTIONS = new Set([
  "/functions/v1/admin-console",
  "/functions/v1/pro-access",
  "/functions/v1/send-chat-push",
  "/functions/v1/kurogames-online",
  "/functions/v1/kurogames-secret",
  "/functions/v1/username-auth"
]);
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function targetFor(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("..") || path.includes("://")) {
    throw new Error("Invalid Supabase path");
  }
  const pathname = path.split("?")[0];
  if (!ALLOWED_PREFIXES.some(prefix => pathname.startsWith(prefix)) && !ALLOWED_FUNCTIONS.has(pathname)) {
    throw new Error("Supabase path is not allowed");
  }
  const target = new URL(path, SUPABASE_URL);
  if (target.origin !== SUPABASE_URL) throw new Error("Invalid Supabase origin");
  return target;
}

function headersFor(input = {}) {
  const allowed = new Set([
    "authorization", "apikey", "content-type", "accept", "prefer", "range",
    "if-match", "if-none-match", "cache-control", "accept-profile",
    "content-profile", "x-client-info", "x-client-version", "x-upsert",
    "x-storage-api-version"
  ]);
  const headers = new Headers();
  for (const [key, value] of Object.entries(input)) {
    if (allowed.has(key.toLowerCase()) && value != null) headers.set(key, String(value));
  }
  if (!headers.has("apikey")) headers.set("apikey", SUPABASE_KEY);
  if (!headers.has("authorization")) headers.set("authorization", "Bearer " + SUPABASE_KEY);
  return headers;
}

function base64Encode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function base64Decode(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function proxy(payload) {
  const target = targetFor(payload.path);
  const method = String(payload.method || "GET").toUpperCase();
  if (!METHODS.has(method)) throw Object.assign(new Error("Method not allowed"), { status: 405 });

  const body = !["GET", "HEAD"].includes(method) && payload.bodyBase64
    ? base64Decode(payload.bodyBase64)
    : undefined;
  const upstream = await fetch(target.href, {
    method,
    headers: headersFor(payload.headers),
    body,
    redirect: "manual"
  });

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const isBinary = !/(json|text|xml|javascript|form|csv)/i.test(contentType);
  const responseHeaders = {};
  for (const name of [
    "content-type", "cache-control", "etag", "content-range", "accept-ranges",
    "last-modified", "location", "x-request-id", "preference-applied"
  ]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders[name] = value;
  }

  const bytes = new Uint8Array(await upstream.arrayBuffer());
  return {
    status: upstream.status,
    headers: responseHeaders,
    isBinary,
    bodyBase64: isBinary ? base64Encode(bytes) : "",
    bodyText: isBinary ? "" : new TextDecoder().decode(bytes),
    service: "KURO Cloudflare Supabase Proxy"
  };
}

async function handleRelay(request) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.searchParams.get("health") === "1") {
    return json({
      ready: true,
      service: "KURO Cloudflare Supabase Proxy",
      transport: "cloudflare-worker",
      realtimeProxy: true
    });
  }

  if (request.method === "GET") {
    const target = targetFor(url.searchParams.get("resource"));
    if (!target.pathname.startsWith("/storage/v1/object/public/")) {
      return json({ error: "Only public Storage objects may be fetched here" }, 403);
    }
    const upstream = await fetch(target.href, { headers: headersFor() });
    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
    headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    const etag = upstream.headers.get("etag");
    if (etag) headers.set("ETag", etag);
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  return json(await proxy(await request.json()));
}

async function handleRealtime(request) {
  const url = new URL(request.url);
  const prefix = "/api/realtime";
  const suffix = url.pathname.slice(prefix.length);
  if (!suffix.startsWith("/v1/") || suffix.includes("..") || suffix.includes("://")) {
    return json({ error: "Realtime path is not allowed" }, 404);
  }

  const target = new URL("/realtime" + suffix + url.search, SUPABASE_URL);
  if (target.origin !== SUPABASE_URL) return json({ error: "Invalid Realtime origin" }, 400);

  if ((request.headers.get("Upgrade") || "").toLowerCase() === "websocket") {
    const headers = new Headers({ Upgrade: "websocket" });
    const origin = request.headers.get("Origin");
    const protocol = request.headers.get("Sec-WebSocket-Protocol");
    if (origin) headers.set("Origin", origin);
    if (protocol) headers.set("Sec-WebSocket-Protocol", protocol);

    const upstream = await fetch(target.href, { headers });
    if (!upstream.webSocket) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: upstream.headers
      });
    }
    return new Response(null, { status: 101, webSocket: upstream.webSocket });
  }

  const upstream = await fetch(new Request(target.href, request));
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/cloudflare-relay") {
      try {
        return await handleRelay(request);
      } catch (error) {
        return json({
          ok: false,
          error: error?.message || "KURO Cloudflare relay failed"
        }, Number(error?.status) || 502);
      }
    }

    if (url.pathname === "/api/realtime" || url.pathname.startsWith("/api/realtime/")) {
      try {
        return await handleRealtime(request);
      } catch (error) {
        return json({
          ok: false,
          error: error?.message || "KURO Cloudflare Realtime relay failed"
        }, Number(error?.status) || 502);
      }
    }

    if (url.pathname.startsWith("/api/cloudflare-relay/")) {
      return json({ error: "Not found" }, 404);
    }

    const liveAssetFiles = new Map([
      ["/", "index.html"],
      ["/index.html", "index.html"],
      ["/search", "search/index.html"],
      ["/search/", "search/index.html"],
      ["/search/index.html", "search/index.html"],
      ["/favorites", "favorites/index.html"],
      ["/favorites/", "favorites/index.html"],
      ["/favorites/index.html", "favorites/index.html"],
      ["/history", "history/index.html"],
      ["/history/", "history/index.html"],
      ["/history/index.html", "history/index.html"],
      ["/notifications", "notifications/index.html"],
      ["/notifications/", "notifications/index.html"],
      ["/notifications/index.html", "notifications/index.html"],
      ["/mypage", "mypage/index.html"],
      ["/mypage/", "mypage/index.html"],
      ["/mypage/index.html", "mypage/index.html"],
      ["/achievements", "achievements/index.html"],
      ["/achievements/", "achievements/index.html"],
      ["/achievements/index.html", "achievements/index.html"],
      ["/request", "request/index.html"],
      ["/request/", "request/index.html"],
      ["/request/index.html", "request/index.html"],
      ["/settings", "settings/index.html"],
      ["/settings/", "settings/index.html"],
      ["/settings/index.html", "settings/index.html"],
      ["/tools", "tools/index.html"],
      ["/tools/", "tools/index.html"],
      ["/tools/index.html", "tools/index.html"],
      ["/about", "about/index.html"],
      ["/about/", "about/index.html"],
      ["/about/index.html", "about/index.html"],
      ["/guide", "guide/index.html"],
      ["/guide/", "guide/index.html"],
      ["/guide/index.html", "guide/index.html"],
      ["/faq", "faq/index.html"],
      ["/faq/", "faq/index.html"],
      ["/faq/index.html", "faq/index.html"],
      ["/features", "features/index.html"],
      ["/features/", "features/index.html"],
      ["/features/index.html", "features/index.html"],
      ["/guidelines", "guidelines/index.html"],
      ["/guidelines/", "guidelines/index.html"],
      ["/guidelines/index.html", "guidelines/index.html"],
      ["/developer", "developer/index.html"],
      ["/developer/", "developer/index.html"],
      ["/developer/index.html", "developer/index.html"],
      ["/privacy", "privacy/index.html"],
      ["/privacy/", "privacy/index.html"],
      ["/privacy/index.html", "privacy/index.html"],
      ["/terms", "terms/index.html"],
      ["/terms/", "terms/index.html"],
      ["/terms/index.html", "terms/index.html"],
      ["/security", "security/index.html"],
      ["/security/", "security/index.html"],
      ["/security/index.html", "security/index.html"],
      ["/contact", "contact/index.html"],
      ["/contact/", "contact/index.html"],
      ["/contact/index.html", "contact/index.html"],
      ["/pro", "pro/index.html"],
      ["/pro/", "pro/index.html"],
      ["/pro/index.html", "pro/index.html"],
      ["/pro-tools", "pro-tools/index.html"],
      ["/pro-tools/", "pro-tools/index.html"],
      ["/pro-tools/index.html", "pro-tools/index.html"],
      ["/theme-studio", "theme-studio/index.html"],
      ["/theme-studio/", "theme-studio/index.html"],
      ["/theme-studio/index.html", "theme-studio/index.html"],
      ["/admin", "admin/index.html"],
      ["/admin/", "admin/index.html"],
      ["/admin/index.html", "admin/index.html"],
      ["/portal.js", "portal.js"],
      ["/portal-enhancements.js", "portal-enhancements.js"],
      ["/theme-studio.js", "theme-studio.js"],
      ["/portal.css", "portal.css"],
      ["/site.css", "site.css"],
      ["/site-fixes.css", "site-fixes.css"],
      ["/usage-tracker.js", "usage-tracker.js"],
      ["/tools/tools.js", "tools/tools.js"],
      ["/tools/tools.css", "tools/tools.css"]
    ]);
    const liveAssetPath = liveAssetFiles.get(url.pathname);
    if (liveAssetPath) {
      try {
        const liveAssetResponse = await fetch(
          "https://raw.githubusercontent.com/kurogamesmaker/kuro_lab/2464a2a6cba075439131e418e2fae32c1101e7f2/" + liveAssetPath,
          { cf: { cacheEverything: true, cacheTtl: 60 } }
        );
        if (liveAssetResponse.ok) {
          const headers = new Headers(liveAssetResponse.headers);
          const lowerAssetPath = liveAssetPath.toLowerCase();
          const liveContentType = lowerAssetPath.endsWith(".js")
            ? "application/javascript; charset=utf-8"
            : lowerAssetPath.endsWith(".css")
              ? "text/css; charset=utf-8"
              : lowerAssetPath.endsWith(".json")
                ? "application/json; charset=utf-8"
                : lowerAssetPath.endsWith(".svg")
                  ? "image/svg+xml"
                  : "text/html; charset=utf-8";
          headers.set("Content-Type", liveContentType);
          headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");
          headers.set("Pragma", "no-cache");
          headers.delete("content-length");
          headers.delete("content-encoding");

          // Invalidate old browser-cached shared assets on every portal subpage.
          let liveBody = liveAssetResponse.body;
          if (liveContentType.startsWith("text/html")) {
            let liveHtml = await liveAssetResponse.text();
            const cacheVersion = "20261121subpagefix2";
            const sharedAssetVersions = [
              [/\/portal\.js\?v=[^"'&\\s]+/g, "/portal.js?v=" + cacheVersion],
              [/\/portal-enhancements\.js\?v=[^"'&\\s]+/g, "/portal-enhancements.js?v=" + cacheVersion],
              [/\/theme-studio\.js\?v=[^"'&\\s]+/g, "/theme-studio.js?v=" + cacheVersion],
              [/\/portal\.css\?v=[^"'&\\s]+/g, "/portal.css?v=" + cacheVersion],
              [/\/site\.css\?v=[^"'&\\s]+/g, "/site.css?v=" + cacheVersion],
              [/\/site-fixes\.css\?v=[^"'&\\s]+/g, "/site-fixes.css?v=" + cacheVersion],
              [/\/tools\/tools\.js\?v=[^"'&\\s]+/g, "/tools/tools.js?v=" + cacheVersion],
              [/\/tools\/tools\.css\?v=[^"'&\\s]+/g, "/tools/tools.css?v=" + cacheVersion],
              [/\/usage-tracker\.js\?v=[^"'&\\s]+/g, "/usage-tracker.js?v=" + cacheVersion]
            ];
            for (const [pattern, replacement] of sharedAssetVersions) {
              liveHtml = liveHtml.replace(pattern, replacement);
            }
            liveBody = liveHtml;
          }

          return new Response(liveBody, {
            status: liveAssetResponse.status,
            statusText: liveAssetResponse.statusText,
            headers
          });
        }
        console.error("KURO live asset origin returned", liveAssetResponse.status, liveAssetPath);
      } catch (error) {
        console.error("KURO live asset origin failed", liveAssetPath, error);
      }
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const assetType = assetResponse.headers.get("content-type") || "";

    // Refresh every KURO portal page's shared portal.js reference after transport fixes.
    if (assetType.toLowerCase().includes("text/html")) {
      const html = await assetResponse.text();
      if (html.includes("/portal.js?")) {
        const refreshedHtml = html.replace(/\/portal\.js\?v=[^"'&\s]+/g, "/portal.js?v=20261121usernamefix7");
        const headers = new Headers(assetResponse.headers);
        headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");
        headers.set("Pragma", "no-cache");
        return new Response(refreshedHtml, {
          status: assetResponse.status,
          statusText: assetResponse.statusText,
          headers
        });
      }
    }

    // Do not let a previously cached portal.js keep bypassing the Cloudflare relay.
    if (url.pathname === "/portal.js") {
      const headers = new Headers(assetResponse.headers);
      headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");
      headers.set("Pragma", "no-cache");
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers
      });
    }

    return assetResponse;
  }
};
