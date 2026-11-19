import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://kurolab.cc.cd",
  "https://admin.kurolab.cc.cd"
]);

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-kuro-visitor, x-kuro-transport",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function reply(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isCurrent(start: string | null, end: string | null) {
  const now = Date.now();
  return (!start || new Date(start).getTime() <= now) && (!end || new Date(end).getTime() > now);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reply({ error: "Origin not allowed" }, 403, origin);

  try {
    const raw = await req.text();
    if (raw.length > 4096) return reply({ error: "Request too large" }, 413, origin);
    const body = JSON.parse(raw || "{}");
    if (body?.action !== "unlock") return reply({ error: "Unsupported action" }, 400, origin);

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return reply({ error: "Server configuration is missing" }, 503, origin);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const visitor = String(req.headers.get("x-kuro-visitor") || "").trim().slice(0, 100);
    const forwardedIp = String(req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    const rateIdentity = forwardedIp || visitor || "unknown";
    const rateHash = await hmacHex(serviceKey, "kuro-secret-rate:v1:" + rateIdentity);

    const { data: rateRow, error: rateError } = await admin
      .from("kuro_secret_attempt_limits")
      .select("attempts,window_started_at")
      .eq("key_hash", rateHash)
      .maybeSingle();
    if (rateError) throw rateError;
    if (rateRow && Number(rateRow.attempts) >= 8 &&
        Date.now() - new Date(rateRow.window_started_at).getTime() < 15 * 60 * 1000) {
      return reply({ error: "試行回数が上限に達しました。15分ほど待ってから再度お試しください。" }, 429, origin);
    }

    const recordFailure = async () => {
      const { data, error } = await admin.rpc("kuro_secret_record_failure", {
        p_key_hash: rateHash,
        p_window_seconds: 900
      });
      if (error) throw error;
      return Number(data) >= 8
        ? reply({ error: "試行回数が上限に達しました。15分ほど待ってから再度お試しください。" }, 429, origin)
        : reply({ error: "秘密コードを確認できませんでした。" }, 401, origin);
    };

    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^\d{4,12}$/.test(code)) return await recordFailure();

    const codeHash = await hmacHex(serviceKey, "kuro-secret-code:v1:" + code);
    const { data: entry, error: codeError } = await admin
      .from("kuro_secret_codes")
      .select("id,label,description,room_key,room_title,enabled,starts_at,expires_at,max_uses")
      .eq("code_hash", codeHash)
      .maybeSingle();
    if (codeError) throw codeError;
    if (!entry || !entry.enabled || !isCurrent(entry.starts_at, entry.expires_at)) return await recordFailure();

    const { data: rows, error: contentError } = await admin
      .from("kuro_secret_content")
      .select("id,content_type,title,body,href,icon,reward,sort_order,starts_at,ends_at,created_at")
      .eq("published", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(100);
    if (contentError) throw contentError;

    const items = (rows || []).filter((item) => isCurrent(item.starts_at, item.ends_at));
    const { data: consumed, error: consumeError } = await admin.rpc("kuro_secret_consume_code", { p_code_id: entry.id });
    if (consumeError) throw consumeError;
    if (consumed !== true) return await recordFailure();

    await admin.from("kuro_secret_attempt_limits").delete().eq("key_hash", rateHash);
    return reply({
      ok: true,
      room: {
        key: "secret-hub",
        title: "KURO // CLASSIFIED TERMINAL",
        description: "すべての秘密コンテンツをまとめた共通ターミナルです。",
        accessLabel: entry.label
      },
      items
    }, 200, origin);
  } catch (error) {
    console.error("[kurogames-secret]", error);
    return reply({ error: "秘密機能への接続に失敗しました。時間をおいて再度お試しください。" }, 500, origin);
  }
});
