const SUPABASE_URL = "https://cprvpphlfpmiegjiutjn.supabase.co";
const SUPABASE_KEY = "sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ORIGINS = new Set([
  "https://kurolab.cc.cd",
  "https://www.kurolab.cc.cd",
  "https://admin.kurolab.cc.cd"
]);
const TABLES = {
  chat_conversations: ["id","user_a","user_b","created_by","created_at","updated_at"],
  chat_messages: ["id","conversation_id","sender_id","content","created_at","media"],
  chat_message_reads: ["message_id","reader_id","read_at"],
  chat_message_hides: ["message_id","user_id","hidden_at"],
  group_conversations: ["id","name","created_by","created_at","updated_at","icon"],
  group_chat_members: ["group_id","user_id","role","joined_at"],
  group_chat_messages: ["id","group_id","sender_id","content","created_at","media"],
  group_chat_message_reads: ["message_id","group_id","reader_id","read_at"],
  group_chat_mentions: ["message_id","group_id","mentioned_user_id","created_at"]
};
const encoder = new TextEncoder();

class KuroChatError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || "KURO_CHAT_ERROR";
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
    headers["Access-Control-Allow-Headers"] = "authorization, apikey, content-type, x-client-info";
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
    throw new KuroChatError(401, "ログイン状態を確認できません。再ログインしてください。", "AUTH_REQUIRED");
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
    if (!response.ok) throw new KuroChatError(401, "ログイン状態を確認できません。再ログインしてください。", "AUTH_INVALID");
    user = await response.json();
  } catch (error) {
    if (error instanceof KuroChatError) throw error;
    throw new KuroChatError(503, "認証サービスに接続できません。", "AUTH_UNAVAILABLE");
  }
  const claims = decodeJwtPayload(token) || {};
  if (!user || !UUID_RE.test(String(user.id || "")) || user.is_anonymous === true ||
      String(claims.sub || "") !== String(user.id || "") || claims.is_anonymous === true) {
    throw new KuroChatError(401, "KUROアカウントでログインしてください。", "AUTH_INVALID");
  }
  return user;
}

async function ensureActiveAccount(db, userId) {
  const suspension = await db.prepare(
    "SELECT id FROM account_suspensions WHERE user_id=? AND revoked_at IS NULL AND datetime(starts_at)<=datetime('now') AND datetime(ends_at)>datetime('now') LIMIT 1"
  ).bind(userId).first();
  if (suspension) throw new KuroChatError(403, "このアカウントは一時停止中のため、チャットを利用できません。", "ACCOUNT_SUSPENDED");
}

function parseMedia(value, userId, scope, entityId) {
  let rows = value;
  if (typeof rows === "string") {
    try { rows = JSON.parse(rows); } catch (_) { rows = []; }
  }
  if (rows == null) rows = [];
  if (!Array.isArray(rows) || rows.length > 4) {
    throw new KuroChatError(400, "添付画像は1回につき最大4枚です。", "INVALID_MEDIA");
  }
  const expectedPrefix = String(userId) + "/" + scope + "/" + String(entityId) + "/";
  return rows.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        typeof item.path !== "string" || !item.path.startsWith(expectedPrefix) ||
        item.path.length > 700 || item.path.includes("..") || item.path.includes("\\") ||
        typeof item.bucket !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(item.bucket) ||
        !["image/jpeg","image/png","image/webp"].includes(String(item.content_type || ""))) {
      throw new KuroChatError(400, "添付画像の情報が正しくありません。", "INVALID_MEDIA");
    }
    const size = Number(item.size || 0);
    if (!Number.isFinite(size) || size < 0 || size > 5 * 1024 * 1024) {
      throw new KuroChatError(400, "画像サイズが正しくありません。", "INVALID_MEDIA");
    }
    return {
      bucket: item.bucket,
      path: item.path,
      content_type: String(item.content_type),
      width: Math.max(0, Math.min(10000, Math.trunc(Number(item.width) || 0))),
      height: Math.max(0, Math.min(10000, Math.trunc(Number(item.height) || 0))),
      size
    };
  });
}

function parseJsonColumns(rows, table) {
  return (rows || []).map(row => {
    if (!row || typeof row !== "object") return row;
    const copy = { ...row };
    if (["chat_messages","group_chat_messages"].includes(table) && typeof copy.media === "string") {
      try { copy.media = JSON.parse(copy.media); } catch (_) { copy.media = []; }
    }
    return copy;
  });
}

