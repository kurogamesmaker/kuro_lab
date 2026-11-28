const SUPABASE_URL = "https://cprvpphlfpmiegjiutjn.supabase.co";
const SUPABASE_KEY = "sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ORIGINS = new Set([
  "https://kurolab.cc.cd",
  "https://www.kurolab.cc.cd",
  "https://admin.kurolab.cc.cd"
]);

class KuroPushError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || "KURO_PUSH_ERROR";
  }
}

function json(body, status = 200, origin = null) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "authorization, content-type, accept";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function decodeJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)));
  } catch (_) {
    return null;
  }
}

async function authenticate(request) {
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!token || token.length > 8192 || token.split(".").length !== 3) {
    throw new KuroPushError(401, "ログイン状態を確認できません。再ログインしてください。", "AUTH_REQUIRED");
  }
  let user;
  try {
    const response = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + token,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new KuroPushError(401, "ログイン状態を確認できません。再ログインしてください。", "AUTH_INVALID");
    user = await response.json();
  } catch (error) {
    if (error instanceof KuroPushError) throw error;
    throw new KuroPushError(503, "認証サービスに接続できません。", "AUTH_UNAVAILABLE");
  }
  const claims = decodeJwtPayload(token) || {};
  if (!user || !UUID_RE.test(String(user.id || "")) || user.is_anonymous === true ||
      String(claims.sub || "") !== String(user.id || "") || claims.is_anonymous === true) {
    throw new KuroPushError(401, "KUROアカウントでログインしてください。", "AUTH_INVALID");
  }
  return user;
}

function validateEndpoint(value) {
  const endpoint = String(value || "").trim();
  if (!endpoint || endpoint.length > 2048) {
    throw new KuroPushError(400, "通知登録先が正しくありません。", "INVALID_ENDPOINT");
  }
  let url;
  try { url = new URL(endpoint); } catch (_) {
    throw new KuroPushError(400, "通知登録先が正しくありません。", "INVALID_ENDPOINT");
  }
  const allowedHost = url.hostname === "fcm.googleapis.com" ||
    url.hostname === "web.push.apple.com" ||
    url.hostname.endsWith(".push.services.mozilla.com");
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      !allowedHost || (url.port && url.port !== "443")) {
    throw new KuroPushError(400, "対応するHTTPS通知サービスの登録先のみ利用できます。", "INVALID_ENDPOINT");
  }
  return url.href;
}

function normalizeSubscription(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KuroPushError(400, "通知登録データが正しくありません。", "INVALID_SUBSCRIPTION");
  }
  const endpoint = validateEndpoint(value.endpoint);
  const keys = value.keys && typeof value.keys === "object" ? value.keys : {};
  const p256dh = String(keys.p256dh || "");
  const auth = String(keys.auth || "");
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,128}$/.test(auth)) {
    throw new KuroPushError(400, "通知登録キーが正しくありません。", "INVALID_SUBSCRIPTION_KEYS");
  }
  const expirationTime = value.expirationTime == null ? null : Number(value.expirationTime);
  if (expirationTime !== null && (!Number.isFinite(expirationTime) || expirationTime < 0)) {
    throw new KuroPushError(400, "通知登録の有効期限が正しくありません。", "INVALID_EXPIRATION");
  }
  return {
    endpoint,
    expirationTime,
    keys: { p256dh, auth }
  };
}

