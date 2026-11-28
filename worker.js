const FORCE_MARU_ICON_VERSION = "20261122forcefavicon3";
const FORCE_SECURITY_GATE_VERSION = "20261128gate4";

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
  const isSuspensionSupportPath = /^\/account\/suspension(?:\/|$)/i.test(String(requestPath || ""));
  const suspensionGuardTag = isSuspensionSupportPath
    ? ""
    : '<script id="kuro-suspension-guard-loader" src="/suspension-guard.js?v=20261127abortfix1"></script>';
  let cleanHtml = String(html || "").replace(iconTags, "");
  cleanHtml = cleanHtml.replace(/\/security\/kuro-security-gate\.js(?:\?[^"'\s]*)?/gi,
    "/security/kuro-security-gate.js?v=" + FORCE_SECURITY_GATE_VERSION
  );
  cleanHtml = cleanHtml.replace(/<script\b[^>]*\bid=["']kuro-suspension-guard-loader["'][^>]*><\/script>/gi, "");
  if (isGamePlayPath) {
    cleanHtml = cleanHtml.replace(
      /(<script\b[^>]*\bsrc\s*=\s*["']\/games\/recommendations\.js)(?:\?[^"']*)?(["'][^>]*>)/i,
      '$1?v=20261122-sidecards100fix1$2'
    );
  }
  const withFavicon = cleanHtml.replace(/<head\b[^>]*>/i, head => head + forcedLinks + suspensionGuardTag);
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
  "/functions/v1/username-auth",
  "/functions/v1/kurogames-activity",
  "/functions/v1/kurogames-store",
  "/functions/v1/kuro-public-coin-balance",
  "/functions/v1/change-password",
  "/functions/v1/delete-account",
  "/functions/v1/kuro-security-gate"
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

async function handleTurnstileVerify(request, env) {
 const origin=request.headers.get("Origin")||"";
 const allowedOrigins=new Set(["https://kurolab.cc.cd","https://www.kurolab.cc.cd"]);
 if(request.method==="OPTIONS"){
  return new Response(null,{status:allowedOrigins.has(origin)?204:403,headers:{
   "access-control-allow-origin":allowedOrigins.has(origin)?origin:"null",
   "access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"content-type",
   "access-control-max-age":"600","vary":"Origin"
  }});
 }
 if(request.method!=="POST")return json({success:false,code:"method_not_allowed",message:"POST required"},405);
 if(!allowedOrigins.has(origin))return json({success:false,code:"origin_not_allowed",message:"Origin not allowed"},403);
 if(!env?.TURNSTILE_SECRET)return json({success:false,code:"secret_not_configured",message:"Human verification is not configured"},503);
 let body;
 try{body=await request.json()}catch(_){return json({success:false,code:"invalid_json",message:"Invalid JSON"},400)}
 const token=typeof body?.token==="string"?body.token.trim():"";
 if(!token||token.length>2048)return json({success:false,code:"invalid_token_format",message:"Invalid verification token"},400);

 try{
  const upstream=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
   method:"POST",
   headers:{"content-type":"application/json","accept":"application/json"},
   body:JSON.stringify({secret:env.TURNSTILE_SECRET,response:token})
  });
  const responseText=await upstream.text();
  let result=null;
  try{result=responseText?JSON.parse(responseText):null;}catch(_){result=null;}

  const knownCodes=new Set(["missing-input-secret","invalid-input-secret","missing-input-response","invalid-input-response","bad-request","timeout-or-duplicate","internal-error"]);
  const errorCodes=Array.isArray(result?.["error-codes"])?result["error-codes"].filter(code=>knownCodes.has(code)):[];
  if(!upstream.ok){
   const code=errorCodes.includes("invalid-input-secret")||errorCodes.includes("missing-input-secret")
    ?"turnstile_secret_rejected":"siteverify_http_error";
   console.error("Turnstile Siteverify HTTP failure",{status:upstream.status,errorCodes,responseType:upstream.headers.get("content-type")||"unknown"});
   return json({
    success:false,code,upstreamStatus:upstream.status,errorCodes,
    message:code==="turnstile_secret_rejected"
     ?"TurnstileのSecret Keyが拒否されました。CloudflareのSecret設定を確認してください。"
     :"Turnstile検証サービスがリクエストを拒否しました。表示された診断コードを確認してください。"
   },502);
  }
  if(!result||typeof result!=="object"){
   console.error("Turnstile Siteverify returned invalid JSON",{status:upstream.status,contentType:upstream.headers.get("content-type")||"unknown"});
   return json({success:false,code:"siteverify_invalid_response",message:"人間確認サービスから不正な応答が返されました。"},502);
  }
  if(result.success!==true){
   console.warn("Turnstile Siteverify rejected token",{errorCodes});
   return json({success:false,code:"turnstile_rejected",errorCodes,message:"人間確認に失敗しました。ページを再読み込みして、もう一度お試しください。"},403);
  }
  const expectedHostnames=new Set(["kurolab.cc.cd","www.kurolab.cc.cd"]);
  if(typeof result.hostname!=="string"||!expectedHostnames.has(result.hostname.toLowerCase())){
   console.warn("Turnstile hostname mismatch",{hostname:typeof result.hostname==="string"?result.hostname:"missing"});
   return json({success:false,code:"hostname_mismatch",message:"認証元ドメインが一致しません。サイト設定を確認してください。"},403);
  }
  return json({success:true});
 }catch(error){
  console.error("Turnstile Siteverify unavailable",{name:error?.name||"Error",message:String(error?.message||error).slice(0,180)});
  return json({success:false,code:"siteverify_unavailable",message:"人間確認サービスに接続できません。"},502);
 }
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

const ipBanStatusCache = new Map();
const IP_BAN_CACHE_MS = 3000;
async function checkActiveIpBan(ip, edgeKey) {
  const normalized = typeof ip === "string" ? ip.trim() : "";
  if (!edgeKey) throw new Error("IP BAN edge secret is not configured.");
  if (!normalized || normalized.length > 64 || normalized.includes("/")) return null;
  const cached = ipBanStatusCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/kuro_ip_ban_check", {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, authorization: "Bearer " + SUPABASE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ p_ip: normalized, p_edge_key: edgeKey })
  });
  if (!response.ok) throw new Error("IP BAN status lookup failed: " + response.status);
  const result = await response.json();
  const value = result && result.blocked === true
    ? { scope: result.scope === "all" ? "all" : "write", expiresAt: typeof result.expires_at === "string" ? result.expires_at : null }
    : null;
  if (ipBanStatusCache.size > 1000) ipBanStatusCache.clear();
  ipBanStatusCache.set(normalized, { value, expiresAt: Date.now() + IP_BAN_CACHE_MS });
  return value;
}
function isIpBanRecoveryRequest(pathname, method) {
  const verb = String(method || "GET").toUpperCase();
  return (pathname === "/auth/v1/token" && verb === "POST") ||
    (pathname === "/auth/v1/user" && verb === "GET") ||
    (pathname === "/rest/v1/admin_users" && ["GET", "HEAD"].includes(verb)) ||
    (pathname.startsWith("/rest/v1/rpc/kuro_ip_ban_admin_") && verb === "POST");
}
function isIpBanBlocked(ban, pathname, method, webSocket = false) {
  if (!ban || isIpBanRecoveryRequest(pathname, method)) return false;
  if (ban.scope === "all") return true;
  return webSocket || !["GET", "HEAD", "OPTIONS"].includes(String(method || "GET").toUpperCase());
}
function ipBanBlockedResult(ban) {
  return {
    status: 403,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    isBinary: false, bodyBase64: "",
    bodyText: JSON.stringify({
      code: "IP_BANNED",
      error: "このネットワークからのアクセスまたは操作は制限されています。",
      scope: ban?.scope === "all" ? "all" : "write",
      expires_at: ban?.expiresAt || null
    }),
    service: "KURO IP BAN"
  };
}
function isIpBanAdminPage(pathname) {
  return pathname === "/admin" || pathname === "/admin/" || pathname === "/admin/index.html" ||
    pathname.startsWith("/assets/brand/logo/");
}
async function checkIncomingIpBan(request, url, edgeKey) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return null;
  const ban = await checkActiveIpBan(ip, edgeKey);
  if (!ban || url.pathname === "/api/cloudflare-relay") return null;
  if (ban.scope === "all" && isIpBanAdminPage(url.pathname)) return null;
  if (url.pathname === "/api/web-search" && ban.scope === "write") return null;
  if (isIpBanBlocked(ban, url.pathname, request.method,
      (request.headers.get("Upgrade") || "").toLowerCase() === "websocket")) {
    return new Response(JSON.stringify({
      code: "IP_BANNED",
      error: "このネットワークからのアクセスまたは操作は制限されています。",
      scope: ban.scope, expires_at: ban.expiresAt || null
    }), { status: 403, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }
  return null;
}

const PROTECTED_CLIENT_TOOLS = new Map([
  ["admin-console", "admin"],
  ["shop-studio", "shop-studio"],
  ["kuro-security-monitor", "security-monitor"],
  ["game-studio", "game-studio"]
]);

const suspensionStatusCache = new Map();

async function checkActiveSuspension(headers) {
  const authorization = headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  if (!bearer) return null;

  // The JWT subject is used only to form the lookup. Supabase verifies the
  // bearer token and applies RLS to the query before returning any row.
  let claims;
  try {
    const part = bearer[1].split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    claims = JSON.parse(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)));
  } catch (_) {
    return null;
  }
  const userId = typeof claims?.sub === "string" ? claims.sub : "";
  if (!userId || claims?.is_anonymous) return null;
  const cachedStatus = suspensionStatusCache.get(userId);
  if (cachedStatus && cachedStatus.expiresAt > Date.now()) return cachedStatus.value;

  const authHeaders = new Headers({
    apikey: headers.get("apikey") || SUPABASE_KEY,
    authorization
  });
  const now = new Date().toISOString();
  const query = new URLSearchParams({
    select: "id,ends_at",
    user_id: "eq." + userId,
    revoked_at: "is.null",
    starts_at: "lte." + now,
    ends_at: "gt." + now,
    limit: "1"
  });
  const statusResponse = await fetch(
    SUPABASE_URL + "/rest/v1/account_suspensions?" + query.toString(),
    { headers: authHeaders }
  );
  if (statusResponse.status === 401) return null;
  if (!statusResponse.ok) {
    throw Object.assign(
      new Error("アカウントの利用状態を確認できません。時間をおいて再度お試しください。"),
      { status: 503 }
    );
  }
  const rows = await statusResponse.json().catch(() => []);
  const suspension = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (suspensionStatusCache.size > 500) suspensionStatusCache.clear();
  suspensionStatusCache.set(userId, { value: suspension, expiresAt: Date.now() + 4000 });
  return suspension;
}

