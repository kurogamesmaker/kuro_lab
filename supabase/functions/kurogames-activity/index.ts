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
const PRESENCE_TTL_SECONDS = 75;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function reply(status: number, data: Record<string, unknown>) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

function stringValue(value: unknown, max = 100) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function getOptionalUser(req: Request) {
  const token = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  if (!token || token.length > 8192 || token.split(".").length !== 3) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) return null;
  return data.user;
}

function gameIdFrom(value: unknown) {
  const gameId = stringValue(value, 50);
  if (!UUID_RE.test(gameId)) throw new HttpError(400, "有効なgameIdを指定してください。");
  return gameId;
}

function sessionIdFrom(value: unknown) {
  const sessionId = stringValue(value, 50);
  if (!UUID_RE.test(sessionId)) throw new HttpError(400, "プレイセッションIDが正しくありません。");
  return sessionId;
}

async function heartbeat(req: Request, body: Record<string, unknown>) {
  const gameId = gameIdFrom(body.gameId);
  const user = await getOptionalUser(req);
  const guestId = user ? null : sessionIdFrom(body.clientSessionId);

  const status = body.status === "waiting" ? "waiting" : "playing";
  const opponentType = ["human", "bot", "solo", "unknown"].includes(String(body.opponentType))
    ? String(body.opponentType)
    : "unknown";

  const { data: game, error: gameError } = await admin
    .from("game_studio_games")
    .select("id")
    .eq("id", gameId)
    .eq("status", "published")
    .maybeSingle();
  if (gameError) throw new HttpError(500, "ゲーム情報を確認できませんでした。");
  if (!game) throw new HttpError(404, "公開中のゲームが見つかりません。");

  // A registered user is counted once per game even when several tabs are open.
  // Guests receive a browser-local random identifier; no account data is exposed.
  const presenceKey = user
    ? "user:" + user.id + ":" + gameId
    : "guest:" + guestId + ":" + gameId;

  const { error } = await admin.from("game_activity_presence").upsert({
    presence_key: presenceKey,
    game_id: gameId,
    user_id: user?.id ?? null,
    guest_id: guestId,
    status,
    opponent_type: opponentType,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "presence_key" });
  if (error) throw new HttpError(500, "プレイ状況を更新できませんでした。");

  return reply(200, {
    ok: true,
    status,
    expiresInSeconds: PRESENCE_TTL_SECONDS,
  });
}

async function summary() {
  const cutoff = new Date(Date.now() - PRESENCE_TTL_SECONDS * 1000).toISOString();

  // Old heartbeats are removed during summary refresh; every active page sees only
  // records refreshed within the TTL, even if a browser closes without a leave call.
  const { error: cleanupError } = await admin
    .from("game_activity_presence")
    .delete()
    .lt("last_seen_at", cutoff);
  if (cleanupError) throw new HttpError(500, "古いプレイ状況を整理できませんでした。");

  const [{ data: gameRows, error: gamesError }, { data: presenceRows, error: presenceError }, { data: queueRows, error: queueError }] =
    await Promise.all([
      admin.from("game_studio_games")
        .select("id,title,category")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(100),
      admin.from("game_activity_presence")
        .select("game_id,user_id,guest_id,status,opponent_type,last_seen_at")
        .gte("last_seen_at", cutoff)
        .limit(10000),
      admin.from("game_online_matchmaking")
        .select("game_id,user_id,status,last_seen_at")
        .eq("status", "waiting")
        .gte("last_seen_at", cutoff)
        .limit(10000),
    ]);

  if (gamesError) throw new HttpError(500, "ゲーム一覧を取得できませんでした。");
  if (presenceError) throw new HttpError(500, "プレイ人数を取得できませんでした。");
  // Existing matchmaking rows supplement activity heartbeats for older game clients.
  // If the optional legacy queue table is unavailable, the new presence stream still works.
  if (queueError) console.warn("[kurogames-activity] legacy matchmaking counts unavailable", queueError);

  type Counts = {
    humans: Set<string>;
    playing: Set<string>;
    waiting: Set<string>;
    bots: Set<string>;
  };
  const counts = new Map<string, Counts>();
  const ensure = (gameId: string) => {
    let value = counts.get(gameId);
    if (!value) {
      value = { humans: new Set(), playing: new Set(), waiting: new Set(), bots: new Set() };
      counts.set(gameId, value);
    }
    return value;
  };

  const allHumans = new Set<string>();
  const allPlaying = new Set<string>();
  const allWaiting = new Set<string>();
  const allBots = new Set<string>();

  for (const row of presenceRows ?? []) {
    const identity = row.user_id ? "u:" + row.user_id : row.guest_id ? "g:" + row.guest_id : "";
    if (!identity) continue;
    const gameCounts = ensure(String(row.game_id));
    gameCounts.humans.add(identity);
    allHumans.add(identity);
    if (row.status === "waiting") {
      gameCounts.waiting.add(identity);
      allWaiting.add(identity);
    } else {
      gameCounts.playing.add(identity);
      allPlaying.add(identity);
      if (row.opponent_type === "bot") {
        gameCounts.bots.add(identity);
        allBots.add(identity);
      }
    }
  }

  const publishedIds = new Set((gameRows ?? []).map((game) => String(game.id)));
  for (const row of queueRows ?? []) {
    const gameId = String(row.game_id);
    const userId = String(row.user_id);
    if (!publishedIds.has(gameId) || !userId) continue;
    const identity = "u:" + userId;
    const gameCounts = ensure(gameId);
    // A user already counted as playing in this game is not also counted as waiting.
    if (!gameCounts.playing.has(identity)) {
      gameCounts.waiting.add(identity);
      allWaiting.add(identity);
    }
  }

  const games = (gameRows ?? []).map((game) => {
    const value = counts.get(String(game.id));
    return {
      id: game.id,
      title: game.title,
      category: game.category,
      humanPlayers: value?.humans.size ?? 0,
      playing: value?.playing.size ?? 0,
      waiting: value?.waiting.size ?? 0,
      botMatches: value?.bots.size ?? 0,
    };
  });

  return reply(200, {
    generatedAt: new Date().toISOString(),
    expiresInSeconds: PRESENCE_TTL_SECONDS,
    totals: {
      humanPlayers: allHumans.size,
      playing: allPlaying.size,
      waiting: allWaiting.size,
      botMatches: allBots.size,
    },
    games,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return reply(405, { error: "POSTで呼び出してください。" });

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid body");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return reply(400, { error: "JSON形式のリクエストを送信してください。" });
  }

  try {
    const action = stringValue(body.action, 40);
    if (action === "heartbeat") return await heartbeat(req, body);
    if (action === "summary") return await summary();
    return reply(400, { error: "未対応のactionです。" });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "予期しないエラーが発生しました。";
    if (status >= 500) console.error("[kurogames-activity]", error);
    return reply(status, { error: message });
  }
});
