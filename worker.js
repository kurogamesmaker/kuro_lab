const FORCE_MARU_ICON_VERSION = "20261122forcefavicon3";

function applyMaruFavicon(html, requestPath = "") {
  const iconTags = /<link\b(?=[^>]*\brel\s*=\s*["'](?:icon|shortcut icon|apple-touch-icon)["'])[^>]*>/gi;
  const forcedLinks =
    '<link rel="icon" type="image/png" sizes="48x48" href="/assets/brand/logo/kurolab_icon_maru_48.png?v=' + FORCE_MARU_ICON_VERSION + '">' +
    '<link rel="shortcut icon" href="/assets/brand/logo/kurolab_icon_maru_48.png?v=' + FORCE_MARU_ICON_VERSION + '">' +
    '<link rel="apple-touch-icon" sizes="160x160" href="/assets/brand/logo/kurolab_icon_maru_160.png?v=' + FORCE_MARU_ICON_VERSION + '">';
  const rankTitleStyle =
    '<style id="kuro-rank-game-badge-worker-override">' +
    'html body #kuroRankingShowcase #kuroRankGame{' +
    'background:transparent!important;border:0!important;border-radius:0!important;box-shadow:none!important;padding:0!important;' +
    '}' +
    'html body #kuroRankingShowcase #kuroRankGame::before,' +
    'html body #kuroRankingShowcase #kuroRankGame::after,' +
    'html body #kuroRankingShowcase #kuroRankGame *::before,' +
    'html body #kuroRankingShowcase #kuroRankGame *::after{' +
    'content:none!important;display:none!important;visibility:hidden!important;opacity:0!important;' +
    'width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;' +
    'background:none!important;box-shadow:none!important;' +
    '}' +
    '</style>';
  const isGamePlayPath = /^\/games\/play(?:\/|$)/i.test(String(requestPath || ""));
  let cleanHtml = String(html || "").replace(iconTags, "");
  if (isGamePlayPath) {
    cleanHtml = cleanHtml.replace(
      /(<script\b[^>]*\bsrc\s*=\s*["']\/games\/recommendations\.js)(?:\?[^"']*)?(["'][^>]*>)/i,
      '$1?v=20261122-sidecards100fix1$2'
    );
  }
  const withFavicon = cleanHtml.replace(/<head\b[^>]*>/i, head => head + forcedLinks);
  const retiredRailGuard = isGamePlayPath
    ? '<style id="kuro-retired-rail-guard-style">' +
      'a[href*="/game/kaiten-sushi-typing"],a[href*="/game/block-blast"],' +
      'a[href*="id=5c1e658b-f6d3-412a-8b97-61d2c0457e95"],' +
      'a[href*="id=0e20bd78-127f-4473-948c-67d7282e7c71"]{display:none!important}' +
      '</style>' +
      '<script id="kuro-retired-rail-guard-script">' +
      '(()=>{const ids=new Set(["5c1e658b-f6d3-412a-8b97-61d2c0457e95","0e20bd78-127f-4473-948c-67d7282e7c71"]);' +
      'const names=["回転寿司","回転ずし","かいてんずし","ブロックブラスト","blockblast"];' +
      'const norm=s=>String(s||"").normalize("NFKC").replace(/[\\s_-]+/g,"").toLowerCase();' +
      'const bad=a=>{let u;try{u=new URL(a.getAttribute("href")||"",location.href)}catch(_){return false}' +
      'const label=norm([a.textContent,a.getAttribute("title"),...Array.from(a.querySelectorAll("img"),i=>i.alt)].join(" "));' +
      'return ids.has((u.searchParams.get("id")||"").toLowerCase())||' +
      '/^\\/game\\/(?:kaiten-sushi-typing|block-blast)(?:\\/|$)/i.test(u.pathname)||' +
      'names.some(n=>label.includes(norm(n)));};' +
      'const clean=()=>{document.querySelectorAll("a[href]").forEach(a=>{if(bad(a)){(a.closest(".kuro-auto-game,.kuro-side-game,.thumb,.game-card")||a).remove()}});' +
      'document.querySelectorAll(".kuro-game-rail").forEach(r=>{if(!r.querySelector("a[href]"))r.hidden=true})};' +
      'clean();new MutationObserver(clean).observe(document.documentElement,{childList:true,subtree:true,characterData:true});})();' +
      '</script>'
    : "";
  const suffix = rankTitleStyle + retiredRailGuard;
  return /<\/body>/i.test(withFavicon)
    ? withFavicon.replace(/<\/body>/i, suffix + "</body>")
    : withFavicon + suffix;
}

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

function safeSearchUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : "";
  } catch (_) {
    return "";
  }
}