function validColumn(table, column) {
  return TABLES[table].includes(String(column || ""));
}

function filterSql(table, filters) {
  const parts = [];
  const values = [];
  for (const filter of Array.isArray(filters) ? filters : []) {
    const column = String(filter?.column || "");
    const op = String(filter?.op || "eq").toLowerCase();
    if (!validColumn(table, column)) throw new KuroChatError(400, "検索条件が正しくありません。", "INVALID_FILTER");
    const value = filter.value;
    if (op === "in") {
      if (!Array.isArray(value)) throw new KuroChatError(400, "検索条件が正しくありません。", "INVALID_FILTER");
      if (!value.length) { parts.push("1=0"); continue; }
      if (value.length > 500) throw new KuroChatError(400, "検索件数が多すぎます。", "INVALID_FILTER");
      parts.push('"' + column + '" IN (' + value.map(() => "?").join(",") + ")");
      values.push(...value.map(v => v == null ? null : String(v)));
    } else if (op === "is") {
      if (value === null) parts.push('"' + column + '" IS NULL');
      else if (value === true || value === false) {
        parts.push('"' + column + '" = ?');
        values.push(value ? 1 : 0);
      } else throw new KuroChatError(400, "検索条件が正しくありません。", "INVALID_FILTER");
    } else if (["eq","neq","gt","gte","lt","lte"].includes(op)) {
      const operator = {eq:"=",neq:"!=",gt:">",gte:">=",lt:"<",lte:"<="}[op];
      parts.push('"' + column + '" ' + operator + " ?");
      values.push(value == null ? null : String(value));
    } else {
      throw new KuroChatError(400, "検索条件が正しくありません。", "INVALID_FILTER");
    }
  }
  return { sql: parts.length ? " AND " + parts.join(" AND ") : "", values };
}

async function scopeSql(db, table, userId, operation, payload) {
  const member = "EXISTS (SELECT 1 FROM group_chat_members AS __gm WHERE __gm.group_id = ";
  if (table === "chat_conversations") return {
    sql: "(user_a=? OR user_b=?)",
    values: [userId,userId]
  };
  if (table === "chat_messages") return {
    sql: "EXISTS (SELECT 1 FROM chat_conversations AS __cc WHERE __cc.id=chat_messages.conversation_id AND (__cc.user_a=? OR __cc.user_b=?))",
    values: [userId,userId]
  };
  if (table === "chat_message_reads") return {
    sql: "EXISTS (SELECT 1 FROM chat_messages AS __cm INNER JOIN chat_conversations AS __cc ON __cc.id=__cm.conversation_id WHERE __cm.id=chat_message_reads.message_id AND (__cc.user_a=? OR __cc.user_b=?))",
    values: [userId,userId]
  };
  if (table === "chat_message_hides") return {
    sql: "user_id=? AND EXISTS (SELECT 1 FROM chat_messages AS __cm INNER JOIN chat_conversations AS __cc ON __cc.id=__cm.conversation_id WHERE __cm.id=chat_message_hides.message_id AND (__cc.user_a=? OR __cc.user_b=?))",
    values: [userId,userId,userId]
  };
  if (table === "group_conversations") return {
    sql: "EXISTS (SELECT 1 FROM group_chat_members AS __gm WHERE __gm.group_id=group_conversations.id AND __gm.user_id=?)",
    values: [userId]
  };
  if (table === "group_chat_members") return {
    sql: "EXISTS (SELECT 1 FROM group_chat_members AS __mine WHERE __mine.group_id=group_chat_members.group_id AND __mine.user_id=?)",
    values: [userId]
  };
  if (table === "group_chat_messages") return {
    sql: "EXISTS (SELECT 1 FROM group_chat_members AS __gm WHERE __gm.group_id=group_chat_messages.group_id AND __gm.user_id=?)",
    values: [userId]
  };
  if (table === "group_chat_message_reads") return {
    sql: "EXISTS (SELECT 1 FROM group_chat_members AS __gm WHERE __gm.group_id=group_chat_message_reads.group_id AND __gm.user_id=?)",
    values: [userId]
  };
  if (table === "group_chat_mentions") return {
    sql: "EXISTS (SELECT 1 FROM group_chat_members AS __gm WHERE __gm.group_id=group_chat_mentions.group_id AND __gm.user_id=?)",
    values: [userId]
  };
  throw new KuroChatError(400, "未対応のチャットテーブルです。", "INVALID_TABLE");
}