async function resolveEvent(db, user, event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new KuroPushError(400, "通知イベントが正しくありません。", "INVALID_EVENT");
  }

  if (event.type === "test") {
    return {
      recipientIds: [user.id],
      title: "KURO",
      message: "KUROのプッシュ通知テストだよ",
      tag: "kuro-push-test-" + Date.now()
    };
  }

  const groupMessageId = typeof event.groupMessageId === "string" ? event.groupMessageId : "";
  if (groupMessageId) {
    if (!UUID_RE.test(groupMessageId)) throw new KuroPushError(400, "グループメッセージIDが正しくありません。", "INVALID_MESSAGE_ID");
    const message = await db.prepare(
      "SELECT id,group_id,sender_id,content FROM group_chat_messages WHERE id=? LIMIT 1"
    ).bind(groupMessageId).first();
    if (!message || message.sender_id !== user.id) {
      throw new KuroPushError(403, "自分が送信したグループメッセージを確認できません。", "GROUP_MESSAGE_FORBIDDEN");
    }
    const members = await db.prepare(
      "SELECT user_id FROM group_chat_members WHERE group_id=? LIMIT 200"
    ).bind(message.group_id).all();
    const memberIds = [...new Set((members?.results || []).map(row => String(row.user_id)).filter(Boolean))];
    if (!memberIds.includes(user.id)) {
      throw new KuroPushError(403, "グループへの参加を確認できません。", "GROUP_MEMBERSHIP_REQUIRED");
    }
    const group = await db.prepare("SELECT name FROM group_conversations WHERE id=? LIMIT 1")
      .bind(message.group_id).first();
    return {
      recipientIds: memberIds.filter(id => id !== user.id),
      title: group?.name ? String(group.name).slice(0, 80) : "KURO グループチャット",
      message: String(message.content || "新しいグループメッセージが届いたよ").slice(0, 160),
      tag: "kuro-group-" + message.group_id
    };
  }

  const messageId = typeof event.messageId === "string" ? event.messageId : "";
  if (messageId) {
    if (!UUID_RE.test(messageId)) throw new KuroPushError(400, "メッセージIDが正しくありません。", "INVALID_MESSAGE_ID");
    const message = await db.prepare(
      "SELECT id,conversation_id,sender_id,content FROM chat_messages WHERE id=? LIMIT 1"
    ).bind(messageId).first();
    if (!message || message.sender_id !== user.id) {
      throw new KuroPushError(403, "自分が送信したメッセージを確認できません。", "MESSAGE_FORBIDDEN");
    }
    const conversation = await db.prepare(
      "SELECT user_a,user_b FROM chat_conversations WHERE id=? LIMIT 1"
    ).bind(message.conversation_id).first();
    if (!conversation || ![conversation.user_a, conversation.user_b].includes(user.id)) {
      throw new KuroPushError(403, "チャットへの参加を確認できません。", "CONVERSATION_FORBIDDEN");
    }
    const recipientId = conversation.user_a === user.id ? conversation.user_b : conversation.user_a;
    return {
      recipientIds: [String(recipientId)],
      title: "KURO",
      message: String(message.content || "新しいメッセージが届いたよ").slice(0, 160),
      tag: "kuro-message-" + message.conversation_id
    };
  }

  const targetId = typeof event.targetUserId === "string" ? event.targetUserId : "";
  const type = event.type === "like" ? "like" : event.type === "follow" ? "follow" : "";
  if (!UUID_RE.test(targetId) || targetId === user.id || !type) {
    throw new KuroPushError(400, "通知イベントの対象が正しくありません。", "INVALID_NOTIFICATION");
  }

  if (type === "follow") {
    const follow = await db.prepare(
      "SELECT follower_id FROM follows WHERE follower_id=? AND following_id=? LIMIT 1"
    ).bind(user.id, targetId).first();
    if (!follow) throw new KuroPushError(403, "フォロー操作を確認できません。", "FOLLOW_NOT_FOUND");
    return {
      recipientIds: [targetId],
      title: "KURO",
      message: "あなたをフォローしました",
      tag: "kuro-follow-" + user.id
    };
  }

  const postId = typeof event.postId === "string" ? event.postId : "";
  if (!UUID_RE.test(postId)) throw new KuroPushError(400, "投稿IDが正しくありません。", "INVALID_POST_ID");
  const post = await db.prepare("SELECT id,user_id FROM posts WHERE id=? LIMIT 1").bind(postId).first();
  if (!post || post.user_id !== targetId) {
    throw new KuroPushError(403, "投稿の通知先を確認できません。", "POST_RECIPIENT_MISMATCH");
  }
  const like = await db.prepare(
    "SELECT post_id FROM post_likes WHERE post_id=? AND user_id=? LIMIT 1"
  ).bind(postId, user.id).first();
  if (!like) throw new KuroPushError(403, "いいね操作を確認できません。", "LIKE_NOT_FOUND");
  return {
    recipientIds: [targetId],
    title: "KURO",
    message: "あなたの投稿にいいねしました",
    tag: "kuro-like-" + user.id
  };
}

async function getTargetSubscriptions(db, recipientIds) {
  const ids = [...new Set((recipientIds || []).map(String).filter(id => UUID_RE.test(id)))].slice(0, 200);
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const result = await db.prepare(
    "SELECT id,user_id,subscription FROM push_subscriptions WHERE user_id IN (" + placeholders + ") LIMIT 500"
  ).bind(...ids).all();
  return (result?.results || []).flatMap(row => {
    try {
      const subscription = JSON.parse(String(row.subscription || ""));
      if (!subscription || typeof subscription.endpoint !== "string") return [];
      return [{ id: String(row.id), user_id: String(row.user_id), subscription }];
    } catch (_) {
      return [];
    }
  });
}