function isSuspensionAllowedRequest(pathname, method) {
  // Only these endpoints are needed by the dedicated suspension support page.
  if (pathname === "/rest/v1/account_suspensions" && ["GET", "HEAD"].includes(method)) return true;
  if (pathname === "/rest/v1/account_suspension_appeals" && ["GET", "HEAD", "POST"].includes(method)) return true;
  if (pathname === "/rest/v1/account_suspension_appeal_messages" && ["GET", "HEAD", "POST"].includes(method)) return true;
  if (pathname === "/rest/v1/admin_message_reads" && ["POST", "PATCH", "DELETE"].includes(method)) return true;
  if (pathname === "/rest/v1/usage_events" && method === "POST") return true;
  if (pathname === "/functions/v1/change-password" && method === "POST") return true;
  if (pathname === "/functions/v1/delete-account" && method === "POST") return true;
  return false;
}

async function proxy(payload, clientIp = null, edgeKey = null, clientRequest = null) {
  const target = targetFor(payload.path);
  const method = String(payload.method || "GET").toUpperCase();
  if (!METHODS.has(method)) throw Object.assign(new Error("Method not allowed"), { status: 405 });

  const requestHeaders = headersFor(payload.headers);
  const clientId = String(payload.clientId || "");
  const protectedTool = PROTECTED_CLIENT_TOOLS.get(clientId);
  const guardedPath = target.pathname.startsWith("/rest/v1/") ||
    target.pathname.startsWith("/storage/v1/") ||
    (target.pathname.startsWith("/functions/v1/") && target.pathname !== "/functions/v1/kuro-security-gate");
  if (protectedTool && guardedPath) {
    const authorization = requestHeaders.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) {
      return {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        isBinary: false,
        bodyBase64: "",
        bodyText: JSON.stringify({ error: "KURO Security Gateにはログインが必要です。" }),
        service: "KURO Security Gate"
      };
    }
    const gateHeaders = new Headers({
      "authorization": authorization,
      "apikey": requestHeaders.get("apikey") || SUPABASE_KEY,
      "content-type": "application/json",
      "origin": "https://kurolab.cc.cd"
    });
    if (clientIp) gateHeaders.set("x-real-ip", clientIp);
    const userAgent = clientRequest?.headers.get("user-agent") || "";
    const platform = clientRequest?.headers.get("sec-ch-ua-platform") || "";
    const language = clientRequest?.headers.get("accept-language") || "";
    if (userAgent) gateHeaders.set("user-agent", userAgent);
    if (platform) gateHeaders.set("sec-ch-ua-platform", platform);
    if (language) gateHeaders.set("accept-language", language);

    const gateResponse = await fetch(SUPABASE_URL + "/functions/v1/kuro-security-gate", {
      method: "POST",
      headers: gateHeaders,
      body: JSON.stringify({ action: "check", tool: protectedTool })
    });
    const gateResult = await gateResponse.json().catch(() => ({}));
    if (!gateResponse.ok || gateResult?.allowed !== true) {
      const status = gateResponse.status >= 500 ? 503 : (gateResponse.status === 401 ? 401 : 403);
      return {
        status,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        isBinary: false,
        bodyBase64: "",
        bodyText: JSON.stringify({ error: gateResult?.message || "KURO Security Gateでアクセスが拒否されました。" }),
        service: "KURO Security Gate"
      };
    }
  }
  if (clientIp) {
    try {
      const ipBan = await checkActiveIpBan(clientIp, edgeKey);
      if (isIpBanBlocked(ipBan, target.pathname, method)) return ipBanBlockedResult(ipBan);
    } catch (error) {
      console.error("KURO IP BAN lookup failed", error?.message || error);
    }
  }
  if (
    (target.pathname.startsWith("/rest/v1/") || target.pathname.startsWith("/functions/v1/")) &&
    !isSuspensionAllowedRequest(target.pathname, method)
  ) {
    const suspension = await checkActiveSuspension(requestHeaders);
    if (suspension) {
      return {
        status: 403,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store"
        },
        isBinary: false,
        bodyBase64: "",
        bodyText: JSON.stringify({
          code: "ACCOUNT_TEMPORARILY_SUSPENDED",
          error: "このアカウントは一時停止中です。解除予定：" + suspension.ends_at + "。問い合わせは一時停止画面から行えます。",
          ends_at: suspension.ends_at
        }),
        service: "KURO account suspension guard"
      };
    }
  }

  const body = !["GET", "HEAD"].includes(method) && payload.bodyBase64
    ? base64Decode(payload.bodyBase64)
    : undefined;
  const upstream = await fetch(target.href, {
    method,
    headers: requestHeaders,
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

async function handleRelay(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    try {
      const ipBan = await checkActiveIpBan(request.headers.get("CF-Connecting-IP"), env?.IP_BAN_EDGE_KEY);
      if (isIpBanBlocked(ipBan, "/api/cloudflare-relay", "GET")) {
        const blocked = ipBanBlockedResult(ipBan);
        return new Response(blocked.bodyText, { status: blocked.status, headers: blocked.headers });
      }
    } catch (error) {
      console.error("KURO IP BAN lookup failed", error?.message || error);
    }
  }
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
    const isPublicObject = target.pathname.startsWith("/storage/v1/object/public/");
    const isSignedPrivateMedia =
      target.pathname.startsWith("/storage/v1/object/sign/kuro-sns-private-media/") &&
      Boolean(target.searchParams.get("token"));
    if (!isPublicObject && !isSignedPrivateMedia) {
      return json({ error: "Only public objects or token-signed KURO SNS private media may be fetched here" }, 403);
    }
    const upstream = await fetch(target.href, {
      headers: isPublicObject ? headersFor() : new Headers({ apikey: SUPABASE_KEY })
    });
    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
    headers.set(
      "Cache-Control",
      isPublicObject ? "public, max-age=300, stale-while-revalidate=600" : "private, no-store"
    );
    const etag = upstream.headers.get("etag");
    if (etag) headers.set("ETag", etag);
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  return json(await proxy(await request.json(), request.headers.get("CF-Connecting-IP"), env?.IP_BAN_EDGE_KEY, request));
}


async function handleStorageRelay(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.searchParams.get("health") === "1") {
    return json({ ready: true, service: "KURO Supabase Storage Relay", onlyStorage: true });
  }
  if (request.method === "GET") {
    const resource = url.searchParams.get("resource");
    let target;
    try {
      target = targetFor(resource);
    } catch (_) {
      return json({ error: "Storage resource is required" }, 400);
    }
    if (!target.pathname.startsWith("/storage/v1/")) {
      return json({ error: "Only Supabase Storage resources are allowed" }, 403);
    }
    // handleRelay enforces public-object or token-signed KURO SNS private-media reads.
    return handleRelay(request, env);
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return json({ error: "Invalid JSON" }, 400);
  }
  let target;
  try {
    target = targetFor(payload?.path);
  } catch (_) {
    return json({ error: "Storage path is invalid" }, 400);
  }
  if (!target.pathname.startsWith("/storage/v1/")) {
    return json({ error: "Only Supabase Storage operations are allowed" }, 403);
  }
  return json(await proxy(payload, request.headers.get("CF-Connecting-IP"), env?.IP_BAN_EDGE_KEY, request));
}


