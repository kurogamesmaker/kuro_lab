const SUPABASE_URL = "https://cprvpphlfpmiegjiutjn.supabase.co";
const SUPABASE_KEY = "sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ORIGINS = new Set([
  "https://kurolab.cc.cd",
  "https://www.kurolab.cc.cd"
]);
const MAX_POST_CHARS = 130;
const MAX_MEDIA_ITEMS = 4;
const encoder = new TextEncoder();

class KuroSnsError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

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

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch (_) { return fallback; }
}

function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)));
  } catch (_) { return null; }
}

async function authenticate(request, optional = false) {
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!token && optional) return null;
  if (!token || token.length > 8192 || token.split(".").length !== 3) {
    throw new KuroSnsError(401, "ログイン状態を確認できません。再ログインしてください。");
  }
  let user;
  try {
    const response = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + token, Accept: "application/json" },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new KuroSnsError(401, "ログイン状態を確認できません。再ログインしてください。");
    user = await response.json();
  } catch (error) {
    if (error instanceof KuroSnsError) throw error;
    throw new KuroSnsError(503, "認証サービスに接続できません。");
  }
  const claims = decodeJwtPayload(token) || {};
  if (!user || !UUID_RE.test(String(user.id || "")) || user.is_anonymous === true ||
      String(claims.sub || "") !== String(user.id || "") || claims.is_anonymous === true) {
    throw new KuroSnsError(401, "KUROアカウントでログインしてください。");
  }
  return user;
}

async function ensureActiveAccount(db, userId) {
  const suspension = await db.prepare(`
    SELECT id, ends_at FROM account_suspensions
    WHERE user_id = ?
      AND revoked_at IS NULL
      AND datetime(starts_at) <= datetime('now')
      AND datetime(ends_at) > datetime('now')
    ORDER BY ends_at DESC LIMIT 1
  `).bind(userId).first();
  if (suspension) throw new KuroSnsError(403, "このアカウントは一時停止中のため、投稿操作を利用できません。");
}

function parseHashtags(content) {
  const found = [];
  const seen = new Set();
  const expression = /[#＃]([\p{L}\p{N}_]{1,30})/gu;
  let match;
  while ((match = expression.exec(content)) && found.length < 20) {
    const tag = match[1].normalize("NFKC");
    const key = tag.toLocaleLowerCase("ja-JP");
    if (!seen.has(key)) { seen.add(key); found.push(tag); }
  }
  return found;
}

function parseMedia(value, userId) {
  const rows = Array.isArray(value) ? value : [];
  if (rows.length > MAX_MEDIA_ITEMS) throw new KuroSnsError(400, "写真は1回につき最大4枚です。");
  const prefix = userId + "/post/";
  const valid = rows.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        item.bucket !== "kuro-sns-public-media" ||
        typeof item.path !== "string" || !item.path.startsWith(prefix) ||
        item.path.length > 700 || item.path.includes("..") || item.path.includes("\\")) {
      throw new KuroSnsError(400, "添付画像の情報が正しくありません。");
    }
    if (!["image/jpeg", "image/webp", "image/png"].includes(String(item.content_type || ""))) {
      throw new KuroSnsError(400, "対応していない画像形式です。");
    }
    const size = Number(item.size || 0);
    if (!Number.isFinite(size) || size < 0 || size > 3 * 1024 * 1024) {
      throw new KuroSnsError(400, "画像サイズが正しくありません。");
    }
    return {
      bucket: "kuro-sns-public-media",
      path: item.path,
      content_type: String(item.content_type),
      width: Math.max(0, Math.min(10000, Math.trunc(Number(item.width) || 0))),
      height: Math.max(0, Math.min(10000, Math.trunc(Number(item.height) || 0))),
      size
    };
  });
  if (encoder.encode(JSON.stringify(valid)).byteLength > 12000) {
    throw new KuroSnsError(400, "添付画像の情報が大きすぎます。");
  }
  return valid;
}

