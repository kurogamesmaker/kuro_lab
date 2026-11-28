const SUPABASE_URL = "https://cprvpphlfpmiegjiutjn.supabase.co";
const SUPABASE_KEY = "sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ORIGINS = new Set([
  "https://kurolab.cc.cd",
  "https://www.kurolab.cc.cd",
  "https://admin.kurolab.cc.cd"
]);
const TOOL_NAMES = new Set(["admin", "center", "shop-studio", "game-studio", "security-monitor"]);
const encoder = new TextEncoder();

function json(body, status = 200, origin = null) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "authorization, apikey, content-type, x-client-info";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)));
  } catch (_) {
    return null;
  }
}

async function authenticate(request) {
  const token = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!token || token.length > 8192 || token.split(".").length !== 3) {
    return { error: json({ error: "ログイン状態を確認できません。再ログインしてください。" }, 401, request.headers.get("Origin")) };
  }
  let user;
  try {
    const response = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + token, "Accept": "application/json" },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return { error: json({ error: "ログイン状態を確認できません。再ログインしてください。" }, 401, request.headers.get("Origin")) };
    user = await response.json();
  } catch (_) {
    return { error: json({ error: "認証サービスに接続できません。" }, 503, request.headers.get("Origin")) };
  }
  if (!user || !UUID_RE.test(String(user.id || "")) || user.is_anonymous === true) {
    return { error: json({ error: "KUROアカウントでログインしてください。" }, 401, request.headers.get("Origin")) };
  }
  const claims = decodeJwtPayload(token) || {};
  if (String(claims.sub || "") !== user.id) {
    return { error: json({ error: "認証情報が一致しません。" }, 401, request.headers.get("Origin")) };
  }
  return { user, claims, token };
}

async function getToolRole(db, tool, userId) {
  if (["admin", "center", "security-monitor", "game-studio"].includes(tool)) {
    return await db.prepare("SELECT user_id, role FROM admin_users WHERE user_id = ? LIMIT 1").bind(userId).first();
  }
  if (tool === "shop-studio") {
    return await db.prepare("SELECT user_id, role FROM kuro_store_studio_members WHERE user_id = ? AND is_active = 1 LIMIT 1").bind(userId).first();
  }
  return null;
}

export async function handleKuroD1AdminCheck(request, env) {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: json({}, 204, origin).headers });
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, origin);
  const auth = await authenticate(request);
  if (auth.error) return auth.error;
  const db = env?.KURO_APP_DB;
  if (!db) return json({ error: "Cloudflare D1に接続できません。" }, 503, origin);
  try {
    const admin = await db.prepare("SELECT user_id, role FROM admin_users WHERE user_id = ? LIMIT 1").bind(auth.user.id).first();
    return json({ admin: admin || null, isAdmin: Boolean(admin), userId: auth.user.id, source: "cloudflare-d1" }, 200, origin);
  } catch (error) {
    console.error("KURO D1 admin check failed", error?.message || error);
    return json({ error: "管理者権限を確認できませんでした。" }, 503, origin);
  }
}

async function hmacDigest(secret, value) {
  if (!value) return null;
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  const hex = Array.from(new Uint8Array(signed), byte => byte.toString(16).padStart(2, "0")).join("");
  // v2 marks the digest key family so legacy Supabase-keyed hashes are not
  // falsely interpreted as a changed device during the one-time cutover.
  return "v2:" + hex;
}

