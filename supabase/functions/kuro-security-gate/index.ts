import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error("Supabase security-gate environment is not configured.");
}

const ALLOWED_ORIGINS = new Set([
  "https://kurolab.cc.cd",
  "https://www.kurolab.cc.cd",
  "https://admin.kurolab.cc.cd",
]);
const TOOL_NAMES = new Set(["admin", "center", "shop-studio", "game-studio", "security-monitor"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function reply(body: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

async function keyedDigest(value: string): Promise<string | null> {
  if (!value) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SERVICE_ROLE_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function recordEvent(admin: ReturnType<typeof createClient>, values: Record<string, unknown>) {
  const { error } = await admin.from("kuro_security_events").insert(values);
  if (error) throw new Error("Security audit write failed: " + String(error.message || error));
}

async function hasToolPermission(admin: ReturnType<typeof createClient>, tool: string, userId: string): Promise<boolean> {
  if (tool === "admin" || tool === "center" || tool === "security-monitor") {
    const { data, error } = await admin.from("admin_users")
      .select("user_id").eq("user_id", userId).maybeSingle();
    if (error) throw new Error("管理者権限を確認できませんでした。");
    return Boolean(data);
  }
  if (tool === "shop-studio") {
    const { data, error } = await admin.from("kuro_store_studio_members")
      .select("user_id").eq("user_id", userId).eq("is_active", true).maybeSingle();
    if (error) throw new Error("Shop Studio権限を確認できませんでした。");
    return Boolean(data);
  }
  return tool === "game-studio";
}

async function checkAccess(
  admin: ReturnType<typeof createClient>,
  userId: string,
  claims: Record<string, unknown>,
  tool: string,
  req: Request,
): Promise<{ allowed: boolean; decision: string; risk_score: number; message: string }> {
  if (claims.is_anonymous === true) {
    await recordEvent(admin, {
      user_id: userId, tool, decision: "deny", risk_score: 100,
      reasons: ["匿名セッションは管理ツールにアクセスできません。"],
    });
    return { allowed: false, decision: "deny", risk_score: 100, message: "KUROアカウントでログインしてください。" };
  }

  const permitted = await hasToolPermission(admin, tool, userId);
  if (!permitted) {
    await recordEvent(admin, {
      user_id: userId, tool, decision: "deny", risk_score: 100,
      reasons: ["必要な管理権限または専用メンバー権限がありません。"],
    });
    return {
      allowed: false, decision: "deny", risk_score: 100,
      message: tool === "shop-studio" ? "Shop Studioの利用権限がありません。" : "このアカウントには管理者権限がありません。",
    };
  }

  const rawIp = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "";
  const userAgent = (req.headers.get("user-agent") || "").slice(0, 500);
  const deviceMaterial = [
    userAgent,
    req.headers.get("sec-ch-ua-platform") || "",
    req.headers.get("accept-language") || "",
  ].join("|");
  const ipDigest = await keyedDigest(rawIp);
  const deviceDigest = await keyedDigest(deviceMaterial);
  const sessionId = typeof claims.session_id === "string" ? claims.session_id : "";
  const sessionDigest = await keyedDigest(sessionId);

  const { data: previous, error: historyError } = await admin.from("kuro_security_events")
    .select("decision,risk_score,ip_digest,device_digest,session_digest,created_at")
    .eq("user_id", userId)
    .eq("tool", tool)
    .in("decision", ["allow", "review", "reauth"])
    .gte("created_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(40);
  if (historyError) throw new Error("セキュリティ履歴を確認できませんでした。");

  const previousRows = Array.isArray(previous) ? previous : [];
  const latest = previousRows[0] as Record<string, unknown> | undefined;
  const sameSession = sessionDigest
    ? previousRows.find((row) => row.session_digest === sessionDigest)
    : undefined;

  // Multiple API calls from the same, recently verified browser session are deduplicated.
  if (sameSession && sameSession.ip_digest === ipDigest && sameSession.device_digest === deviceDigest) {
    const age = Date.now() - new Date(String(sameSession.created_at)).getTime();
    if (age >= 0 && age < 10 * 60 * 1000 && ["allow", "review"].includes(String(sameSession.decision))) {
      const review = sameSession.decision === "review";
      return {
        allowed: true,
        decision: review ? "review" : "allow",
        risk_score: Number(sameSession.risk_score || 0),
        message: review ? "接続環境に変化があります。アクセスは許可されています。" : "セキュリティ検証済みです。",
      };
    }
  }

  const reasons: string[] = [];
  let riskScore = 0;

  const changedIp = previousRows.length > 0 && Boolean(ipDigest) &&
    !previousRows.some((row) => row.ip_digest === ipDigest);
  const changedDevice = previousRows.length > 0 && Boolean(deviceDigest) &&
    !previousRows.some((row) => row.device_digest === deviceDigest);
  if (changedIp) {
    riskScore += 25;
    reasons.push("以前と異なる接続元を検知しました。");
  }
  if (changedDevice) {
    riskScore += 20;
    reasons.push("以前と異なる端末環境を検知しました。");
  }
  if (!userAgent) {
    riskScore += 10;
    reasons.push("ブラウザー情報を取得できませんでした。");
  }

  const automatedClient = /(curl\/|python-requests|wget\/|httpie\/|postmanruntime)/i.test(userAgent);
  if (automatedClient) {
    riskScore += 55;
    reasons.push("一般的なブラウザーではない接続形式を検知しました。");
  }

  const authTime = Number(claims.auth_time || claims.iat || 0);
  const authAgeSeconds = authTime > 0 ? Math.max(0, Math.floor(Date.now() / 1000) - authTime) : 0;
  if (authAgeSeconds > 12 * 60 * 60) {
    riskScore += 35;
    reasons.push("最後の本人認証から12時間以上経過しています。");
  }
  riskScore = Math.min(100, riskScore);

  let decision = "allow";
  let allowed = true;
  let message = "セキュリティ検証に合格しました。";

  if (automatedClient && riskScore >= 55) {
    decision = "block";
    allowed = false;
    message = "安全性を確認できない接続形式のため、管理ツールへのアクセスを停止しました。";
  } else if (changedIp || changedDevice || authAgeSeconds > 12 * 60 * 60) {
    decision = "reauth";
    allowed = false;
    message = "セキュリティ確認のため、いったんログアウトして再ログインしてください。";
  } else if (riskScore >= 20) {
    decision = "review";
    message = "接続環境の変化を検知しました。追加記録を行ったうえでアクセスを許可しました。";
  }

  if (reasons.length === 0) reasons.push("認証情報・管理権限・通常の接続状態を確認しました。");

  await recordEvent(admin, {
    user_id: userId,
    tool,
    decision,
    risk_score: riskScore,
    reasons,
    ip_digest: ipDigest,
    device_digest: deviceDigest,
    session_digest: sessionDigest,
    session_id: sessionId && UUID_RE.test(sessionId) ? sessionId : null,
  });

  return { allowed, decision, risk_score: riskScore, message };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reply({ error: "Origin not allowed" }, 403, origin);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return reply({ error: "認証情報がありません。" }, 401, origin);
  const accessToken = authHeader.slice(7).trim();
  if (!accessToken) return reply({ error: "認証情報がありません。" }, 401, origin);

  try {
    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: claimsData, error: claimsError } = await caller.auth.getClaims(accessToken);
    const claims = claimsData?.claims as Record<string, unknown> | undefined;
    const userId = claims?.sub;
    if (claimsError || typeof userId !== "string" || !UUID_RE.test(userId)) {
      return reply({ error: "ログイン状態を確認できません。再ログインしてください。" }, 401, origin);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "check";
    const tool = typeof body?.tool === "string" ? body.tool : "";
    if (!TOOL_NAMES.has(tool)) return reply({ error: "保護対象の指定が正しくありません。" }, 400, origin);

    const permitted = await hasToolPermission(admin, tool, userId);
    if (!permitted) {
      await recordEvent(admin, {
        user_id: userId, tool, decision: "deny", risk_score: 100,
        reasons: ["必要な管理権限または専用メンバー権限がありません。"],
      });
      return reply({
        allowed: false, decision: "deny", risk_score: 100,
        message: tool === "shop-studio" ? "Shop Studioの利用権限がありません。" : "このアカウントには管理者権限がありません。",
      }, 200, origin);
    }

    if (action === "events") {
      if (tool !== "security-monitor") return reply({ error: "この操作は許可されていません。" }, 403, origin);
      const { data, error } = await admin.from("kuro_security_events")
        .select("id,user_id,tool,decision,risk_score,reasons,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error("セキュリティログを読み込めませんでした。");
      return reply({ allowed: true, events: data || [] }, 200, origin);
    }

    if (action !== "check") return reply({ error: "操作が正しくありません。" }, 400, origin);
    const result = await checkAccess(admin, userId, claims, tool, req);
    return reply(result, 200, origin);
  } catch (error) {
    console.error("[kuro-security-gate]", error);
    return reply({ allowed: false, decision: "error", message: "セキュリティ検証を完了できませんでした。安全のためアクセスを停止しました。" }, 503, origin);
  }
});