async function isGroupMember(db, groupId, userId) {
  return !!(await db.prepare("SELECT 1 AS yes FROM group_chat_members WHERE group_id=? AND user_id=? LIMIT 1").bind(groupId,userId).first());
}

async function isGroupAdmin(db, groupId, userId) {
  return !!(await db.prepare("SELECT 1 AS yes FROM group_chat_members WHERE group_id=? AND user_id=? AND role='admin' LIMIT 1").bind(groupId,userId).first());
}

async function requireConversation(db, conversationId, userId) {
  if (!UUID_RE.test(String(conversationId || ""))) throw new KuroChatError(400, "会話IDが正しくありません。", "INVALID_ID");
  const row = await db.prepare("SELECT id,user_a,user_b FROM chat_conversations WHERE id=? LIMIT 1").bind(conversationId).first();
  if (!row || (row.user_a !== userId && row.user_b !== userId)) {
    throw new KuroChatError(403, "この会話を利用する権限がありません。", "FORBIDDEN");
  }
  return row;
}

function normalizePayload(table, item, userId) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new KuroChatError(400, "データ形式が正しくありません。", "INVALID_BODY");
  const out = {};
  for (const [key,value] of Object.entries(item)) {
    if (!validColumn(table,key)) throw new KuroChatError(400, "保存する項目が正しくありません。", "INVALID_COLUMN");
    out[key] = value;
  }
  const now = new Date().toISOString();
  if (table === "chat_conversations") {
    const a = String(out.user_a || ""), b = String(out.user_b || "");
    if (!UUID_RE.test(a) || !UUID_RE.test(b) || a === b || (a !== userId && b !== userId)) {
      throw new KuroChatError(403, "会話の参加者が正しくありません。", "FORBIDDEN");
    }
    if (a > b) throw new KuroChatError(400, "会話参加者の並び順が正しくありません。", "INVALID_PAIR");
    if (out.created_by && out.created_by !== userId) throw new KuroChatError(403, "会話を作成できません。", "FORBIDDEN");
    out.id = UUID_RE.test(String(out.id || "")) ? out.id : crypto.randomUUID();
    out.created_by = userId;
    out.created_at = out.created_at || now;
    out.updated_at = out.updated_at || now;
  } else if (table === "chat_messages" || table === "group_chat_messages") {
    if (String(out.sender_id || "") !== userId) throw new KuroChatError(403, "送信者が一致しません。", "FORBIDDEN");
    if (String(out.content || "").length > 1000) throw new KuroChatError(400, "メッセージは1000文字以内にしてください。", "INVALID_CONTENT");
    if (table === "chat_messages") {
      if (!UUID_RE.test(String(out.conversation_id || ""))) throw new KuroChatError(400, "会話IDが正しくありません。", "INVALID_ID");
      out.media = JSON.stringify(parseMedia(out.media,userId,"dm",out.conversation_id));
    } else {
      if (!UUID_RE.test(String(out.group_id || ""))) throw new KuroChatError(400, "グループIDが正しくありません。", "INVALID_ID");
      out.media = JSON.stringify(parseMedia(out.media,userId,"group",out.group_id));
    }
    out.id = UUID_RE.test(String(out.id || "")) ? out.id : crypto.randomUUID();
    out.created_at = out.created_at || now;
    out.content = String(out.content || "");
  } else if (table === "chat_message_reads") {
    if (String(out.reader_id || "") !== userId || !UUID_RE.test(String(out.message_id || ""))) {
      throw new KuroChatError(403, "既読情報を更新できません。", "FORBIDDEN");
    }
    out.read_at = out.read_at || now;
  } else if (table === "chat_message_hides") {
    if (String(out.user_id || "") !== userId || !UUID_RE.test(String(out.message_id || ""))) {
      throw new KuroChatError(403, "非表示情報を更新できません。", "FORBIDDEN");
    }
    out.hidden_at = out.hidden_at || now;
  } else if (table === "group_conversations") {
    const name = String(out.name || "").trim();
    if (!name || name.length > 60 || String(out.created_by || "") !== userId) {
      throw new KuroChatError(400, "グループ情報が正しくありません。", "INVALID_GROUP");
    }
    out.id = UUID_RE.test(String(out.id || "")) ? out.id : crypto.randomUUID();
    out.name = name;
    out.icon = String(out.icon || "👥").slice(0,700);
    out.created_by = userId;
    out.created_at = out.created_at || now;
    out.updated_at = out.updated_at || now;
  } else if (table === "group_chat_members") {
    if (!UUID_RE.test(String(out.group_id || "")) || !UUID_RE.test(String(out.user_id || ""))) {
      throw new KuroChatError(400, "メンバー情報が正しくありません。", "INVALID_MEMBER");
    }
    out.role = out.role === "admin" ? "admin" : "member";
    out.joined_at = out.joined_at || now;
  } else if (table === "group_chat_message_reads") {
    if (String(out.reader_id || "") !== userId || !UUID_RE.test(String(out.group_id || "")) || !UUID_RE.test(String(out.message_id || ""))) {
      throw new KuroChatError(403, "既読情報を更新できません。", "FORBIDDEN");
    }
    out.read_at = out.read_at || now;
  } else if (table === "group_chat_mentions") {
    if (!UUID_RE.test(String(out.group_id || "")) || !UUID_RE.test(String(out.message_id || "")) ||
        !UUID_RE.test(String(out.mentioned_user_id || ""))) {
      throw new KuroChatError(400, "メンション情報が正しくありません。", "INVALID_MENTION");
    }
    out.created_at = out.created_at || now;
  }
  return out;
}