function normalizePost(row) {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    content: String(row.content || ""),
    hashtags: parseJson(row.hashtags, []),
    created_at: row.created_at,
    media: parseJson(row.media, []),
    display_name: row.display_name || "",
    username: row.username || "",
    avatar_url: row.avatar_url || "",
    like_count: Number(row.like_count || 0),
    liked_by_me: Number(row.liked_by_me || 0) === 1,
    replies: []
  };
}

async function loadPostRows(db, { postId = "", userId = "", limit = 100, viewerId = "" } = {}) {
  const conditions = [];
  const params = [];
  if (postId) { conditions.push("p.id = ?"); params.push(postId); }
  if (userId) { conditions.push("p.user_id = ?"); params.push(userId); }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const rowsResult = await db.prepare(`
    SELECT p.id,p.user_id,p.content,p.hashtags,p.created_at,p.media,
           pr.display_name,pr.username,pr.avatar_url
    FROM posts p
    LEFT JOIN profiles pr ON pr.id = p.user_id
    ${where}
    ORDER BY p.created_at DESC
    LIMIT ?
  `).bind(...params, limit).all();
  const rows = Array.isArray(rowsResult?.results) ? rowsResult.results : [];
  if (!rows.length) return [];
  const ids = rows.map(row => String(row.id));
  const marks = ids.map(() => "?").join(",");
  const [likesResult, repliesResult] = await Promise.all([
    db.prepare(`
      SELECT post_id,COUNT(*) AS like_count,
             MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS liked_by_me
      FROM post_likes WHERE post_id IN (${marks}) GROUP BY post_id
    `).bind(viewerId || "", ...ids).all(),
    db.prepare(`
      SELECT r.id,r.post_id,r.user_id,r.content,r.parent_reply_id,r.created_at,r.deleted_at,
             pr.username,pr.display_name,pr.avatar_url
      FROM post_replies r
      LEFT JOIN profiles pr ON pr.id = r.user_id
      WHERE r.post_id IN (${marks})
      ORDER BY r.created_at ASC LIMIT 2000
    `).bind(...ids).all()
  ]);
  const likes = new Map((likesResult?.results || []).map(row => [String(row.post_id), row]));
  const repliesByPost = new Map();
  for (const reply of repliesResult?.results || []) {
    const key = String(reply.post_id);
    if (!repliesByPost.has(key)) repliesByPost.set(key, []);
    repliesByPost.get(key).push({
      id: String(reply.id), post_id: key, user_id: String(reply.user_id),
      content: String(reply.content || ""), parent_reply_id: reply.parent_reply_id || null,
      created_at: reply.created_at, deleted_at: reply.deleted_at || null,
      username: reply.username || "", display_name: reply.display_name || "",
      avatar_url: reply.avatar_url || ""
    });
  }
  return rows.map(row => {
    const post = normalizePost(row);
    const stats = likes.get(post.id);
    post.like_count = Number(stats?.like_count || 0);
    post.liked_by_me = Number(stats?.liked_by_me || 0) === 1;
    post.replies = repliesByPost.get(post.id) || [];
    return post;
  });
}

