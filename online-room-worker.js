const encoder = new TextEncoder();
const SUPABASE_FUNCTION = "kurogames-online";
const MAX_MESSAGE_BYTES = 32 * 1024;
const MAX_PLAYERS = 35;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}
function originAllowed(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
  return allowed.includes(origin);
}
function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  return {
    "access-control-allow-origin": origin && originAllowed(request, env) ? origin : "null",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    "vary": "origin",
  };
}
function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromB64url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - text.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function hmacKey(secret, usages) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
}
async function issueTicket(claims, secret) {
  const payload = b64url(encoder.encode(JSON.stringify(claims)));
  const key = await hmacKey(secret, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return payload + "." + b64url(signature);
}
async function verifyTicket(ticket, secret) {
  if (typeof ticket !== "string" || ticket.length > 4096) return null;
  const parts = ticket.split(".");
  if (parts.length !== 2) return null;
  try {
    const key = await hmacKey(secret, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, fromB64url(parts[1]), encoder.encode(parts[0]));
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    if (!claims || typeof claims.sub !== "string" || !claims.sub ||
        typeof claims.room !== "string" || typeof claims.game !== "string" ||
        !Number.isInteger(claims.exp) || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch (_) { return null; }
}
function validId(value, max = 128) {
  return typeof value === "string" && value.length > 0 && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value);
}
async function getSupabaseUser(env, accessToken) {
  const response = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/user", {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: "Bearer " + accessToken },
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user && typeof user.id === "string" ? user : null;
}
async function verifyRoomMembership(env, accessToken, gameId, roomId, userId) {
  const response = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/" + SUPABASE_FUNCTION, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: env.SUPABASE_ANON_KEY,
      authorization: "Bearer " + accessToken,
    },
    body: JSON.stringify({ action: "room_poll", gameId, roomId, afterId: null }),
  });
  if (!response.ok) return false;
  const data = await response.json();
  if (!data || data.error || data.roomStatus === "closed" || !Array.isArray(data.members)) return false;
  return data.members.find(member => member && String(member.userId || member.user_id || "") === userId) || null;
}
async function createTicket(request, env) {
  const headers = corsHeaders();
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, headers);
  if (!env.TICKET_SECRET || env.TICKET_SECRET.length < 32) return json({ error: "service_not_configured" }, 503, headers);
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token.length > 8192) return json({ error: "unauthorized" }, 401, headers);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return json({ error: "request_too_large" }, 413, headers);
    body = JSON.parse(raw);
  } catch (_) { return json({ error: "invalid_json" }, 400, headers); }
  const { roomId, gameId } = body || {};
  if (!validId(roomId) || !/^[0-9a-f-]{36}$/i.test(String(gameId || ""))) {
    return json({ error: "invalid_room_or_game" }, 400, headers);
  }
  let user;
  try { user = await getSupabaseUser(env, token); } catch (_) { user = null; }
  if (!user) return json({ error: "unauthorized" }, 401, headers);
  let member;
  try { member = await verifyRoomMembership(env, token, gameId, roomId, user.id); } catch (_) { member = null; }
  if (!member) return json({ error: "room_membership_required" }, 403, headers);
  const meta = user.user_metadata || {};
  const name = String(member.user && member.user.display_name || meta.display_name || meta.username || "プレイヤー").slice(0, 40);
  const now = Math.floor(Date.now() / 1000);
  const ticket = await issueTicket({ sub: user.id, name, room: roomId, game: gameId, iat: now, exp: now + 60 }, env.TICKET_SECRET);
  return json({ ticket, expiresAt: (now + 60) * 1000 }, 200, headers);
}

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Map();
    this.tail = Promise.resolve();
    this.loaded = false;
    this.data = { state: null, updatedAt: null };
  }
  async load() {
    if (this.loaded) return;
    const saved = await this.state.storage.get("room-state");
    if (saved && typeof saved === "object") this.data = saved;
    this.loaded = true;
  }
  async save() {
    await this.state.storage.put("room-state", this.data);
  }
  players() {
    const unique = new Map();
    for (const player of this.sockets.values()) unique.set(player.id, player);
    return Array.from(unique.values());
  }
  send(ws, payload) {
    try { ws.send(JSON.stringify(payload)); return true; }
    catch (_) { this.sockets.delete(ws); return false; }
  }
  broadcast(payload, exceptUserId = null) {
    const encoded = JSON.stringify(payload);
    for (const [ws, player] of this.sockets) {
      if (exceptUserId && player.id === exceptUserId) continue;
      try { ws.send(encoded); } catch (_) { this.sockets.delete(ws); }
    }
  }
  async fetch(request) {
    await this.load();
    const userId = request.headers.get("x-kuro-user-id") || "";
    const gameId = request.headers.get("x-kuro-game-id") || "";
    const userName = (request.headers.get("x-kuro-user-name") || "プレイヤー").slice(0, 40);
    if (!userId || !gameId) return json({ error: "trusted_identity_required" }, 401);
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "websocket_required" }, 426);
    const distinct = new Set(Array.from(this.sockets.values(), p => p.id));
    if (!distinct.has(userId) && distinct.size >= MAX_PLAYERS) return json({ error: "room_full" }, 409);
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    server.accept();
    const player = { id: userId, name: userName, gameId, joinedAt: Date.now() };
    this.sockets.set(server, player);
    server.addEventListener("close", () => this.removeSocket(server, userId));
    server.addEventListener("error", () => this.removeSocket(server, userId));
    server.addEventListener("message", event => {
      this.tail = this.tail.then(() => this.onMessage(server, player, event.data)).catch(() => {
        this.send(server, { type: "error", error: "internal_error" });
      });
    });
    this.send(server, {
      type: "welcome",
      room: this.state.id.toString(),
      players: this.players(),
      state: this.data.state,
      updatedAt: this.data.updatedAt,
    });
    this.broadcast({ type: "players", players: this.players() }, userId);
    return new Response(null, { status: 101, webSocket: client });
  }
  removeSocket(ws, userId) {
    this.sockets.delete(ws);
    if (!Array.from(this.sockets.values()).some(p => p.id === userId)) {
      this.broadcast({ type: "players", players: this.players() });
    }
  }
  async onMessage(ws, player, raw) {
    if (!this.sockets.has(ws)) return;
    if (typeof raw !== "string" || encoder.encode(raw).byteLength > MAX_MESSAGE_BYTES) {
      this.send(ws, { type: "error", error: "message_too_large_or_invalid" });
      return;
    }
    let message;
    try { message = JSON.parse(raw); } catch (_) {
      this.send(ws, { type: "error", error: "invalid_json" });
      return;
    }
    if (!message || typeof message.type !== "string") {
      this.send(ws, { type: "error", error: "invalid_message" });
      return;
    }
    if (message.type === "ping") {
      this.send(ws, { type: "pong", at: Date.now() });
      return;
    }
    if (message.type === "leave") {
      try { ws.close(1000, "left"); } catch (_) {}
      return;
    }
    if (message.type === "get-state") {
      this.send(ws, { type: "state-result", requestId: String(message.requestId || ""), result: this.data });
      return;
    }
    if (message.type === "state-update") {
      const expected = message.expectedUpdatedAt || null;
      if (expected && expected !== this.data.updatedAt) {
        this.send(ws, { type: "state-result", requestId: String(message.requestId || ""), result: { ...this.data, conflict: true } });
        return;
      }
      this.data = { state: message.state, updatedAt: Date.now() };
      await this.save();
      const result = { ...this.data, conflict: false };
      this.send(ws, { type: "state-result", requestId: String(message.requestId || ""), result });
      this.broadcast({ type: "state", state: this.data.state, updatedAt: this.data.updatedAt, from: player.id }, player.id);
      return;
    }
    if (message.type === "message") {
      const eventType = String(message.messageType || "data");
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(eventType)) {
        this.send(ws, { type: "error", error: "invalid_event_type" });
        return;
      }
      const item = {
        id: crypto.randomUUID(),
        from: player.id,
        type: eventType,
        data: message.data === undefined ? null : message.data,
        at: Date.now(),
      };
      this.broadcast({ type: "message", message: item }, player.id);
      return;
    }
    this.send(ws, { type: "error", error: "unsupported_type" });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json({ ok: true, service: "kuro-online-room", transport: "cloudflare-durable-objects", auth: "ticket+supabase-membership" });
    }
    if (url.pathname === "/ticket") return createTicket(request, env);
    const match = url.pathname.match(/^\/room\/([A-Za-z0-9_-]{1,128})$/);
    if (match) {
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "websocket_required" }, 426);
      const roomId = match[1];
      const claims = await verifyTicket(url.searchParams.get("ticket"), env.TICKET_SECRET || "");
      if (!claims || claims.room !== roomId) return json({ error: "invalid_or_expired_ticket" }, 401);
      const headers = new Headers(request.headers);
      headers.delete("authorization");
      headers.delete("cookie");
      headers.set("x-kuro-user-id", claims.sub);
      headers.set("x-kuro-user-name", claims.name || "プレイヤー");
      headers.set("x-kuro-game-id", claims.game);
      const forwarded = new Request(request, { headers });
      const roomKey = claims.game + ":" + roomId;
      return env.ROOMS.get(env.ROOMS.idFromName(roomKey)).fetch(forwarded);
    }
    return json({ error: "not_found" }, 404);
  },
};