async function webSearchCacheKey(request, query, mode) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(mode + "\\n" + query.toLowerCase()));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const url = new URL("/__kuro_search_cache/" + hash, request.url);
  return new Request(url.toString(), { method: "GET" });
}

async function handleWebSearch(request, env) {
  if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED", message: "POST required" }, 405);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 4096) return json({ code: "REQUEST_TOO_LARGE", message: "Request too large" }, 413);

  let input;
  try {
    input = await request.json();
  } catch (_) {
    return json({ code: "INVALID_JSON", message: "Invalid JSON body" }, 400);
  }

  const query = typeof input?.query === "string" ? input.query.trim().slice(0, 180) : "";
  const mode = String(input?.mode || "web").toLowerCase();
  if (!query) return json({ code: "QUERY_REQUIRED", message: "検索ワードを入力してください。" }, 400);
  if (!["web", "news", "images"].includes(mode)) {
    return json({ code: "INVALID_MODE", message: "Unsupported search mode" }, 400);
  }
  if (!env?.TAVILY_API_KEY) {
    return json({
      code: "SEARCH_PROVIDER_NOT_CONFIGURED",
      message: "Search provider is not configured."
    }, 503);
  }

  const cacheKey = await webSearchCacheKey(request, query, mode);
  try {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("X-KURO-Search-Cache", "HIT");
      return new Response(cached.body, { status: cached.status, headers });
    }
  } catch (_) {
    // Cache is an optimization; continue with the provider request if unavailable.
  }

  const requestBody = {
    query,
    search_depth: "basic",
    topic: mode === "news" ? "news" : "general",
    max_results: 8,
    include_answer: false,
    include_raw_content: false,
    include_images: mode === "images",
    include_image_descriptions: mode === "images",
    include_favicon: true,
    safe_search: true
  };

  let upstream;
  try {
    upstream = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.TAVILY_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(12000)
    });
  } catch (_) {
    return json({ code: "SEARCH_UPSTREAM_UNAVAILABLE", message: "Search provider is temporarily unavailable." }, 502);
  }

  if (!upstream.ok) {
    if (upstream.status === 401 || upstream.status === 403) {
      return json({ code: "SEARCH_PROVIDER_AUTH_ERROR", message: "検索サービスの認証設定を確認する必要があります。" }, 503);
    }
    if (upstream.status === 429) {
      return json({ code: "SEARCH_RATE_LIMITED", message: "検索が混み合っています。少し時間をおいてください。" }, 429);
    }
    return json({ code: "SEARCH_UPSTREAM_ERROR", message: "検索サービスでエラーが発生しました。" }, 502);
  }

  let data;
  try {
    data = await upstream.json();
  } catch (_) {
    return json({ code: "SEARCH_BAD_RESPONSE", message: "検索サービスから不正な応答が返されました。" }, 502);
  }

  const results = (Array.isArray(data.results) ? data.results : []).slice(0, 8).map(item => ({
    title: String(item.title || "").slice(0, 300),
    url: safeSearchUrl(item.url),
    snippet: String(item.content || "").slice(0, 900),
    date: String(item.published_date || "").slice(0, 40),
    favicon: safeSearchUrl(item.favicon)
  })).filter(item => item.url);

  const images = (Array.isArray(data.images) ? data.images : []).slice(0, 24).map(item => ({
    url: safeSearchUrl(item.url),
    description: String(item.description || "").slice(0, 220)
  })).filter(item => item.url);

  const response = new Response(JSON.stringify({
    query,
    mode,
    results,
    images,
    safeSearch: true
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=120",
      "X-KURO-Search-Cache": "MISS"
    }
  });

  try {
    await caches.default.put(cacheKey, response.clone());
  } catch (_) {
    // Search still succeeds when edge caching is unavailable.
  }
  return response;
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

    if (url.pathname === "/api/web-search") {
      try {
        return await handleWebSearch(request, env);
      } catch (error) {
        console.error("KURO web search handler failed", error);
        return json({ code: "SEARCH_INTERNAL_ERROR", message: "検索処理に失敗しました。" }, 500);
      }
    }

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

    // KURO SNS canonical entry: force legacy routes to the V2 experience.
    if (url.pathname === "/sns" || url.pathname === "/sns/" || url.pathname === "/sns/index.html") {
      const destination = new URL("/sns/v2/" + url.search + url.hash, url.origin);
      return new Response(null, {
        status: 302,
        headers: {
          "Location": destination.href,
          "Cache-Control": "no-store, max-age=0, must-revalidate",
          "Pragma": "no-cache"
        }
      });
    }

    if (url.pathname === "/favicon.ico") {
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/assets/brand/logo/kurolab_icon_maru_48.png?v=" + FORCE_MARU_ICON_VERSION,
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          "Pragma": "no-cache"
        }
      });
    }

    // Retired legacy games are no longer served. Send old bookmarks back to the current game library.
    if (/^\/game\/(?:kaiten-sushi-typing|block-blast)(?:\/|$)/i.test(url.pathname)) {
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/games/",
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          "Pragma": "no-cache"
        }
      });
    }

    const liveAssetFiles = new Map([
      ["/manifest.json", "manifest.json"],
      ["/sw.js", "sw.js"],
      ["/assets/brand/logo/kurolab_icon_48.png", "assets/brand/logo/kurolab_icon_48.png"],
      ["/assets/brand/logo/kurolab_icon_160.png", "assets/brand/logo/kurolab_icon_160.png"],
      ["/assets/brand/logo/kurolab_icon_800.png", "assets/brand/logo/kurolab_icon_800.png"],
      ["/assets/brand/logo/kurolab_icon_1254.png", "assets/brand/logo/kurolab_icon_1254.png"],
      ["/assets/brand/logo/kurolab_icon_toumei_48.png", "assets/brand/logo/kurolab_icon_toumei_48.png"],
      ["/assets/brand/logo/kurolab_icon_toumei_160.png", "assets/brand/logo/kurolab_icon_toumei_160.png"],
      ["/assets/brand/logo/kurolab_icon_toumei_800.png", "assets/brand/logo/kurolab_icon_toumei_800.png"],
      ["/assets/brand/logo/kurolab_icon_toumei_1254.png", "assets/brand/logo/kurolab_icon_toumei_1254.png"],
      ["/assets/brand/logo/kurolab_icon_maru_48.png", "assets/brand/logo/kurolab_icon_maru_48.png"],
      ["/assets/brand/logo/kurolab_icon_maru_160.png", "assets/brand/logo/kurolab_icon_maru_160.png"],
      ["/assets/brand/logo/kurolab_icon_maru_800.png", "assets/brand/logo/kurolab_icon_maru_800.png"],
      ["/assets/brand/logo/kurolab_icon_maru_1181.png", "assets/brand/logo/kurolab_icon_maru_1181.png"],
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
    // Resolve public site pages and static assets from the current main branch.
    // Explicit aliases handle special routes; generic paths handle new pages/assets.
    function liveRepoCandidates(pathname, mappedPath) {
      if (mappedPath) return [mappedPath];

      let decoded;
      try {
        decoded = decodeURIComponent(pathname);
      } catch (_) {
        return [];
      }

      if (
        !decoded.startsWith("/") ||
        decoded.includes(String.fromCharCode(92)) ||
        decoded.includes(String.fromCharCode(0)) ||
        decoded.split("/").some(part => part === "." || part === "..") ||
        /^\/(?:api|functions)(?:\/|$)/i.test(decoded) ||
        decoded.split("/").some(part => part.startsWith("."))
      ) {
        return [];
      }

      const relative = decoded.replace(/^\/+/, "").replace(/\/+$/, "");
      if (!relative) return ["index.html"];

      // Do not expose Worker or deployment configuration source files.
      if (["worker.js", "online-room-worker.js", "package.json", "vercel.json", "wrangler.jsonc"].includes(relative)) {
        return [];
      }

      const publicExtension = /[.](?:html?|css|js|mjs|json|svg|png|jpe?g|webp|avif|gif|ico|woff2?|ttf|otf|wasm|webmanifest|txt|xml|mp3|mp4|webm)$/i;
      if (publicExtension.test(relative)) return [relative];

      // Support directory index routes and legacy path.html routes.
      return [relative + "/index.html", relative + ".html"];
    }

    const mappedLiveAssetPath = liveAssetFiles.get(url.pathname);
    const liveAssetCandidates = liveRepoCandidates(url.pathname, mappedLiveAssetPath);
    if (liveAssetCandidates.length) {
      try {
        let liveAssetResponse = null;
        let resolvedLiveAssetPath = "";
        for (const candidate of liveAssetCandidates) {
          const encodedCandidate = candidate.split("/").map(part => encodeURIComponent(part)).join("/");
          const upstreamAssetUrl = new URL(
            "https://raw.githubusercontent.com/kurogamesmaker/kuro_lab/main/" + encodedCandidate
          );
          // Forward the page's version tag so each published revision gets a fresh upstream cache key.
          const requestedAssetVersion = url.searchParams.get("v");
          if (requestedAssetVersion && /^[A-Za-z0-9._-]{1,80}$/.test(requestedAssetVersion)) {
            upstreamAssetUrl.searchParams.set("kuro_asset_v", requestedAssetVersion);
          }
          const candidateResponse = await fetch(
            upstreamAssetUrl.toString(),
            { cf: { cacheEverything: true, cacheTtl: 15 } }
          );
          if (candidateResponse.ok) {
            liveAssetResponse = candidateResponse;
            resolvedLiveAssetPath = candidate;
            break;
          }
        }

        if (liveAssetResponse) {
          const headers = new Headers(liveAssetResponse.headers);
          const extension = resolvedLiveAssetPath.slice(resolvedLiveAssetPath.lastIndexOf(".") + 1).toLowerCase();
          const contentTypes = {
            html: "text/html; charset=utf-8",
            htm: "text/html; charset=utf-8",
            css: "text/css; charset=utf-8",
            js: "application/javascript; charset=utf-8",
            mjs: "application/javascript; charset=utf-8",
            json: "application/json; charset=utf-8",
            webmanifest: "application/manifest+json; charset=utf-8",
            svg: "image/svg+xml",
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            webp: "image/webp",
            avif: "image/avif",
            gif: "image/gif",
            ico: "image/x-icon",
            woff: "font/woff",
            woff2: "font/woff2",
            ttf: "font/ttf",
            otf: "font/otf",
            wasm: "application/wasm",
            txt: "text/plain; charset=utf-8",
            xml: "application/xml; charset=utf-8",
            mp3: "audio/mpeg",
            mp4: "video/mp4",
            webm: "video/webm"
          };
          const liveContentType = contentTypes[extension] || "application/octet-stream";
          headers.set("Content-Type", liveContentType);
          headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
          headers.set("Pragma", "no-cache");
          headers.delete("content-length");
          headers.delete("content-encoding");
          headers.delete("Speculation-Rules");
          headers.delete("Content-Security-Policy");
          headers.delete("Content-Security-Policy-Report-Only");

          if (liveContentType.startsWith("text/html")) {
            headers.set("Content-Security-Policy", "default-src 'self' https: data:; script-src 'self' 'unsafe-inline' https:; worker-src 'self' blob:; child-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https: wss:; frame-src 'self' https:; object-src 'none'; base-uri 'self'");
            const liveHtml = applyMaruFavicon(await liveAssetResponse.text(), url.pathname);
            return new Response(liveHtml, {
              status: liveAssetResponse.status,
              statusText: liveAssetResponse.statusText,
              headers
            });
          }

          return new Response(liveAssetResponse.body, {
            status: liveAssetResponse.status,
            statusText: liveAssetResponse.statusText,
            headers
          });
        }
      } catch (error) {
        console.error("KURO live repository asset failed", url.pathname, error);
      }
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const assetType = assetResponse.headers.get("content-type") || "";

    // Use the same no-stale-cache policy for every static fallback resource.
    const fallbackHeaders = new Headers(assetResponse.headers);
    fallbackHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    fallbackHeaders.set("Pragma", "no-cache");

    if (assetType.toLowerCase().includes("text/html")) {
      const html = await assetResponse.clone().text();
      const refreshedHtml = applyMaruFavicon(html, url.pathname);
      return new Response(refreshedHtml, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers: fallbackHeaders
      });
    }

    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers: fallbackHeaders
    });
  }
};
