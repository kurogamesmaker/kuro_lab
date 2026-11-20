const SUPABASE_URL = "https://cprvpphlfpmiegjiutjn.supabase.co";
const SUPABASE_KEY = "sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn";
const ALLOWED_PREFIXES = ["/rest/v1/", "/auth/v1/", "/storage/v1/"];
const ALLOWED_FUNCTIONS = new Set([
  "/functions/v1/admin-console",
  "/functions/v1/pro-access",
  "/functions/v1/send-chat-push",
  "/functions/v1/kurogames-online",
  "/functions/v1/kurogames-secret"
]);
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

function validatePath(value) {
  const path = String(value || "");
  if (!path.startsWith("/") || path.includes("..") || path.includes("://")) throw new Error("Invalid Supabase path");
  const pathname = path.split("?")[0];
  if (!ALLOWED_PREFIXES.some(prefix => pathname.startsWith(prefix)) && !ALLOWED_FUNCTIONS.has(pathname)) throw new Error("Supabase service is not allowed");
  const target = new URL(path, SUPABASE_URL);
  if (target.origin !== SUPABASE_URL) throw new Error("Invalid Supabase origin");
  return target;
}
function safeHeaders(input) {
  const allowed = new Set(["authorization","apikey","content-type","accept","prefer","range","if-match","if-none-match","cache-control","accept-profile","content-profile","x-client-info","x-client-version","x-upsert","x-storage-api-version"]);
  const headers = new Headers();
  for (const [key, value] of Object.entries(input || {})) if (allowed.has(key.toLowerCase()) && value != null) headers.set(key, String(value));
  if (!headers.has("apikey")) headers.set("apikey", SUPABASE_KEY);
  if (!headers.has("authorization")) headers.set("authorization", "Bearer " + SUPABASE_KEY);
  return headers;
}
function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
}
function decodeBase64(value) {
  if (!value) return undefined;
  return Buffer.from(String(value), "base64");
}
async function proxy(payload) {
  const target = validatePath(payload.path);
  const method = String(payload.method || "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw Object.assign(new Error("Method not allowed"), { status: 405 });
  const body = !["GET", "HEAD"].includes(method) ? decodeBase64(payload.bodyBase64) : undefined;
  const upstream = await fetch(target.href, { method, headers: safeHeaders(payload.headers), body, redirect: "manual" });
  const bytes = Buffer.from(await upstream.arrayBuffer());
  const type = upstream.headers.get("content-type") || "application/octet-stream";
  const isBinary = !/(json|text|xml|javascript|form|csv)/i.test(type);
  const headers = {};
  for (const key of ["content-type","cache-control","etag","content-range","accept-ranges","last-modified","location","x-request-id"]) {
    const value = upstream.headers.get(key);
    if (value) headers[key] = value;
  }
  return { status: upstream.status, headers, isBinary, bodyBase64: isBinary ? bytes.toString("base64") : "", bodyText: isBinary ? "" : bytes.toString("utf8"), service: "KURO Cloudflare Supabase Proxy" };
}
export default async function handler(req, res) {
  try {
    const url = new URL(req.url, "https://kurolab.cc.cd");
    if (req.method === "GET" && url.searchParams.get("health") === "1") return sendJson(res, 200, { ready: true, service: "KURO Cloudflare Supabase Proxy", transport: "vercel-api" });
    if (req.method === "GET") {
      const target = validatePath(url.searchParams.get("resource"));
      if (!target.pathname.startsWith("/storage/v1/object/public/avatars/")) return sendJson(res, 403, { error: "Only public avatar images may be fetched here" });
      const upstream = await fetch(target.href, { headers: safeHeaders({}) });
      const bytes = Buffer.from(await upstream.arrayBuffer());
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
      return res.end(bytes);
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
    const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!payload || typeof payload !== "object") return sendJson(res, 400, { error: "Invalid request payload" });
    return sendJson(res, 200, await proxy(payload));
  } catch (error) {
    return sendJson(res, Number(error && error.status) || 502, { ok: false, error: error && error.message || "KURO Cloudflare proxy failed" });
  }
}
