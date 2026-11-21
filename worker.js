const SUPABASE_URL = "https://cprvpphlfpmiegjiutjn.supabase.co";
const SUPABASE_KEY = "sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn";
const ALLOWED_PREFIXES = ["/rest/v1/", "/auth/v1/", "/storage/v1/"];
const ALLOWED_FUNCTIONS = new Set([
  "/functions/v1/admin-console", "/functions/v1/pro-access",
  "/functions/v1/send-chat-push", "/functions/v1/kurogames-online",
  "/functions/v1/kurogames-secret",
  "/functions/v1/username-auth"
]);
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
function targetFor(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("..") || path.includes("://")) throw new Error("Invalid Supabase path");
  const pathname = path.split("?")[0];
  if (!ALLOWED_PREFIXES.some(p => pathname.startsWith(p)) && !ALLOWED_FUNCTIONS.has(pathname)) throw new Error("Supabase path is not allowed");
  const target = new URL(path, SUPABASE_URL);
  if (target.origin !== SUPABASE_URL) throw new Error("Invalid Supabase origin");
  return target;
}
function headersFor(input = {}) {
  const allowed = new Set(["authorization", "apikey", "content-type", "accept", "prefer", "range", "if-match", "if-none-match", "cache-control", "accept-profile", "content-profile", "x-client-info", "x-client-version", "x-upsert", "x-storage-api-version"]);
  const h = new Headers();
  for (const [k, v] of Object.entries(input)) if (allowed.has(k.toLowerCase()) && v != null) h.set(k, String(v));
  if (!h.has("apikey")) h.set("apikey", SUPABASE_KEY);
  if (!h.has("authorization")) h.set("authorization", "Bearer " + SUPABASE_KEY);
  return h;
}
function b64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(value) { const s = atob(String(value || "")); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
async function proxy(payload) {
  const target = targetFor(payload.path), method = String(payload.method || "GET").toUpperCase();
  if (!METHODS.has(method)) throw Object.assign(new Error("Method not allowed"), { status: 405 });
  const body = !["GET", "HEAD"].includes(method) && payload.bodyBase64 ? unb64(payload.bodyBase64) : undefined;
  const upstream = await fetch(target.href, { method, headers: headersFor(payload.headers), body, redirect: "manual" });
  const raw = await upstream.arrayBuffer(), type = upstream.headers.get("content-type") || "application/octet-stream";
  const binary = !/(json|text|xml|javascript|form|csv)/i.test(type);
  const responseHeaders = {};
  for (const k of ["content-type", "cache-control", "etag", "content-range", "accept-ranges", "last-modified", "location", "x-request-id"]) { const v = upstream.headers.get(k); if (v) responseHeaders[k] = v; }
  return { status: upstream.status, headers: responseHeaders, isBinary: binary, bodyBase64: binary ? b64(new Uint8Array(raw)) : "", bodyText: binary ? "" : new TextDecoder().decode(raw), service: "KURO Cloudflare Supabase Proxy" };
}
async function handleRelay(request) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.searchParams.get("health") === "1") return json({ ready: true, service: "KURO Cloudflare Supabase Proxy", transport: "cloudflare-worker" });
  if (request.method === "GET") {
    const target = targetFor(url.searchParams.get("resource"));
    if (!target.pathname.startsWith("/storage/v1/object/public/avatars/")) return json({ error: "Only public avatar images may be fetched here" }, 403);
    const upstream = await fetch(target.href, { headers: headersFor() });
    return new Response(upstream.body, { status: upstream.status, headers: { "Content-Type": upstream.headers.get("content-type") || "application/octet-stream", "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  return json(await proxy(await request.json()));
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/cloudflare-relay") {
      try { return await handleRelay(request); }
      catch (error) { return json({ ok: false, error: error?.message || "KURO Cloudflare relay failed" }, Number(error?.status) || 502); }
    }
    if (url.pathname === "/api/cloudflare-relay" || url.pathname.startsWith("/api/cloudflare-relay/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  }
};