async function getFeed(request, db, viewer) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "feed";
  const viewerId = viewer?.id || "";
  if (action === "feed") {
    const posts = await loadPostRows(db, { limit: 100, viewerId });
    return { posts, source: "cloudflare-d1" };
  }
  if (action === "user-posts") {
    const userId = String(url.searchParams.get("userId") || "");
    if (!UUID_RE.test(userId)) throw new KuroSnsError(400, "ユーザーIDが正しくありません。");
    const [profile, posts, followers, following] = await Promise.all([
      db.prepare("SELECT id,username,kuro_id,avatar_url,bio FROM profiles WHERE id=? LIMIT 1").bind(userId).first(),
      loadPostRows(db, { userId, limit: 30, viewerId }),
      db.prepare("SELECT COUNT(*) AS total FROM follows WHERE following_id=?").bind(userId).first(),
      db.prepare("SELECT COUNT(*) AS total FROM follows WHERE follower_id=?").bind(userId).first()
    ]);
    const total = await db.prepare("SELECT COUNT(*) AS total FROM posts WHERE user_id=?").bind(userId).first();
    return {
      profile: profile || null,
      posts,
      post_count: Number(total?.total || 0),
      followers: Number(followers?.total || 0),
      following: Number(following?.total || 0),
      source: "cloudflare-d1"
    };
  }
  if (action === "post") {
    const postId = String(url.searchParams.get("id") || "");
    if (!UUID_RE.test(postId)) throw new KuroSnsError(400, "投稿IDが正しくありません。");
    const posts = await loadPostRows(db, { postId, limit: 1, viewerId });
    return { post: posts[0] || null, source: "cloudflare-d1" };
  }
  if (action === "notification-target") {
    if (!viewer) throw new KuroSnsError(401, "ログイン状態を確認できません。");
    const notificationId = String(url.searchParams.get("notificationId") || "");
    if (!UUID_RE.test(notificationId)) throw new KuroSnsError(400, "通知IDが正しくありません。");
    const notice = await db.prepare(`
      SELECT type,notification_details FROM notifications
      WHERE id=? AND recipient_id=? LIMIT 1
    `).bind(notificationId, viewer.id).first();
    if (!notice || !["like", "reply"].includes(String(notice.type))) return { target: null };
    const details = parseJson(notice.notification_details, {});
    const postId = String(details.post_id || details.postId || "");
    const replyId = String(details.reply_id || details.replyId || "");
    if (!UUID_RE.test(postId)) return { target: null };
    const post = await db.prepare("SELECT id,user_id FROM posts WHERE id=? LIMIT 1").bind(postId).first();
    if (!post || String(post.user_id) !== String(viewer.id)) return { target: null };
    return {
      target: {
        postId,
        replyId: UUID_RE.test(replyId) ? replyId : ""
      },
      source: "cloudflare-d1"
    };
  }
  throw new KuroSnsError(400, "投稿取得の操作が正しくありません。");
}

async function createPost(db, user, body) {
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const media = parseMedia(body.media, user.id);
  if ((!content && !media.length) || [...content].length > MAX_POST_CHARS) {
    throw new KuroSnsError(400, "ポストは文章か写真を追加し、文章は130文字以内で入力してください。");
  }
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const hashtags = parseHashtags(content);
  await db.prepare(`
    INSERT INTO posts(id,user_id,content,hashtags,created_at,media)
    VALUES(?,?,?,?,?,?)
  `).bind(id, user.id, content, JSON.stringify(hashtags), createdAt, JSON.stringify(media)).run();
  const posts = await loadPostRows(db, { postId: id, limit: 1, viewerId: user.id });
  return { post: posts[0] || { id, user_id: user.id, content, hashtags, created_at: createdAt, media, like_count: 0, liked_by_me: false, replies: [] } };
}

async function toggleLike(db, user, body) {
  const postId = String(body.postId || "");
  if (!UUID_RE.test(postId) || typeof body.liked !== "boolean") {
    throw new KuroSnsError(400, "いいねの指定が正しくありません。");
  }
  const post = await db.prepare("SELECT user_id FROM posts WHERE id=? LIMIT 1").bind(postId).first();
  if (!post) throw new KuroSnsError(404, "投稿が見つかりません。");
  if (body.liked) {
    const now = new Date().toISOString();
    const likeId = crypto.randomUUID();
    const notificationId = crypto.randomUUID();
    const ownerId = String(post.user_id);
    const results = await db.batch([
      db.prepare("INSERT OR IGNORE INTO post_likes(post_id,user_id,created_at) VALUES(?,?,?)").bind(postId, user.id, now),
      db.prepare(`
        INSERT INTO notifications(id,recipient_id,actor_id,type,created_at,notification_details)
        SELECT ?,p.user_id,?,'like',?,json_object('post_id',?,'source','post_like')
        FROM posts p
        WHERE p.id=? AND p.user_id<>? AND changes()>0
      `).bind(notificationId, user.id, now, postId, postId, user.id)
    ]);
    void results;
  } else {
    await db.prepare("DELETE FROM post_likes WHERE post_id=? AND user_id=?").bind(postId, user.id).run();
  }
  const [count, existing] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS total FROM post_likes WHERE post_id=?").bind(postId).first(),
    db.prepare("SELECT 1 AS liked FROM post_likes WHERE post_id=? AND user_id=? LIMIT 1").bind(postId, user.id).first()
  ]);
  return { liked: Boolean(existing), like_count: Number(count?.total || 0) };
}

