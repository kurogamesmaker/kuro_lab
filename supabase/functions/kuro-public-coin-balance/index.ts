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
  const ip = req.headers.get("cf-connecting-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  const current = rateBuckets.get(ip);
  if (!current || now - current.start >= RATE_WINDOW_MS) {
    rateBuckets.set(ip, { start: now, count: 1 });
    if (rateBuckets.size > 5000) {
      for (const [key, bucket] of rateBuckets) if (now - bucket.start >= RATE_WINDOW_MS) rateBuckets.delete(key);
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
    let body: unknown;
    try { body = await req.json(); } catch { return reply(400, { error: "JSON形式のリクエストを送信してください。" }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, { error: "リクエスト内容が正しくありません。" });
    const userId = typeof (body as Record<string, unknown>).userId === "string" ? String((body as Record<string, unknown>).userId).trim() : "";
    if (!UUID_RE.test(userId)) return reply(400, { error: "プロフィールIDが正しくありません。" });

    const upstream = await fetch("https://kurolab.cc.cd/api/kuro-d1/public-player-summary?userId=" + encodeURIComponent(userId), {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok || !payload?.data || !payload.data.level || !Array.isArray(payload.data.thresholds)) {
      return reply(upstream.status === 404 ? 404 : 503, { error: payload?.error || "公開残高を取得できませんでした。" });
    }
    const balance = Number(payload.data.balance ?? 0);
    const totalXp = Number(payload.data.level.total_xp ?? 0);
    const currentLevel = Number(payload.data.level.current_level ?? 1);
    if (!Number.isSafeInteger(balance) || balance < 0 || !Number.isSafeInteger(totalXp) || totalXp < 0 ||
        !Number.isSafeInteger(currentLevel) || currentLevel < 1) {
      return reply(503, { error: "公開残高を取得できませんでした。" });
    }
    return reply(200, {
      currency: "P",
      balance,
      level: { total_xp: totalXp, current_level: currentLevel },
      thresholds: payload.data.thresholds,
      source: "cloudflare-d1"
    });
  } catch (error) {
    console.error("[kuro-public-coin-balance] D1 proxy failed", error);
    return reply(503, { error: "公開残高を取得できませんでした。" });
  }
});