async function authorizeWrite(db, table, op, payload, userId) {
  const items = Array.isArray(payload) ? payload : [payload];
  if (table === "chat_conversations") {
    if (op === "insert") {
      for (const item of items) {
        const normalized = normalizePayload(table,item,userId);
        if (normalized.user_a === normalized.user_b) throw new KuroChatError(400,"自分自身との会話は作成できません。","INVALID_PAIR");
      }
    }
    return;
  }
  if (table === "chat_messages") {
    for (const item of items) {
      const row = normalizePayload(table,item,userId);
      await requireConversation(db,row.conversation_id,userId);
    }
    return;
  }
  if (table === "chat_message_reads") {
    for (const item of items) {
      const row = normalizePayload(table,item,userId);
      const message = await db.prepare("SELECT m.sender_id,c.user_a,c.user_b FROM chat_messages m INNER JOIN chat_conversations c ON c.id=m.conversation_id WHERE m.id=? LIMIT 1").bind(row.message_id).first();
      if (!message || (message.user_a !== userId && message.user_b !== userId) || message.sender_id === userId) {
        throw new KuroChatError(403,"このメッセージの既読状態を更新できません。","FORBIDDEN");
      }
    }
    return;
  }
  if (table === "chat_message_hides") {
    for (const item of items) {
      const row = normalizePayload(table,item,userId);
      const message = await db.prepare("SELECT sender_id,conversation_id FROM chat_messages WHERE id=? LIMIT 1").bind(row.message_id).first();
      if (!message || message.sender_id !== userId) throw new KuroChatError(403,"自分が送信したメッセージだけ非表示にできます。","FORBIDDEN");
      await requireConversation(db,message.conversation_id,userId);
    }
    return;
  }
  if (table === "group_conversations") {
    if (op === "insert") {
      for (const item of items) normalizePayload(table,item,userId);
    }
    return;
  }
  if (table === "group_chat_members") {
    for (const item of items) {
      const row = normalizePayload(table,item,userId);
      const group = await db.prepare("SELECT created_by FROM group_conversations WHERE id=? LIMIT 1").bind(row.group_id).first();
      if (!group) throw new KuroChatError(404,"グループが見つかりません。","NOT_FOUND");
      const existing = await isGroupMember(db,row.group_id,userId);
      if (!existing && group.created_by !== userId) throw new KuroChatError(403,"グループのメンバーではありません。","FORBIDDEN");
      if (row.role === "admin" && group.created_by !== userId && !await isGroupAdmin(db,row.group_id,userId)) {
        throw new KuroChatError(403,"管理者権限が必要です。","FORBIDDEN");
      }
      const profile = await db.prepare("SELECT id FROM profiles WHERE id=? LIMIT 1").bind(row.user_id).first();
      if (!profile) throw new KuroChatError(404,"追加するユーザーが見つかりません。","NOT_FOUND");
    }
    return;
  }
  if (table === "group_chat_messages") {
    for (const item of items) {
      const row = normalizePayload(table,item,userId);
      if (!await isGroupMember(db,row.group_id,userId)) throw new KuroChatError(403,"このグループのメンバーではありません。","FORBIDDEN");
    }
    return;
  }
  if (table === "group_chat_message_reads") {
    for (const item of items) {
      const row = normalizePayload(table,item,userId);
      if (!await isGroupMember(db,row.group_id,userId)) throw new KuroChatError(403,"このグループのメンバーではありません。","FORBIDDEN");
      const message = await db.prepare("SELECT sender_id,group_id FROM group_chat_messages WHERE id=? LIMIT 1").bind(row.message_id).first();
      if (!message || message.group_id !== row.group_id || message.sender_id === userId) {
        throw new KuroChatError(403,"このメッセージの既読状態を更新できません。","FORBIDDEN");
      }
    }
    return;
  }
  if (table === "group_chat_mentions") {
    for (const item of items) {
      const row = normalizePayload(table,item,userId);
      if (!await isGroupMember(db,row.group_id,userId)) throw new KuroChatError(403,"このグループのメンバーではありません。","FORBIDDEN");
      const message = await db.prepare("SELECT sender_id,group_id FROM group_chat_messages WHERE id=? LIMIT 1").bind(row.message_id).first();
      if (!message || message.group_id !== row.group_id || message.sender_id !== userId) {
        throw new KuroChatError(403,"このメンションを作成できません。","FORBIDDEN");
      }
      if (!await isGroupMember(db,row.group_id,row.mentioned_user_id)) {
        throw new KuroChatError(400,"メンション先はグループメンバーではありません。","INVALID_MENTION");
      }
    }
    return;
  }
}

