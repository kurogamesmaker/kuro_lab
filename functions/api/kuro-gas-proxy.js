const ALLOWED_PREFIXES = ["/rest/v1/", "/auth/v1/", "/storage/v1/"];
const ALLOWED_FUNCTION_PATHS = new Set(["/functions/v1/admin-console", "/functions/v1/pro-access"]);
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

function validatePath(value) {
  const path = String(value || "");
  if (!path.startsWith("/") || path.includes("..") || path.includes("://")) {
    throw new Error("Invalid Supabase path");
  }
  const pathname = path.split("?")[0];
  const allowedPrefix = ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
  const allowedFunction = ALLOWED_FUNCTION_PATHS.has(pathname);
  if (!allowedPrefix && !allowedFunction) {
    throw new Error("Supabase service is not allowed through this proxy");
  }
  return path;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function callAppsScript(payload, env) {
  const gasUrl = env.KURO_GAS_WEB_APP_URL;
  const secret = env.KURO_GAS_PROXY_SECRET;
  if (!gasUrl || !secret) {
    const error = new Error("GAS connection is not configured");
    error.status = 503;
    throw error;
  }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(gasUrl)) {
    const error = new Error("KURO_GAS_WEB_APP_URL must be the deployed Apps Script /exec URL");
    error.status = 503;
    throw error;
  }

  const response = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ ...payload, secret }),
    redirect: "follow"
  });
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error("Apps Script returned non-JSON. Check its web-app deployment access setting.");
  }
  if (!result || (typeof result.status !== "number" && result.service !== "KURO SNS GAS Proxy")) {
    throw new Error("Unexpected response from Apps Script");
  }
  return result;
}

export async function onRequest(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);

    if (request.method === "GET" && url.searchParams.get("health") === "1") {
      const gasUrl = env.KURO_GAS_WEB_APP_URL;
      const secret = env.KURO_GAS_PROXY_SECRET;
      if (!gasUrl || !secret) {
        return json({ ready: false, reason: "missing_environment_variables" });
      }
      const ping = await fetch(gasUrl, { method: "GET", redirect: "follow" });
      const text = await ping.text();
      let data = {};
      try { data = JSON.parse(text); } catch {}
      return json({
        ready: Boolean(ping.ok && data.ok && data.service === "KURO SNS GAS Proxy"),
        service: data.service || null
      });
    }

    if (request.method === "GET") {
      const path = validatePath(url.searchParams.get("resource"));
      if (!path.startsWith("/storage/v1/object/public/avatars/")) {
        return json({ error: "Only public avatar images may be fetched here" }, 403);
      }
      const result = await callAppsScript({
        path,
        method: "GET",
        headers: {},
        bodyBase64: "",
        clientId: "avatar-read"
      }, env);
      if (result.isBinary && result.bodyBase64) {
        return new Response(decodeBase64(result.bodyBase64), {
          status: result.status || 200,
          headers: {
            "Content-Type": result.headers?.["content-type"] || "application/octet-stream",
            "Cache-Control": "public, max-age=300, stale-while-revalidate=600"
          }
        });
      }
      return new Response(result.bodyText || "", {
        status: result.status || 502,
        headers: {
          "Content-Type": result.headers?.["content-type"] || "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const input = await request.json();
    const path = validatePath(input.path);
    const method = String(input.method || "GET").toUpperCase();
    if (!ALLOWED_METHODS.has(method)) {
      return json({ error: "Supabase method is not allowed" }, 405);
    }

    const result = await callAppsScript({
      path,
      method,
      headers: input.headers || {},
      bodyBase64: String(input.bodyBase64 || ""),
      clientId: String(input.clientId || "anonymous")
    }, env);
    return json(result);
  } catch (error) {
    return json({ ok: false, error: error?.message || "KURO GAS proxy failed" }, Number(error?.status) || 502);
  }
}