async function handleMigrationHealth(request, env) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer\\s+\\S+/i.test(authorization)) {
    return json({ error: "管理者ログインが必要です。" }, 401);
  }

  // Verify the current admin role against the live Supabase security gate.
  // D1's copied admin_users table is deliberately not used for authorization.
  let gateResponse;
  try {
    const gateHeaders = new Headers({
      authorization,
      apikey: SUPABASE_KEY,
      "content-type": "application/json",
      origin: "https://kurolab.cc.cd"
    });
    const clientIp = request.headers.get("CF-Connecting-IP");
    if (clientIp) gateHeaders.set("x-real-ip", clientIp);
    gateResponse = await fetch(SUPABASE_URL + "/functions/v1/kuro-security-gate", {
      method: "POST",
      headers: gateHeaders,
      body: JSON.stringify({ action: "check", tool: "admin" })
    });
  } catch (_) {
    return json({ error: "管理者権限の確認サービスに接続できません。" }, 503);
  }

  const gateResult = await gateResponse.json().catch(() => ({}));
  if (!gateResponse.ok || gateResult?.allowed !== true) {
    const status = gateResponse.status >= 500 ? 503 : (gateResponse.status === 401 ? 401 : 403);
    return json({ error: gateResult?.message || "管理者権限がありません。" }, status);
  }

  const database = env?.KURO_MIGRATION_DB;
  if (!database) return json({ error: "D1 migration database binding is unavailable." }, 503);

  try {
    const manifestResult = await database.prepare(
      "SELECT table_name, copied_rows, source_row_estimate, copied_at FROM __kuro_schema_manifest ORDER BY table_name"
    ).all();
    const manifest = Array.isArray(manifestResult?.results) ? manifestResult.results : [];
    if (!manifest.length || manifest.length > 120) {
      return json({ error: "D1 migration manifest is missing or invalid." }, 503);
    }

    let actualRows = 0;
    const mismatches = [];
    for (let offset = 0; offset < manifest.length; offset += 20) {
      const batch = manifest.slice(offset, offset + 20);
      const statements = batch.map(row => {
        const tableName = String(row.table_name || "");
        if (!/^[a-z][a-z0-9_]*$/.test(tableName)) {
          throw new Error("Invalid table name in migration manifest");
        }
        return database.prepare('SELECT COUNT(*) AS row_count FROM "' + tableName + '"');
      });
      const results = await database.batch(statements);
      for (let index = 0; index < batch.length; index++) {
        const expected = Number(batch[index].copied_rows || 0);
        const actual = Number(results[index]?.results?.[0]?.row_count || 0);
        actualRows += actual;
        if (actual !== expected) {
          mismatches.push({ table: batch[index].table_name, expected, actual });
        }
      }
    }

    const copiedRows = manifest.reduce((sum, row) => sum + Number(row.copied_rows || 0), 0);
    const estimateVariance = manifest
      .filter(row => Number(row.source_row_estimate || 0) !== Number(row.copied_rows || 0))
      .map(row => ({
        table: row.table_name,
        sourceEstimate: Number(row.source_row_estimate || 0),
        copiedRows: Number(row.copied_rows || 0)
      }));
    const copiedAt = manifest.map(row => String(row.copied_at || "")).filter(Boolean).sort();

    return json({
      ready: true,
      database: "kuro-migration-copy",
      mode: "read-only-diagnostics",
      productionDatabaseUnchanged: true,
      manifestTableCount: manifest.length,
      manifestCopiedRows: copiedRows,
      actualCopiedRows: actualRows,
      mismatchCount: mismatches.length,
      mismatches: mismatches.slice(0, 20),
      sourceEstimateVarianceCount: estimateVariance.length,
      sourceEstimateVariance: estimateVariance,
      firstCopiedAt: copiedAt[0] || null,
      lastCopiedAt: copiedAt[copiedAt.length - 1] || null,
      writesPerformed: false
    });
  } catch (error) {
    console.error("KURO D1 migration diagnostics failed", error?.message || error);
    return json({ error: "D1コピーの整合性検査に失敗しました。" }, 503);
  }
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