function mapSqlError(error) {
  const message = String(error?.message || error || "チャットを処理できませんでした。");
  if (/UNIQUE constraint failed/i.test(message)) return new KuroChatError(409,"同じデータが既に存在します。","23505");
  if (/FOREIGN KEY constraint failed/i.test(message)) return new KuroChatError(400,"関連データを確認できません。","23503");
  return new KuroChatError(500,"チャットの保存に失敗しました。","D1_QUERY_FAILED");
}

async function executeSelect(db, table, userId, body) {
  const scope = await scopeSql(db,table,userId,"select",null);
  const filter = filterSql(table,body.filters);
  const columns = body.columns === "*" || !body.columns
    ? "*"
    : String(body.columns).split(",").map(x=>x.trim()).filter(Boolean).map(x=>{
        if(!validColumn(table,x)) throw new KuroChatError(400,"取得項目が正しくありません。","INVALID_COLUMN");
        return '"' + x + '"';
      }).join(",");
  const orders = (Array.isArray(body.orders) ? body.orders : []).map(order=>{
    const column = String(order?.column || "");
    if(!validColumn(table,column)) throw new KuroChatError(400,"並び順が正しくありません。","INVALID_ORDER");
    return '"' + column + '" ' + (order.ascending === false ? "DESC" : "ASC");
  });
  const limit = Math.max(1,Math.min(500,Number(body.limit)||100));
  const sql = "SELECT " + columns + " FROM " + table + " WHERE (" + scope.sql + ")" + filter.sql +
    (orders.length ? " ORDER BY " + orders.join(",") : "") + " LIMIT ?";
  const result = await db.prepare(sql).bind(...scope.values,...filter.values,limit).all();
  return parseJsonColumns(result?.results || [],table);
}

