import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Supabase server environment is not configured.");
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 120;
const rateBuckets = new Map<string, { start: number; count: number }>();

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function isRateLimited(req: Request) {
  const ip = req.headers.get("cf-connecting-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown";
  const now = Date.now();
  const current = rateBuckets.get(ip);
  if (!current || now - current.start >= RATE_WINDOW_MS) {
    rateBuckets.set(ip, { start: now, count: 1 });
    if (rateBuckets.size > 5000) {
      for (const [key, bucket] of rateBuckets) {
        if (now - bucket.start >= RATE_WINDOW_MS) rateBuckets.delete(key);
      }
    }
    return false;
  }
  current.count += 1;
  return current.count > RATE_LIMIT;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return reply(405, { error: "POSTで送信してください。" });
  if (isRateLimited(req)) return reply(429, { error: "アクセスが多すぎます。少し待ってから再度お試しください。" });

  try {
    const length = Number(req.headers.get("content-length") || "0");
    if (length > 2048) return reply(413, { error: "リクエストが大きすぎます。" });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return reply(400, { error: "JSON形式のリクエストを送信してください。" });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply(400, { error: "リクエスト内容が正しくありません。" });
    }

    const userId = typeof (body as Record<string, unknown>).userId === "string"
      ? String((body as Record<string, unknown>).userId).trim()
      : "";
    if (!UUID_RE.test(userId)) return reply(400, { error: "プロフィールIDが正しくありません。" });

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) {
      console.error("[kuro-public-coin-balance] profile lookup failed", profileError);
      return reply(500, { error: "公開残高を取得できませんでした。" });
    }
    if (!profile) return reply(404, { error: "プロフィールが見つかりません。" });

    const { data: balanceRow, error: balanceError } = await admin
      .from("kuro_coin_balances")
      .select("balance")
      .eq("user_id", userId)
      .maybeSingle();
    if (balanceError) {
      console.error("[kuro-public-coin-balance] balance lookup failed", balanceError);
      return reply(500, { error: "公開残高を取得できませんでした。" });
    }

    const balance = Number(balanceRow?.balance ?? 0);
    return reply(200, {
      currency: "P",
      balance: Number.isSafeInteger(balance) && balance >= 0 ? balance : 0,
    });
  } catch (error) {
    console.error("[kuro-public-coin-balance]", error);
    return reply(500, { error: "公開残高を取得できませんでした。" });
  }
});