async function createReply(db, user, body) {
  const postId = String(body.postId || "");
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const parentReplyId = body.parentReplyId == null || body.parentReplyId === "" ? null : String(body.parentReplyId);
  if (!UUID_RE.test(postId)) throw new KuroSnsError(400, "投稿IDが正しくありません。");
  if (!content || [...content].length > MAX_POST_CHARS) throw new KuroSnsError(400, "返信は1〜130文字で入力してください。");
  if (parentReplyId && !UUID_RE.test(parentReplyId)) throw new KuroSnsError(400, "返信先のIDが正しくありません。");
  const post = await db.prepare("SELECT user_id FROM posts WHERE id=? LIMIT 1").bind(postId).first();
  if (!post) throw new KuroSnsError(404, "投稿が見つかりません。");
  let parentOwnerId = null;
  if (parentReplyId) {
    const parent = await db.prepare("SELECT user_id FROM post_replies WHERE id=? AND post_id=? LIMIT 1").bind(parentReplyId, postId).first();
    if (!parent) throw new KuroSnsError(409, "返信先のコメントは削除されたか、別の投稿に属しています。返信先を選び直してください。");
    parentOwnerId = String(parent.user_id);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const postNoticeId = crypto.randomUUID();
  const parentNoticeId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(`
      INSERT INTO post_replies(id,post_id,user_id,content,created_at,parent_reply_id,deleted_at)
      SELECT ?,?,?,?,?,?,NULL
      WHERE EXISTS(SELECT 1 FROM posts WHERE id=?)
        AND (? IS NULL OR EXISTS(SELECT 1 FROM post_replies WHERE id=? AND post_id=?))
    `).bind(id, postId, user.id, content, createdAt, parentReplyId, postId, parentReplyId, parentReplyId, postId),
    db.prepare(`
      INSERT INTO notifications(id,recipient_id,actor_id,type,created_at,notification_details)
      SELECT ?,p.user_id,?,'reply',?,
        json_object('post_id',?,'reply_id',?,'parent_reply_id',?,'source',?)
      FROM posts p
      WHERE p.id=? AND p.user_id<>? AND EXISTS(SELECT 1 FROM post_replies WHERE id=?)
    `).bind(postNoticeId, user.id, createdAt, postId, id, parentReplyId, parentReplyId ? "reply_to_reply" : "post_reply", postId, user.id, id),
    db.prepare(`
      INSERT INTO notifications(id,recipient_id,actor_id,type,created_at,notification_details)
      SELECT ?,parent.user_id,?,'reply',?,
        json_object('post_id',?,'reply_id',?,'parent_reply_id',?,'source','reply_to_reply')
      FROM post_replies parent
      JOIN posts p ON p.id=parent.post_id
      WHERE parent.id=? AND parent.post_id=?
        AND parent.user_id<>? AND parent.user_id<>p.user_id
        AND EXISTS(SELECT 1 FROM post_replies WHERE id=?)
    `).bind(parentNoticeId, user.id, createdAt, postId, id, parentReplyId, parentReplyId, postId, user.id, id)
  ]);
  if (Number(results?.[0]?.meta?.changes || 0) !== 1) {
    throw new KuroSnsError(409, "投稿または返信先のコメントを確認できません。ページを更新してください。");
  }
  const profile = await db.prepare("SELECT username,display_name,avatar_url FROM profiles WHERE id=? LIMIT 1").bind(user.id).first();
  return {
    reply: {
      id, post_id: postId, user_id: user.id, content, parent_reply_id: parentReplyId,
      created_at: createdAt, deleted_at: null,
      username: profile?.username || "", display_name: profile?.display_name || "",
      avatar_url: profile?.avatar_url || ""
    }
  };
}