async function insertRows(db, table, userId, body) {
  const items = Array.isArray(body.payload) ? body.payload : [body.payload];
  if (!items.length || items.length > 500) throw new KuroChatError(400,"保存件数が正しくありません。","INVALID_BODY");
  await authorizeWrite(db,table,"insert",items,userId);
  const results = [];
  for (const raw of items) {
    const row = normalizePayload(table,raw,userId);
    if (table === "chat_conversations") {
      const existing = await db.prepare("SELECT * FROM chat_conversations WHERE user_a=? AND user_b=? LIMIT 1").bind(row.user_a,row.user_b).first();
      if (existing) { results.push(existing); continue; }
    }
    if (table === "chat_messages") await requireConversation(db,row.conversation_id,userId);
    if (table === "group_chat_messages" && !await isGroupMember(db,row.group_id,userId)) throw new KuroChatError(403,"このグループのメンバーではありません。","FORBIDDEN");
    const keys = Object.keys(row);
    const sql = "INSERT INTO " + table + " (" + keys.map(k=>'"'+k+'"').join(",") + ") VALUES (" + keys.map(()=>"?").join(",") + ")";
    try {
      await db.prepare(sql).bind(...keys.map(k=>k==="media"?row[k]:row[k])).run();
    } catch (error) {
      throw mapSqlError(error);
    }
    const primary = table === "chat_conversations" || table === "group_conversations" ||
      table === "chat_messages" || table === "group_chat_messages" ? {id:row.id}
      : table === "chat_message_reads" ? {message_id:row.message_id,reader_id:row.reader_id}
      : table === "chat_message_hides" ? {message_id:row.message_id,user_id:row.user_id}
      : table === "group_chat_members" ? {group_id:row.group_id,user_id:row.user_id}
      : table === "group_chat_message_reads" ? {message_id:row.message_id,reader_id:row.reader_id}
      : table === "group_chat_mentions" ? {message_id:row.message_id,mentioned_user_id:row.mentioned_user_id}
      : null;
    let saved = row;
    if (primary) {
      const where = Object.keys(primary).map(k=>'"'+k+'"=?').join(" AND ");
      saved = await db.prepare("SELECT * FROM " + table + " WHERE " + where + " LIMIT 1").bind(...Object.values(primary)).first() || row;
    }
    results.push(...parseJsonColumns([saved],table));
  }
  return results;
}

async function updateRows(db, table, userId, body) {
  const updates = body.payload;
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) throw new KuroChatError(400,"更新データが正しくありません。","INVALID_BODY");
  const keys = Object.keys(updates);
  if (!keys.length || keys.some(k=>!validColumn(table,k)) || keys.some(k=>["id","user_a","user_b","created_by","sender_id","user_id","reader_id","message_id","conversation_id","group_id","joined_at","created_at"].includes(k))) {
    throw new KuroChatError(400,"更新項目が正しくありません。","INVALID_COLUMN");
  }
  const scope = await scopeSql(db,table,userId,"update",null);
  const filter = filterSql(table,body.filters);
  if (!body.filters?.length) throw new KuroChatError(400,"更新対象を指定してください。","FILTER_REQUIRED");
  if (table === "group_conversations") {
    const groupIds = (body.filters || []).filter(f=>f.column==="id"&&f.op==="eq").map(f=>String(f.value));
    for(const id of groupIds) if(!await isGroupMember(db,id,userId)) throw new KuroChatError(403,"グループのメンバーではありません。","FORBIDDEN");
  }
  const setSql = keys.map(k=>'"'+k+'"=?').join(",");
  const values = keys.map(k=>k==="icon"||k==="name"||k==="updated_at"?String(updates[k]):updates[k]);
  try {
    const result = await db.prepare("UPDATE " + table + " SET " + setSql + " WHERE (" + scope.sql + ")" + filter.sql + " RETURNING *")
      .bind(...values,...scope.values,...filter.values).all();
    return parseJsonColumns(result?.results || [],table);
  } catch(error) { throw mapSqlError(error); }
}

async function deleteRows(db, table, userId, body) {
  const scope = table === "group_conversations"
    ? { sql: "(created_by=? OR EXISTS (SELECT 1 FROM group_chat_members AS __gm WHERE __gm.group_id=group_conversations.id AND __gm.user_id=?))", values: [userId,userId] }
    : await scopeSql(db,table,userId,"delete",null);
  const filter = filterSql(table,body.filters);
  if (!body.filters?.length) throw new KuroChatError(400,"削除対象を指定してください。","FILTER_REQUIRED");
  if (table === "group_chat_members") {
    const groupIds = (body.filters || []).filter(f=>f.column==="group_id"&&f.op==="eq").map(f=>String(f.value));
    for(const id of groupIds) if(!await isGroupAdmin(db,id,userId)) throw new KuroChatError(403,"メンバーを削除できるのは管理者だけです。","FORBIDDEN");
  }
  if (table === "group_conversations") {
    const ids = (body.filters || []).filter(f=>f.column==="id"&&f.op==="eq").map(f=>String(f.value));
    for(const id of ids) {
      const group = await db.prepare("SELECT created_by FROM group_conversations WHERE id=?").bind(id).first();
      if(!group || (group.created_by !== userId && !await isGroupAdmin(db,id,userId))) {
        throw new KuroChatError(403,"グループを削除する権限がありません。","FORBIDDEN");
      }
    }
  }
  try {
    const result = await db.prepare("DELETE FROM " + table + " WHERE (" + scope.sql + ")" + filter.sql + " RETURNING *")
      .bind(...scope.values,...filter.values).all();
    return parseJsonColumns(result?.results || [],table);
  } catch(error) { throw mapSqlError(error); }
}

