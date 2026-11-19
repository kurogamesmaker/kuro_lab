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
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_FEATURES = { ranking: false, cloudSave: false };

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

function safeMode(value: unknown) {
  const mode = typeof value === "string" ? value.trim() : "default";
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(mode)) {
    throw new HttpError(400, "modeは英数字・_・-の40文字以内で指定してください。");
  }
  return mode;
}

function safeSaveKey(value: unknown) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key || key.length > 64) {
    throw new HttpError(400, "セーブキーは1〜64文字で指定してください。");
  }
  return key;
}

async function getUser(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpError(401, "この機能にはKUROアカウントでのログインが必要です。");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "ログイン状態を確認できません。再ログインしてください。");
  return data.user;
}

async function getGame(gameId: unknown) {
  if (typeof gameId !== "string" || !UUID_RE.test(gameId)) {
    throw new HttpError(400, "有効なgameIdを指定してください。");
  }
  const { data, error } = await admin
    .from("game_studio_games")
    .select("id, owner_id, title, slug, status")
    .eq("id", gameId)
    .maybeSingle();
  if (error) throw new HttpError(500, "ゲーム情報を取得できませんでした。");
  if (!data) throw new HttpError(404, "ゲームが見つかりません。");
  return data;
}

async function getFeatures(gameId: string) {
  const { data, error } = await admin
    .from("game_online_settings")
    .select("features, updated_at")
    .eq("game_id", gameId)
    .maybeSingle();
  if (error) throw new HttpError(500, "オンライン設定を取得できませんでした。");
  return {
    features: { ...DEFAULT_FEATURES, ...(data?.features ?? {}) },
    updatedAt: data?.updated_at ?? null,
  };
}

function requirePublished(game: { status: string }) {
  if (game.status !== "published") throw new HttpError(404, "このゲームは現在公開されていません。");
}

function requireFeature(features: Record<string, unknown>, name: string) {
  if (features[name] !== true) throw new HttpError(403, "このゲームでは該当するオンライン機能が有効になっていません。");
}

async function requireOwner(req: Request, game: { owner_id: string }) {
  const user = await getUser(req);
  if (user.id !== game.owner_id) throw new HttpError(403, "このゲームの設定を変更する権限がありません。");
  return user;
}