export async function handleKuroD1Push(request, env) {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ error: { message: "Origin not allowed", code: "ORIGIN_NOT_ALLOWED" } }, 403, origin);
  }
  if (request.method !== "POST") {
    return json({ error: { message: "POST required", code: "METHOD_NOT_ALLOWED" } }, 405, origin);
  }

  try {
    const user = await authenticate(request);
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 32768) {
      throw new KuroPushError(413, "リクエストが大きすぎます。", "REQUEST_TOO_LARGE");
    }
    let body;
    try { body = rawBody ? JSON.parse(rawBody) : {}; }
    catch (_) { throw new KuroPushError(400, "JSONが正しくありません。", "INVALID_JSON"); }

    const db = env?.KURO_APP_DB;
    if (!db) throw new KuroPushError(503, "Cloudflare D1に接続できません。", "D1_UNAVAILABLE");
    const action = String(body?.action || "");

    if (action === "upsert") {
      const subscription = normalizeSubscription(body.subscription);
      const now = new Date().toISOString();
      const result = await db.prepare(
        "INSERT INTO push_subscriptions (id,user_id,endpoint,subscription,created_at,updated_at) " +
        "VALUES (?,?,?,?,?,?) " +
        "ON CONFLICT(endpoint) DO UPDATE SET subscription=excluded.subscription,updated_at=excluded.updated_at " +
        "WHERE push_subscriptions.user_id=excluded.user_id"
      ).bind(
        crypto.randomUUID(), user.id, subscription.endpoint, JSON.stringify(subscription), now, now
      ).run();
      if (Number(result?.meta?.changes) < 1) {
        throw new KuroPushError(409, "この端末の通知登録は別のアカウントに紐づいています。", "ENDPOINT_ALREADY_REGISTERED");
      }
      return json({ success: true, source: "cloudflare-d1" }, 200, origin);
    }

    if (action === "delete") {
      const endpoint = validateEndpoint(body.endpoint);
      const result = await db.prepare(
        "DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?"
      ).bind(user.id, endpoint).run();
      return json({ success: true, deleted: Number(result?.meta?.changes) || 0, source: "cloudflare-d1" }, 200, origin);
    }

    if (action === "targets" || action === "prune") {
      const event = body.event;
      const resolved = await resolveEvent(db, user, event);
      if (action === "targets") {
        const subscriptions = await getTargetSubscriptions(db, resolved.recipientIds);
        return json({
          success: true,
          subscriptions,
          title: resolved.title,
          message: resolved.message,
          tag: resolved.tag,
          source: "cloudflare-d1"
        }, 200, origin);
      }

      const subscriptionIds = Array.isArray(body.subscriptionIds)
        ? [...new Set(body.subscriptionIds.map(String).filter(id => UUID_RE.test(id)))].slice(0, 100)
        : [];
      if (!subscriptionIds.length) return json({ success: true, deleted: 0, source: "cloudflare-d1" }, 200, origin);
      const recipientIds = [...new Set(resolved.recipientIds.filter(id => UUID_RE.test(String(id))))].slice(0, 200);
      if (!recipientIds.length) return json({ success: true, deleted: 0, source: "cloudflare-d1" }, 200, origin);
      const idMarks = subscriptionIds.map(() => "?").join(",");
      const userMarks = recipientIds.map(() => "?").join(",");
      const result = await db.prepare(
        "DELETE FROM push_subscriptions WHERE id IN (" + idMarks + ") AND user_id IN (" + userMarks + ")"
      ).bind(...subscriptionIds, ...recipientIds).run();
      return json({ success: true, deleted: Number(result?.meta?.changes) || 0, source: "cloudflare-d1" }, 200, origin);
    }

    throw new KuroPushError(400, "操作が正しくありません。", "INVALID_ACTION");
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error("[kuro-push-d1]", error?.code || "ERROR", error?.message || error);
    return json({
      error: {
        message: error?.message || "プッシュ通知を処理できませんでした。",
        code: error?.code || "D1_PUSH_FAILED"
      }
    }, status, origin);
  }
}