async function upsertRows(db, table, userId, body) {
  const items = Array.isArray(body.payload) ? body.payload : [body.payload];
  if (!items.length || items.length > 500) throw new KuroChatError(400,"保存件数が正しくありません。","INVALID_BODY");
  if (!["chat_message_reads","group_chat_message_reads"].includes(table)) {
    throw new KuroChatError(403,"このテーブルの更新は許可されていません。","FORBIDDEN");
  }
  await authorizeWrite(db,table,"upsert",items,userId);
  const results = [];
  for (const raw of items) {
    const row = normalizePayload(table,raw,userId);
    const keys = Object.keys(row);
    const sql = "INSERT OR IGNORE INTO " + table + " (" + keys.map(k=>'"'+k+'"').join(",") + ") VALUES (" + keys.map(()=>"?").join(",") + ")";
    await db.prepare(sql).bind(...keys.map(k=>row[k])).run();
    const primary = table === "chat_message_reads" ? ["message_id","reader_id"] : ["message_id","reader_id"];
    const saved = await db.prepare("SELECT * FROM " + table + " WHERE " + primary.map(k=>'"'+k+'"=?').join(" AND ") + " LIMIT 1")
      .bind(row.message_id,userId).first();
    if (saved) results.push(saved);
  }
  return results;
}

async function handleQuery(request,env,user) {
  const db = env?.KURO_APP_DB;
  if (!db) throw new KuroChatError(503,"Cloudflare D1に接続できません。","D1_UNAVAILABLE");
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 65536) throw new KuroChatError(413,"リクエストが大きすぎます。","REQUEST_TOO_LARGE");
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > 65536) throw new KuroChatError(413,"リクエストが大きすぎます。","REQUEST_TOO_LARGE");
  let body;
  try { body = raw ? JSON.parse(raw) : {}; } catch (_) { throw new KuroChatError(400,"JSONが正しくありません。","INVALID_JSON"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new KuroChatError(400,"JSONが正しくありません。","INVALID_JSON");
  const table = String(body.table || "");
  const operation = String(body.operation || "select");
  if (!TABLES[table]) throw new KuroChatError(400,"未対応のチャットテーブルです。","INVALID_TABLE");
  if (!["select","insert","update","delete","upsert"].includes(operation)) throw new KuroChatError(400,"操作が正しくありません。","INVALID_OPERATION");
  if (operation !== "select") await ensureActiveAccount(db,user.id);
  let data = null;
  if (operation === "select") data = await executeSelect(db,table,user.id,body);
  else if (operation === "insert") data = await insertRows(db,table,user.id,body);
  else if (operation === "update") data = await updateRows(db,table,user.id,body);
  else if (operation === "delete") data = await deleteRows(db,table,user.id,body);
  else data = await upsertRows(db,table,user.id,body);

  if (operation !== "select" && !body.returning) data = null;
  if (body.cardinality === "single" || body.cardinality === "maybeSingle") {
    if (Array.isArray(data) && data.length > 1) throw new KuroChatError(406,"JSON object requested, multiple (or no) rows returned","PGRST116");
    if (Array.isArray(data)) {
      if (body.cardinality === "single" && data.length === 0) throw new KuroChatError(406,"JSON object requested, no rows returned","PGRST116");
      data = data[0] || null;
    }
  }
  return {data,error:null};
}

export async function handleKuroD1Chat(request,env) {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response(null,{status:403});
    return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({error:{message:"Origin not allowed",code:"ORIGIN_NOT_ALLOWED"}},403,origin);
  if (request.method !== "POST") return json({error:{message:"POST required",code:"METHOD_NOT_ALLOWED"}},405,origin);
  try {
    const user = await authenticate(request);
    const payload = await handleQuery(request,env,user);
    return json(payload,200,origin);
  } catch(error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error("[kuro-chat-d1]",error?.code || "ERROR",error?.message || error);
    return json({data:null,error:{
      message: error?.message || "チャットを処理できませんでした。",
      code: error?.code || "KURO_CHAT_ERROR"
    }},status,origin);
  }
}