async function recordEvent(db, values) {
  await db.prepare(`
    INSERT INTO kuro_security_events(
      id,user_id,tool,decision,risk_score,reasons,ip_digest,device_digest,created_at,session_digest,session_id
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    crypto.randomUUID(), values.userId, values.tool, values.decision, values.riskScore,
    JSON.stringify(values.reasons), values.ipDigest, values.deviceDigest,
    new Date().toISOString(), values.sessionDigest, values.sessionId
  ).run();
}

async function recentEvents(db, userId, tool) {
  const result = await db.prepare(`
    SELECT decision,risk_score,ip_digest,device_digest,session_digest,created_at
    FROM kuro_security_events
    WHERE user_id = ? AND tool = ?
      AND decision IN ('allow','review','reauth')
      AND created_at >= ?
    ORDER BY created_at DESC
    LIMIT 40
  `).bind(userId, tool, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()).all();
  return (result?.results || []).filter(row =>
    String(row.ip_digest || "").startsWith("v2:") ||
    String(row.device_digest || "").startsWith("v2:") ||
    String(row.session_digest || "").startsWith("v2:")
  );
}

async function decideAccess(db, env, request, user, claims, tool) {
  const origin = request.headers.get("Origin");
  if (claims.is_anonymous === true || user.is_anonymous === true) {
    await recordEvent(db, {
      userId:user.id,tool,decision:"deny",riskScore:100,
      reasons:["匿名セッションは管理ツールにアクセスできません。"],
      ipDigest:null,deviceDigest:null,sessionDigest:null,sessionId:null
    });
    return json({allowed:false,decision:"deny",risk_score:100,message:"KUROアカウントでログインしてください。"},200,origin);
  }

  const permission = await getToolRole(db, tool, user.id);
  if (!permission) {
    await recordEvent(db, {
      userId:user.id,tool,decision:"deny",riskScore:100,
      reasons:["必要な管理権限または専用メンバー権限がありません。"],
      ipDigest:null,deviceDigest:null,sessionDigest:null,sessionId:null
    });
    return json({
      allowed:false,decision:"deny",risk_score:100,
      message:tool==="shop-studio"?"Shop Studioの利用権限がありません。":"このアカウントには管理者権限がありません。"
    },200,origin);
  }

  const secret = String(env?.IP_BAN_EDGE_KEY || "");
  if (secret.length < 32) {
    return json({allowed:false,decision:"error",message:"セキュリティ検証の鍵を確認できません。"},503,origin);
  }
  const rawIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "";
  const userAgent = (request.headers.get("user-agent") || "").slice(0,500);
  const deviceMaterial = [
    userAgent,
    request.headers.get("sec-ch-ua-platform") || "",
    request.headers.get("accept-language") || ""
  ].join("|");
  const ipDigest = await hmacDigest(secret,rawIp);
  const deviceDigest = await hmacDigest(secret,deviceMaterial);
  const sessionId = typeof claims.session_id === "string" ? claims.session_id : "";
  const sessionDigest = await hmacDigest(secret,sessionId);
  const previous = await recentEvents(db,user.id,tool);
  const sameSession = sessionDigest ? previous.find(row => row.session_digest === sessionDigest) : null;

  if (sameSession && sameSession.ip_digest === ipDigest && sameSession.device_digest === deviceDigest) {
    const age = Date.now() - new Date(String(sameSession.created_at)).getTime();
    if (age >= 0 && age < 10 * 60 * 1000 && ["allow","review"].includes(String(sameSession.decision))) {
      const review = sameSession.decision === "review";
      return json({
        allowed:true,decision:review?"review":"allow",risk_score:Number(sameSession.risk_score||0),
        message:review?"接続環境に変化があります。アクセスは許可されています。":"セキュリティ検証済みです。"
      },200,origin);
    }
  }

  const reasons = [];
  let riskScore = 0;
  const changedIp = previous.length > 0 && Boolean(ipDigest) && !previous.some(row => row.ip_digest === ipDigest);
  const changedDevice = previous.length > 0 && Boolean(deviceDigest) && !previous.some(row => row.device_digest === deviceDigest);
  if (changedIp) { riskScore += 25; reasons.push("以前と異なる接続元を検知しました。"); }
  if (changedDevice) { riskScore += 20; reasons.push("以前と異なる端末環境を検知しました。"); }
  if (!userAgent) { riskScore += 10; reasons.push("ブラウザー情報を取得できませんでした。"); }

  const automatedClient = /(curl\/|python-requests|wget\/|httpie\/|postmanruntime)/i.test(userAgent);
  if (automatedClient) { riskScore += 55; reasons.push("一般的なブラウザーではない接続形式を検知しました。"); }
  const authTime = Number(claims.auth_time || claims.iat || 0);
  const authAgeSeconds = authTime > 0 ? Math.max(0,Math.floor(Date.now()/1000)-authTime) : 0;
  if (authAgeSeconds > 12*60*60) { riskScore += 35; reasons.push("最後の本人認証から12時間以上経過しています。"); }
  riskScore = Math.min(100,riskScore);

  let decision="allow",allowed=true,message="セキュリティ検証に合格しました。";
  if (automatedClient && riskScore >= 55) {
    decision="block";allowed=false;message="安全性を確認できない接続形式のため、管理ツールへのアクセスを停止しました。";
  } else if (changedIp || changedDevice || authAgeSeconds > 12*60*60) {
    decision="reauth";allowed=false;message="セキュリティ確認のため、いったんログアウトして再ログインしてください。";
  } else if (riskScore >= 20) {
    decision="review";message="接続環境の変化を検知しました。追加記録を行ったうえでアクセスを許可しました。";
  }
  if (!reasons.length) reasons.push("認証情報・管理権限・通常の接続状態を確認しました。");
  await recordEvent(db,{
    userId:user.id,tool,decision,riskScore,reasons,ipDigest,deviceDigest,sessionDigest,
    sessionId:sessionId && UUID_RE.test(sessionId) ? sessionId : null
  });
  return json({allowed,decision,risk_score:riskScore,message},200,origin);
}

export async function handleKuroD1SecurityGate(request, env) {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null,{status:204,headers:json({},204,origin).headers});
  if (request.method !== "POST") return json({error:"Method not allowed"},405,origin);
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return json({error:"Origin not allowed"},403,origin);
  const auth = await authenticate(request);
  if (auth.error) return auth.error;
  const db = env?.KURO_APP_DB;
  if (!db) return json({allowed:false,decision:"error",message:"Cloudflare D1に接続できません。"},503,origin);

  let body;
  try {
    const raw=await request.text();
    if (new TextEncoder().encode(raw).byteLength>4096) return json({error:"Request too large"},413,origin);
    body=raw?JSON.parse(raw):{};
  } catch (_) {
    return json({error:"Invalid JSON body"},400,origin);
  }
  if (!body || typeof body!=="object" || Array.isArray(body)) return json({error:"Invalid JSON body"},400,origin);
  const action=typeof body.action==="string"?body.action:"check";
  const tool=typeof body.tool==="string"?body.tool:"";
  if (!TOOL_NAMES.has(tool)) return json({error:"保護対象の指定が正しくありません。"},400,origin);

  try {
    if (action==="events") {
      if (tool!=="security-monitor") return json({error:"この操作は許可されていません。"},403,origin);
      const permission=await getToolRole(db,tool,auth.user.id);
      if (!permission) return json({error:"このアカウントには管理者権限がありません。"},403,origin);
      const result=await db.prepare("SELECT id,user_id,tool,decision,risk_score,reasons,created_at FROM kuro_security_events ORDER BY created_at DESC LIMIT 100").all();
      const events=(result?.results||[]).map(row=>({...row,reasons:(()=>{try{return JSON.parse(row.reasons||"[]")}catch(_){return []}})()}));
      return json({allowed:true,events,source:"cloudflare-d1"},200,origin);
    }
    if (action!=="check") return json({error:"操作が正しくありません。"},400,origin);
    return await decideAccess(db,env,request,auth.user,auth.claims,tool);
  } catch (error) {
    console.error("KURO D1 Security Gate failed",error?.message||error);
    return json({allowed:false,decision:"error",message:"セキュリティ検証を完了できませんでした。安全のためアクセスを停止しました。"},503,origin);
  }
}