async function handle(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") throw new HttpError(405, "POSTで呼び出してください。");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "JSON形式のリクエストを送信してください。");
  }

  const action = body.action;
  const game = await getGame(body.gameId);
  const settings = await getFeatures(game.id);

  if (action === "get_config") {
    requirePublished(game);
    return reply(200, {
      game: { id: game.id, title: game.title, slug: game.slug },
      features: settings.features,
      updatedAt: settings.updatedAt,
    });
  }

  if (action === "settings_get") {
    await requireOwner(req, game);
    return reply(200, {
      game: { id: game.id, title: game.title, slug: game.slug, status: game.status },
      features: settings.features,
      updatedAt: settings.updatedAt,
    });
  }

  if (action === "settings_update") {
    await requireOwner(req, game);
    const incoming = (body.features && typeof body.features === "object" && !Array.isArray(body.features))
      ? body.features as Record<string, unknown>
      : {};
    const next = { ...settings.features };
    let changed = false;
    for (const key of ["ranking", "cloudSave"]) {
      if (typeof incoming[key] === "boolean") {
        next[key] = incoming[key];
        changed = true;
      }
    }
    if (!changed) throw new HttpError(400, "変更する機能を指定してください。");
    const updatedAt = new Date().toISOString();
    const { error } = await admin.from("game_online_settings").upsert({
      game_id: game.id,
      features: next,
      updated_at: updatedAt,
    }, { onConflict: "game_id" });
    if (error) throw new HttpError(500, "オンライン設定を保存できませんでした。");
    return reply(200, { ok: true, features: next, updatedAt });
  }

  if (action === "leaderboard") {
    requirePublished(game);
    requireFeature(settings.features, "ranking");
    const mode = safeMode(body.mode);
    const limit = Math.max(1, Math.min(100, Number.isFinite(Number(body.limit)) ? Math.floor(Number(body.limit)) : 20));
    const { data: scores, error } = await admin
      .from("game_scores")
      .select("id, user_id, score, mode, created_at")
      .eq("game_id", game.id)
      .eq("mode", mode)
      .order("score", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw new HttpError(500, "ランキングを取得できませんでした。");

    const userIds = Array.from(new Set((scores ?? []).map((row) => row.user_id)));
    let profileMap = new Map<string, { username: string; display_name: string; avatar_url: string | null }>();
    if (userIds.length) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .in("id", userIds);
      profileMap = new Map((profiles ?? []).map((profile) => [profile.id, {
        username: profile.username ?? "",
        display_name: profile.display_name ?? profile.username ?? "プレイヤー",
        avatar_url: profile.avatar_url ?? null,
      }]));
    }

    return reply(200, {
      mode,
      scores: (scores ?? []).map((row, index) => ({
        rank: index + 1,
        score: row.score,
        mode: row.mode,
        createdAt: row.created_at,
        user: profileMap.get(row.user_id) ?? { username: "", display_name: "プレイヤー", avatar_url: null },
      })),
    });
  }

  if (action === "score_submit") {
    const user = await getUser(req);
    requirePublished(game);
    requireFeature(settings.features, "ranking");
    const score = Number(body.score);
    if (!Number.isSafeInteger(score) || score < 0 || score > 1000000000) {
      throw new HttpError(400, "スコアは0〜1,000,000,000の整数で指定してください。");
    }
    const mode = safeMode(body.mode);
    const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : {};
    if (new TextEncoder().encode(JSON.stringify(metadata)).length > 8192) {
      throw new HttpError(400, "追加データは8KB以内にしてください。");
    }
    const { count, error: countError } = await admin
      .from("game_scores")
      .select("id", { count: "exact", head: true })
      .eq("game_id", game.id)
      .eq("user_id", user.id)
      .gte("created_at", new Date(Date.now() - 30000).toISOString());
    if (countError) throw new HttpError(500, "送信回数を確認できませんでした。");
    if ((count ?? 0) >= 10) throw new HttpError(429, "短時間のスコア送信回数が上限に達しました。");

    const submissionId = typeof body.submissionId === "string" && UUID_RE.test(body.submissionId)
      ? body.submissionId
      : crypto.randomUUID();
    const { data, error } = await admin.from("game_scores").insert({
      game_id: game.id,
      user_id: user.id,
      mode,
      score,
      submission_id: submissionId,
      metadata,
    }).select("id, score, mode, created_at").single();
    if (error) {
      if (error.code === "23505") throw new HttpError(409, "このスコア送信は既に登録されています。");
      throw new HttpError(500, "スコアを登録できませんでした。");
    }
    return reply(200, { ok: true, score: data.score, mode: data.mode, createdAt: data.created_at });
  }

  if (action === "save_get" || action === "save_set" || action === "save_delete") {
    const user = await getUser(req);
    requirePublished(game);
    requireFeature(settings.features, "cloudSave");
    const key = safeSaveKey(body.key);

    if (action === "save_get") {
      const { data, error } = await admin
        .from("game_saves")
        .select("payload, updated_at")
        .eq("game_id", game.id)
        .eq("user_id", user.id)
        .eq("save_key", key)
        .maybeSingle();
      if (error) throw new HttpError(500, "セーブデータを読み込めませんでした。");
      return reply(200, { value: data?.payload ?? null, updatedAt: data?.updated_at ?? null });
    }

    if (action === "save_delete") {
      const { error } = await admin
        .from("game_saves")
        .delete()
        .eq("game_id", game.id)
        .eq("user_id", user.id)
        .eq("save_key", key);
      if (error) throw new HttpError(500, "セーブデータを削除できませんでした。");
      return reply(200, { ok: true });
    }

    if (!Object.prototype.hasOwnProperty.call(body, "value")) {
      throw new HttpError(400, "保存するvalueを指定してください。");
    }
    const bytes = new TextEncoder().encode(JSON.stringify(body.value)).length;
    if (bytes > 65536) throw new HttpError(413, "1件のセーブデータは64KB以内にしてください。");
    const updatedAt = new Date().toISOString();
    const { error } = await admin.from("game_saves").upsert({
      game_id: game.id,
      user_id: user.id,
      save_key: key,
      payload: body.value,
      updated_at: updatedAt,
    }, { onConflict: "game_id,user_id,save_key" });
    if (error) throw new HttpError(500, "セーブデータを保存できませんでした。");
    return reply(200, { ok: true, updatedAt });
  }

  throw new HttpError(400, "未対応のactionです。");
}

Deno.serve(async (req: Request) => {
  try {
    return await handle(req);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "予期しないエラーが発生しました。";
    if (status >= 500) console.error("[kurogames-online]", error);
    return reply(status, { error: message });
  }
});