async function deleteReply(db, user, body) {
  const replyId = String(body.replyId || "");
  const postId = String(body.postId || "");
  if (!UUID_RE.test(replyId) || !UUID_RE.test(postId)) throw new KuroSnsError(400, "返信を特定できません。");
  const reply = await db.prepare("SELECT id,user_id,deleted_at FROM post_replies WHERE id=? AND post_id=? LIMIT 1").bind(replyId, postId).first();
  if (!reply) throw new KuroSnsError(404, "対象の返信が見つかりません。");
  if (String(reply.user_id) !== String(user.id)) throw new KuroSnsError(403, "自分の返信だけ削除できます。");
  if (reply.deleted_at) return { deleted_at: reply.deleted_at, alreadyDeleted: true };
  const deletedAt = new Date().toISOString();
  const result = await db.prepare("UPDATE post_replies SET deleted_at=? WHERE id=? AND post_id=? AND user_id=? AND deleted_at IS NULL")
    .bind(deletedAt, replyId, postId, user.id).run();
  if (Number(result?.meta?.changes || 0) !== 1) throw new KuroSnsError(409, "返信を更新できませんでした。ページを更新してください。");
  return { deleted_at: deletedAt, alreadyDeleted: false };
}

async function deletePost(db, user, body) {
  const postId = String(body.postId || "");
  if (!UUID_RE.test(postId)) throw new KuroSnsError(400, "投稿IDが正しくありません。");
  const post = await db.prepare("SELECT id,user_id,media FROM posts WHERE id=? LIMIT 1").bind(postId).first();
  if (!post) throw new KuroSnsError(404, "投稿が見つかりません。");
  if (String(post.user_id) !== String(user.id)) throw new KuroSnsError(403, "自分の投稿だけ削除できます。");
  await db.batch([
    db.prepare("DELETE FROM post_likes WHERE post_id=?").bind(postId),
    db.prepare("DELETE FROM post_replies WHERE post_id=?").bind(postId),
    db.prepare("DELETE FROM posts WHERE id=? AND user_id=?").bind(postId, user.id)
  ]);
  return { deleted: true, media: parseJson(post.media, []) };
}

export async function handleKuroD1SnsPosts(request, env) {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed" }, 403);
  const db = env?.KURO_APP_DB;
  if (!db) return json({ error: "Cloudflare D1に接続できません。" }, 503, origin);

  try {
    if (request.method === "GET") {
      const viewer = await authenticate(request, true);
      const data = await getFeed(request, db, viewer);
      return json(data, 200, origin);
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

    const raw = await request.text();
    if (encoder.encode(raw).byteLength > 32768) throw new KuroSnsError(413, "Request body is too large.");
    let body;
    try { body = raw ? JSON.parse(raw) : {}; } catch (_) { throw new KuroSnsError(400, "JSONが正しくありません。"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new KuroSnsError(400, "JSONが正しくありません。");

    const user = await authenticate(request, false);
    await ensureActiveAccount(db, user.id);
    const action = String(body.action || "");
    let data;
    if (action === "create-post") data = await createPost(db, user, body);
    else if (action === "delete-post") data = await deletePost(db, user, body);
    else if (action === "like") data = await toggleLike(db, user, body);
    else if (action === "create-reply") data = await createReply(db, user, body);
    else if (action === "delete-reply") data = await deleteReply(db, user, body);
    else throw new KuroSnsError(400, "投稿操作が正しくありません。");
    return json({ ...data, source: "cloudflare-d1" }, 200, origin);
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error("KURO D1 SNS post API failed", error?.message || error);
    return json({ error: error?.message || "SNSの操作に失敗しました。" }, status, origin);
  }
}