const ONLINE_ROOM_WORKER = "https://kuro-online-room.kurogamesmaker.workers.dev";

async function handleOnlineRoom(request) {
  const url = new URL(request.url);
  const prefix = "/api/online-room";
  const suffix = url.pathname.slice(prefix.length);

  if (suffix === "/health" && request.method === "GET") {
    const upstream = await fetch(ONLINE_ROOM_WORKER + "/health", {
      headers: { "accept": "application/json" },
    });
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
        "cache-control": "no-store",
      },
    });
  }

  if (suffix === "/ticket") {
    if (request.method === "OPTIONS") {
      const origin = request.headers.get("Origin") || "";
      const allowed = origin === "null" ||
        origin === "https://kurolab.cc.cd" ||
        origin === "https://www.kurolab.cc.cd";
      return new Response(null, {
        status: allowed ? 204 : 403,
        headers: {
          "access-control-allow-origin": allowed ? origin : "null",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "authorization, content-type",
          "access-control-max-age": "600",
          "vary": "Origin",
        },
      });
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const authorization = request.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const headers = new Headers({
      "content-type": "application/json",
      "authorization": authorization,
    });
    const origin = request.headers.get("Origin");
    if (origin) headers.set("Origin", origin);

    const upstream = await fetch(ONLINE_ROOM_WORKER + "/ticket", {
      method: "POST",
      headers,
      body: await request.arrayBuffer(),
      redirect: "manual",
    });
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("cache-control", "no-store");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  }

  const match = suffix.match(/^\/room\/([A-Za-z0-9_-]{1,128})$/);
  if (match) {
    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
      return json({ error: "websocket_required" }, 426);
    }
    const target = new URL("/room/" + match[1] + url.search, ONLINE_ROOM_WORKER);
    const headers = new Headers({ Upgrade: "websocket" });
    const origin = request.headers.get("Origin");
    const protocol = request.headers.get("Sec-WebSocket-Protocol");
    if (origin) headers.set("Origin", origin);
    if (protocol) headers.set("Sec-WebSocket-Protocol", protocol);

    const upstream = await fetch(target.href, { headers });
    if (!upstream.webSocket) {
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: upstream.headers,
      });
    }
    return new Response(null, { status: 101, webSocket: upstream.webSocket });
  }

  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      const ipBanResponse = await checkIncomingIpBan(request, url, env?.IP_BAN_EDGE_KEY);
      if (ipBanResponse) return ipBanResponse;
    } catch (error) {
      console.error("KURO IP BAN lookup failed", error?.message || error);
    }

    // The dedicated mobile game app has been retired. Keep only its service-worker
    // cleanup script reachable so installed copies can unregister and clear old caches.
    if ((url.pathname === "/games/mobile" || url.pathname.startsWith("/games/mobile/")) &&
        url.pathname !== "/games/mobile/sw.js") {
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/games/" + url.search,
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          "Pragma": "no-cache"
        }
      });
    }

    if (url.pathname === "/api/turnstile/verify") {
      try { return await handleTurnstileVerify(request, env); }
      catch (error) { console.error("Turnstile verify handler failed", error); return json({ success: false, message: "Human verification failed" }, 500); }
    }

    if (url.pathname === "/api/web-search") {
      try {
        return await handleWebSearch(request, env);
      } catch (error) {
        console.error("KURO web search handler failed", error);
        return json({ code: "SEARCH_INTERNAL_ERROR", message: "検索処理に失敗しました。" }, 500);
      }
    }

    if (url.pathname === "/api/online-room" || url.pathname.startsWith("/api/online-room/")) {
      try {
        return await handleOnlineRoom(request);
      } catch (error) {
        console.error("KURO online room proxy failed", error);
        return json({
          error: error?.message || "KURO online room proxy failed"
        }, Number(error?.status) || 502);
      }
    }

    if (url.pathname === "/api/migration/health") {
      try {
        return await handleMigrationHealth(request, env);
      } catch (error) {
        console.error("KURO D1 migration health handler failed", error?.message || error);
        return json({ error: "D1 migration diagnostics unavailable." }, 503);
      }
    }

    if (url.pathname === "/api/kuro-storage-relay") {
      try {
        return await handleStorageRelay(request, env);
      } catch (error) {
        return json({
          ok: false,
          error: error?.message || "KURO Supabase Storage relay failed"
        }, Number(error?.status) || 502);
      }
    }

    if (url.pathname === "/api/cloudflare-relay") {
      try {
        return await handleRelay(request, env);
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
          // The mobile shell embeds this same-origin player page. Keep DENY everywhere else.
          if (url.pathname === "/games/play" || url.pathname.startsWith("/games/play/")) headers.set("X-Frame-Options", "SAMEORIGIN");
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
            headers.set("Content-Security-Policy", "default-src 'self' https: data:; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https:; worker-src 'self' blob:; child-src 'self' blob:; style-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://fonts.googleapis.com https://cdnjs.cloudflare.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com https: wss:; frame-src 'self' https://challenges.cloudflare.com https:; object-src 'none'; base-uri 'self'");
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
    // The mobile shell embeds /games/play/; only that same-origin player route may be framed.
    if (url.pathname === "/games/play" || url.pathname.startsWith("/games/play/")) fallbackHeaders.set("X-Frame-Options", "SAMEORIGIN");
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
