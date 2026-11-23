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
const DEFAULT_FEATURES = { ranking: false, cloudSave: false, multiplayer: false, rankingShowcase: false };
const KNOWN_RANKING_MODES: Record<string, string[]> = {
  "2dbd6773-2684-4f00-973e-c46acbc348e7": ["normal", "vanish", "gobble", "reverse"],
  "2eb37847-1b7e-43e4-ad98-901d5b830ac4": ["wins-bot", "wins-online"],
  "903a4c45-37bb-4a4b-a259-a5a8245de998": ["werewolf_villager_wins", "werewolf_wolf_wins"],
};
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

function sanitizeRankingShowcaseConfig(value: unknown) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rawModes = source.modes && typeof source.modes === "object" && !Array.isArray(source.modes)
    ? source.modes as Record<string, unknown>
    : {};
  const modes: Record<string, { enabled: boolean; label: string; scoreSuffix: string | null; order: number }> = {};
  for (const [mode, rawSetting] of Object.entries(rawModes).slice(0, 80)) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(mode) || !rawSetting || typeof rawSetting !== "object" || Array.isArray(rawSetting)) continue;
    const setting = rawSetting as Record<string, unknown>;
    const label = typeof setting.label === "string" ? setting.label.trim().slice(0, 64) : "";
    const scoreSuffix = typeof setting.scoreSuffix === "string" ? setting.scoreSuffix.trim().slice(0, 10) : null;
    const orderValue = Number(setting.order);
    const order = Number.isFinite(orderValue) ? Math.max(0, Math.min(79, Math.floor(orderValue))) : 79;
    modes[mode] = { enabled: setting.enabled !== false, label, scoreSuffix, order };
  }
  return { modes };
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
  if (!token || token.length > 8192 || token.split(".").length !== 3) {
    throw new HttpError(401, "この機能にはKUROアカウントでのログインが必要です。");
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) {
    throw new HttpError(401, "ログイン状態を確認できません。KUROアカウントで再ログインしてください。");
  }
  return data.user;
}
async async function getOptionalUser(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.match(/^Bearer\\s+(.+)$/i)?.[1];
  // Cloudflare relayはゲスト時にpublishable keyをBearerとして補うため、
  // JWT形式でない値は未ログインとして扱う。
  if (!token || token.length > 8192 || token.split(".").length !== 3) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) return null;
  return data.user;
}

function getGame(gameId: unknown) {
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


function safeRoomCode(value: unknown) {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new HttpError(400, "ルームコードは6文字で指定してください。");
  return code;
}

function requireMultiplayer(features: Record<string, unknown>) {
  requireFeature(features, "multiplayer");
}

async function getRoomMembers(roomId: string) {
  const { data: members, error } = await admin
    .from("game_online_room_members")
    .select("user_id, joined_at, last_seen_at")
    .eq("room_id", roomId)
    .gte("last_seen_at", new Date(Date.now() - 90000).toISOString())
    .order("joined_at", { ascending: true });
  if (error) throw new HttpError(500, "参加者一覧を取得できませんでした。");
  const ids = (members ?? []).map((m) => m.user_id);
  let profiles = new Map<string, { kuro_id: string; username: string; display_name: string; avatar_url: string | null }>();
  if (ids.length) {
    const { data, error: profileError } = await admin.from("profiles")
      .select("id, kuro_id, username, display_name, avatar_url")
      .in("id", ids);
    if (profileError) throw new HttpError(500, "参加者プロフィールを取得できませんでした。");
    profiles = new Map((data ?? []).map((p) => [p.id, {
      kuro_id: p.kuro_id ?? "",
      username: p.username ?? "",
      display_name: p.display_name ?? "",
      avatar_url: p.avatar_url ?? null,
    }]));
  }
  return (members ?? []).map((m) => {
    const hasProfile = profiles.has(m.user_id);
    const guestSuffix = String(m.user_id).replace(/-/g, "").slice(0, 4).toUpperCase();
    // Legacy guest room rows are retained until their rooms expire; they cannot authenticate or rejoin.
    const profile = profiles.get(m.user_id) ?? { kuro_id: "", username: "旧ゲスト-" + guestSuffix, display_name: "旧ゲスト-" + guestSuffix, avatar_url: null };
    return {
      userId: m.user_id,
      joinedAt: m.joined_at,
      user: {
        kuroId: profile.kuro_id || null,
        username: profile.username,
        display_name: profile.display_name || profile.username,
        avatar_url: profile.avatar_url,
        isGuest: !hasProfile,
      },
    };
  });
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

  if (action === "profile_me") {
    const user = await getUser(req);
    requirePublished(game);
    const { data: profile, error } = await admin
      .from("profiles")
      .select("kuro_id, username, avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    if (error) throw new HttpError(500, "KUROプロフィールを取得できませんでした。");
    if (!profile) throw new HttpError(404, "KUROプロフィールが見つかりません。再ログインしてください。");
    return reply(200, {
      profile: {
        kuroId: profile.kuro_id,
        username: profile.username,
        displayName: profile.username,
        avatarUrl: profile.avatar_url,
      },
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
    for (const key of ["ranking", "cloudSave", "multiplayer", "rankingShowcase"]) {
      if (typeof incoming[key] === "boolean") {
        if (key === "rankingShowcase" && incoming[key] === true) {
          if (game.status !== "published") {
            throw new HttpError(400, "ゲームを公開してからランキング欄への掲載を選択してください。");
          }
          if (next.ranking !== true) {
            throw new HttpError(400, "先にランキング機能を有効にしてください。");
          }
        }
        next[key] = incoming[key];
        changed = true;
      }
    }
    // Ranking showcase is only meaningful while score ranking itself is enabled.
    if (incoming.ranking === false && next.rankingShowcase === true) {
      next.rankingShowcase = false;
      changed = true;
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

  if (action === "ranking_showcase_config_update") {
    await requireOwner(req, game);
    requirePublished(game);
    requireFeature(settings.features, "ranking");
    const showcaseConfig = sanitizeRankingShowcaseConfig(body.config);
    const nextFeatures = { ...settings.features, rankingShowcaseConfig: showcaseConfig };
    const updatedAt = new Date().toISOString();
    const { error } = await admin.from("game_online_settings").upsert({
      game_id: game.id,
      features: nextFeatures,
      updated_at: updatedAt,
    }, { onConflict: "game_id" });
    if (error) throw new HttpError(500, "ランキング表示設定を保存できませんでした。");
    return reply(200, { ok: true, showcaseConfig, updatedAt });
  }

  if (action === "leaderboard_modes") {
    requirePublished(game);
    requireFeature(settings.features, "ranking");
    const { data: rows, error } = await admin
      .from("game_scores")
      .select("mode")
      .eq("game_id", game.id)
      .limit(1000);
    if (error) throw new HttpError(500, "ランキングモードを取得できませんでした。");
    const modes = Array.from(new Set([...(KNOWN_RANKING_MODES[game.id] ?? []), ...(rows ?? []).map((row) => row.mode).filter((mode) => typeof mode === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(mode))])).sort();
    return reply(200, {
      modes: modes.length ? modes : ["default"],
      showcaseConfig: sanitizeRankingShowcaseConfig(settings.features.rankingShowcaseConfig),
    });
  }

  if (action === "leaderboard") {
    // Public read-only rankings; score submission remains authenticated.
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
    let profileMap = new Map<string, { kuro_id: string; username: string; avatar_url: string | null }>();
    if (userIds.length) {
      const { data: profiles, error: profileError } = await admin
        .from("profiles")
        .select("id, kuro_id, username, avatar_url")
        .in("id", userIds);
      if (profileError) throw new HttpError(500, "ランキング参加者のプロフィールを取得できませんでした。");
      profileMap = new Map((profiles ?? []).map((profile) => [profile.id, {
        kuro_id: profile.kuro_id ?? "",
        username: profile.username ?? "",
        avatar_url: profile.avatar_url ?? null,
      }]));
    }

    return reply(200, {
      mode,
      scores: (scores ?? []).map((row, index) => {
        const profile = profileMap.get(row.user_id) ?? { kuro_id: "", username: "プレイヤー", avatar_url: null };
        return {
          rank: index + 1,
          score: row.score,
          mode: row.mode,
          createdAt: row.created_at,
          user: {
            kuroId: profile.kuro_id || null,
            username: profile.username,
            display_name: profile.username,
            avatar_url: profile.avatar_url,
          },
        };
      }),
    });
  }

  if (action === "tictactoe_leaderboard") {
    requirePublished(game);
    requireFeature(settings.features, "ranking");
    if (game.id !== "2dbd6773-2684-4f00-973e-c46acbc348e7") {
      throw new HttpError(404, "〇✕ゲームのランキングではありません。");
    }

    const rule = typeof body.rule === "string" ? body.rule.trim() : "normal";
    if (!["normal", "vanish", "gobble", "reverse"].includes(rule)) {
      throw new HttpError(400, "ランキングルールが正しくありません。");
    }
    const metric = typeof body.metric === "string" ? body.metric : "wins";
    if (!["wins", "win_rate", "current_streak", "best_streak"].includes(metric)) {
      throw new HttpError(400, "ランキング項目が正しくありません。");
    }

    const PAGE_SIZE = 1000;
    const statsRows: Array<{
      user_id: string;
      played: number | string;
      wins: number | string;
      losses: number | string;
      draws: number | string;
      current_streak: number | string;
      best_streak: number | string;
      updated_at: string;
    }> = [];
    for (let offset = 0; offset < 50000; offset += PAGE_SIZE) {
      const { data, error } = await admin.from("game_tictactoe_stats")
        .select("user_id, played, wins, losses, draws, current_streak, best_streak, updated_at")
        .eq("game_id", game.id)
        .eq("rule", rule)
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new HttpError(500, "〇✕ゲームのランキングを取得できませんでした。");
      const page = (data ?? []) as typeof statsRows;
      statsRows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }

    const entries = statsRows.map(row => {
      const played = Number(row.played) || 0;
      const wins = Number(row.wins) || 0;
      const losses = Number(row.losses) || 0;
      const draws = Number(row.draws) || 0;
      const currentStreak = Number(row.current_streak) || 0;
      const bestStreak = Number(row.best_streak) || 0;
      const score = metric === "win_rate"
        ? (played ? Math.round((wins / played) * 1000) / 10 : 0)
        : metric === "current_streak" ? currentStreak
        : metric === "best_streak" ? bestStreak
        : wins;
      return {
        userId: row.user_id, played, wins, losses, draws,
        currentStreak, bestStreak, updatedAt: row.updated_at, score
      };
    });

    // 勝率ランキングは10試合以上のプレイヤーだけを対象にする。
    const ranked = entries
      .filter(entry => metric !== "win_rate" || entry.played >= 10)
      .sort((a, b) =>
        b.score - a.score ||
        b.wins - a.wins ||
        b.played - a.played ||
        String(a.updatedAt).localeCompare(String(b.updatedAt))
      );

    const viewer = await getOptionalUser(req);
    const mine = viewer ? entries.find(entry => entry.userId === viewer.id) : null;
    const visible = ranked.slice(0, 100);
    const profileIds = Array.from(new Set([
      ...visible.map(entry => entry.userId),
      ...(viewer ? [viewer.id] : [])
    ]));
    const profileMap = new Map<string, { username: string; display_name: string }>();
    if (profileIds.length) {
      const { data: profiles, error } = await admin.from("profiles")
        .select("id, username, display_name")
        .in("id", profileIds);
      if (error) throw new HttpError(500, "ランキングのプレイヤー名を取得できませんでした。");
      for (const profile of profiles ?? []) {
        profileMap.set(profile.id, {
          username: profile.username || "プレイヤー",
          display_name: profile.display_name || profile.username || "プレイヤー"
        });
      }
    }

    const rows = visible.map((entry, index) => {
      const profile = profileMap.get(entry.userId);
      const name = profile?.display_name || profile?.username || "プレイヤー";
      return {
        rank: index + 1,
        score: entry.score,
        user: { username: profile?.username || name, display_name: name, name }
      };
    });

    let me: Record<string, unknown> | null = null;
    if (viewer) {
      const qualified = metric !== "win_rate" || (mine?.played ?? 0) >= 10;
      const rankIndex = qualified ? ranked.findIndex(entry => entry.userId === viewer.id) : -1;
      me = {
        rank: rankIndex >= 0 ? rankIndex + 1 : null,
        qualified,
        played: mine?.played ?? 0,
        wins: mine?.wins ?? 0,
        losses: mine?.losses ?? 0,
        draws: mine?.draws ?? 0,
        currentStreak: mine?.currentStreak ?? 0,
        bestStreak: mine?.bestStreak ?? 0
      };
    }

    return reply(200, { rule, metric, rows, me });
  }

  if (action === "tictactoe_submit") {
    const user = await getUser(req);
    requirePublished(game);
    requireFeature(settings.features, "ranking");
    if (game.id !== "2dbd6773-2684-4f00-973e-c46acbc348e7") {
      throw new HttpError(404, "〇✕ゲームの記録先ではありません。");
    }

    const rule = typeof body.rule === "string" ? body.rule.trim() : "";
    if (!["normal", "vanish", "gobble", "reverse"].includes(rule)) {
      throw new HttpError(400, "対戦ルールが正しくありません。");
    }
    const result = typeof body.result === "string" ? body.result : "";
    if (!["win", "loss", "draw"].includes(result)) {
      throw new HttpError(400, "対戦結果が正しくありません。");
    }
    if (typeof body.submissionId !== "string" || !UUID_RE.test(body.submissionId)) {
      throw new HttpError(400, "対戦記録IDが正しくありません。");
    }

    let cpuDifficulty: string | null = null;
    if (body.cpuDifficulty !== undefined && body.cpuDifficulty !== null && body.cpuDifficulty !== "") {
      if (typeof body.cpuDifficulty !== "string") {
        throw new HttpError(400, "CPU難易度が正しくありません。");
      }
      cpuDifficulty = body.cpuDifficulty.trim().toUpperCase();
      if (!["EASY", "NORMAL", "HARD", "EXPERT"].includes(cpuDifficulty)) {
        throw new HttpError(400, "CPU難易度が正しくありません。");
      }
    }

    const { data, error } = await admin.rpc("kuro_record_tictactoe_result", {
      p_game_id: game.id,
      p_user_id: user.id,
      p_rule: rule,
      p_result: result,
      p_submission_id: body.submissionId,
      p_cpu_difficulty: cpuDifficulty
    });
    if (error) {
      console.error("[kurogames-online] TicTacToe result RPC failed", error);
      throw new HttpError(500, "〇✕ゲームの対戦結果を保存できませんでした。");
    }
    const saved = Array.isArray(data) ? data[0] : data;
    if (!saved) throw new HttpError(500, "対戦結果の保存状態を取得できませんでした。");
    return reply(200, {
      ok: true,
      recorded: saved.recorded === true,
      played: Number(saved.played) || 0,
      wins: Number(saved.wins) || 0,
      losses: Number(saved.losses) || 0,
      draws: Number(saved.draws) || 0,
      currentStreak: Number(saved.current_streak) || 0,
      bestStreak: Number(saved.best_streak) || 0
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
    if (game.id === "2eb37847-1b7e-43e4-ad98-901d5b830ac4" && mode === "wins-online") {
      throw new HttpError(403, "オンライン勝利数は対局サーバーが登録します。");
    }
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
    // Use the database's atomic accumulator. game_scores is unique per
    // (game_id, user_id, mode), so a plain INSERT rejects every later win.
    // The RPC deduplicates submission IDs and increments the cumulative win count.
    const { data: submittedRows, error } = await admin.rpc("kuro_submit_game_score", {
      p_game_id: game.id,
      p_user_id: user.id,
      p_mode: mode,
      p_score: score,
      p_submission_id: submissionId,
      p_metadata: metadata,
    });
    if (error) {
      console.error("[kurogames-online] score_submit RPC failed", error);
      throw new HttpError(500, "スコアを登録できませんでした。");
    }
    const submitted = Array.isArray(submittedRows) ? submittedRows[0] : submittedRows;
    if (!submitted) throw new HttpError(500, "スコア登録結果を取得できませんでした。");
    return reply(200, {
      ok: true,
      score: Number(submitted.score) || 0,
      mode: submitted.score_mode || mode,
      createdAt: submitted.created_at,
      improved: submitted.improved !== false,
    });
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





  if (
    action === "sevens_matchmaking_join" || action === "sevens_matchmaking_status" ||
    action === "sevens_matchmaking_cancel" || action === "sevens_matchmaking_ack"
  ) {
    const user = await getUser(req);
    requirePublished(game);
    requireMultiplayer(settings.features);

    if (action === "sevens_matchmaking_join" || action === "sevens_matchmaking_status") {
      const rpcName = action === "sevens_matchmaking_join"
        ? "kuro_sevens_matchmaking_join" : "kuro_sevens_matchmaking_status";
      const { data, error } = await admin.rpc(rpcName, {
        p_game_id: game.id,
        p_user_id: user.id,
      });
      if (error || !data) {
        const message = error?.message || "";
        if (message.includes("SEVENS_USER_ALREADY_IN_ROOM")) {
          throw new HttpError(409, "すでに別のオンラインルームに参加しています。先に退出してください。");
        }
        console.error("[kurogames-online] Sevens matchmaking RPC failed", error);
        throw new HttpError(500, "七並べのマッチング状態を取得できませんでした。");
      }
      if (data.status !== "matched" || typeof data.room_id !== "string") {
        return reply(200, { status: data.status === "cancelled" ? "cancelled" : "waiting" });
      }
      const { data: room, error: roomError } = await admin.from("game_online_rooms")
        .select("id, game_id, room_code, host_user_id, max_players, player_count, status, created_at, game_data")
        .eq("id", data.room_id).eq("game_id", game.id).maybeSingle();
      if (roomError || !room || room.status !== "waiting") {
        await admin.rpc("kuro_sevens_matchmaking_cancel", { p_game_id: game.id, p_user_id: user.id });
        return reply(200, { status: "cancelled" });
      }
      const { data: touchedMember, error: touchError } = await admin.from("game_online_room_members")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("room_id", room.id).eq("user_id", user.id)
        .select("user_id").maybeSingle();
      if (touchError) throw new HttpError(500, "七並べのルーム接続を更新できませんでした。");
      if (!touchedMember) return reply(200, { status: "cancelled" });
      const members = await getRoomMembers(String(room.id));
      if (members.length < 2 || members.length > 4 || members.length !== Number(room.player_count)) {
        return reply(200, { status: "waiting" });
      }
      return reply(200, { status: "matched", room, members });
    }

    if (action === "sevens_matchmaking_cancel") {
      const { data, error } = await admin.rpc("kuro_sevens_matchmaking_cancel", {
        p_game_id: game.id, p_user_id: user.id,
      });
      if (error) throw new HttpError(500, "七並べのマッチングをキャンセルできませんでした。");
      return reply(200, { ok: true, cancelled: data === true });
    }

    const roomId = typeof body.roomId === "string" && UUID_RE.test(body.roomId) ? body.roomId : "";
    if (!roomId) throw new HttpError(400, "roomIdが正しくありません。");
    const { data, error } = await admin.rpc("kuro_sevens_matchmaking_ack", {
      p_game_id: game.id, p_user_id: user.id, p_room_id: roomId,
    });
    if (error) throw new HttpError(500, "七並べのマッチング完了を確定できませんでした。");
    return reply(200, { ok: true, acknowledged: data === true });
  }

  if (action === "sevens_room_vote") {
    if (game.slug !== "kuro-game-mwslp23x") throw new HttpError(404, "このゲームでは使用できない操作です。");
    const user = await getUser(req);
    requirePublished(game);
    requireMultiplayer(settings.features);
    const roomId = typeof body.roomId === "string" && UUID_RE.test(body.roomId) ? body.roomId : "";
    const vote = body.vote === "ready" || body.vote === "start" ? body.vote : "";
    if (!roomId) throw new HttpError(400, "roomIdが正しくありません。");
    if (!vote) throw new HttpError(400, "投票内容が正しくありません。");
    const { data, error } = await admin.rpc("kuro_sevens_room_vote", {
      p_game_id: game.id, p_room_id: roomId, p_user_id: user.id, p_vote: vote,
    });
    if (error || !data) {
      const message = error?.message || "";
      if (message.includes("SEVENS_READY_REQUIRED")) throw new HttpError(409, "先に「準備OK」を押してください。");
      if (message.includes("SEVENS_REQUIRES_TWO_TO_FOUR_PLAYERS")) throw new HttpError(409, "2〜4人で参加してから開始してください。");
      if (message.includes("ROOM_MEMBERSHIP_REQUIRED")) throw new HttpError(403, "このルームの参加者ではありません。");
      if (message.includes("ROOM_NOT_FOUND")) throw new HttpError(404, "ルームが見つかりません。");
      if (message.includes("SEVENS_INVALID_VOTE")) throw new HttpError(400, "投票内容が正しくありません。");
      console.error("[kurogames-online] Sevens room vote failed", error);
      throw new HttpError(500, "準備・開始状態を保存できませんでした。");
    }
    return reply(200, data);
  }

  if (
    action === "sevens_game_start" || action === "sevens_game_state" ||
    action === "sevens_game_action"
  ) {
    const user = await getUser(req);
    requirePublished(game);
    requireMultiplayer(settings.features);
    const roomId = typeof body.roomId === "string" && UUID_RE.test(body.roomId) ? body.roomId : "";
    if (!roomId) throw new HttpError(400, "roomIdが正しくありません。");

    const errorText = (error: { message?: string } | null) => {
      const message = error?.message || "";
      const rules: Array<[string, number, string]> = [
        ["ROOM_NOT_FOUND",404,"対戦ルームが見つかりません。"],
        ["ROOM_MEMBERSHIP_REQUIRED",403,"このルームの参加者ではありません。"],
        ["SEVENS_HOST_REQUIRED",403,"対戦を開始できるのはルームホストだけです。"],
        ["SEVENS_REQUIRES_FOUR_PLAYERS",409,"4人がそろってから対戦を開始してください。"],
        ["SEVENS_REQUIRES_TWO_TO_FOUR_PLAYERS",409,"2〜4人で参加してから開始してください。"],
        ["SEVENS_NOT_ALL_READY",409,"全員の準備OKと開始がそろっていません。"],
        ["SEVENS_GAME_NOT_STARTED",409,"対戦はまだ開始されていません。"],
        ["SEVENS_GAME_FINISHED",409,"この対戦は終了しています。"],
        ["SEVENS_NOT_YOUR_TURN",409,"今はあなたの手番ではありません。"],
        ["SEVENS_INVALID_ACTION",400,"操作内容が正しくありません。"],
        ["SEVENS_INVALID_CARD",400,"カードの指定が正しくありません。"],
        ["SEVENS_CARD_NOT_IN_HAND",409,"そのカードはあなたの手札にありません。"],
        ["SEVENS_CARD_ALREADY_PLAYED",409,"そのカードはすでに場に出ています。"],
        ["SEVENS_CARD_NOT_PLAYABLE",409,"そのカードは今は出せません。"],
        ["SEVENS_PASS_WHEN_PLAYABLE",409,"出せるカードがあるためパスできません。"],
      ];
      const match = rules.find(([code]) => message.includes(code));
      if (match) throw new HttpError(match[1],match[2]);
      console.error("[kurogames-online] Sevens RPC failed",error);
      throw new HttpError(500,"七並べの対局処理に失敗しました。");
    };

    if (action === "sevens_game_start" || action === "sevens_game_state") {
      const sinceVersion = Number(body.sinceVersion);
      const useDeltaSync = action === "sevens_game_state" &&
        Number.isSafeInteger(sinceVersion) && sinceVersion >= 0;
      const rpcName = action === "sevens_game_start"
        ? "kuro_sevens_game_start"
        : useDeltaSync ? "kuro_sevens_game_sync" : "kuro_sevens_game_state";
      const rpcArgs: Record<string, unknown> = {
        p_game_id: game.id, p_room_id: roomId, p_user_id: user.id,
      };
      if (useDeltaSync) rpcArgs.p_since_version = sinceVersion;
      const { data, error } = await admin.rpc(rpcName, rpcArgs);
      if (error || !data) errorText(error);
      return reply(200,data);
    }

    const gameAction = body.gameAction === "play" || body.gameAction === "pass" ? body.gameAction : "";
    if (!gameAction) throw new HttpError(400,"カード操作の指定が正しくありません。");
    const suit = gameAction === "play" ? Number(body.suit) : null;
    const rank = gameAction === "play" ? Number(body.rank) : null;
    const { data, error } = await admin.rpc("kuro_sevens_game_action", {
      p_game_id: game.id, p_room_id: roomId, p_user_id: user.id,
      p_action: gameAction, p_suit: suit, p_rank: rank,
    });
    if (error || !data) errorText(error);
    return reply(200,data);
  }

  if (action === "sevens_leaderboard") {
    const user = await getUser(req);
    requirePublished(game);

    // Count every completed online match. Paging by the unique result id
    // avoids the previous 10,000-row ceiling and keeps the ranking cumulative.
    const PAGE_SIZE = 1000;
    const aggregate = new Map<string, { userId: string; wins: number }>();
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data: results, error } = await admin.from("game_sevens_results")
        .select("id, user_id, placement")
        .eq("game_id", game.id)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new HttpError(500, "七並べランキングを取得できませんでした。");

      for (const row of results ?? []) {
        const current = aggregate.get(row.user_id) || { userId: row.user_id, wins: 0 };
        if (row.placement === 1) current.wins += 1;
        aggregate.set(row.user_id, current);
      }
      if (!results || results.length < PAGE_SIZE) break;
    }

    const entries = Array.from(aggregate.values());
    const ids = entries.map((entry) => entry.userId);
    let profiles = new Map<string, string>();
    if (ids.length) {
      const { data: profileRows, error: profileError } = await admin.from("profiles")
        .select("id, username, display_name").in("id", ids);
      if (profileError) throw new HttpError(500, "ランキングのプレイヤー名を取得できませんでした。");
      profiles = new Map((profileRows ?? []).map((p) => [p.id, p.display_name || p.username || "プレイヤー"]));
    }

    const rows = entries.map((entry) => ({
      name: profiles.get(entry.userId) || "プレイヤー",
      userId: entry.userId,
      wins: entry.wins,
    })).sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));

    return reply(200, { rows, myUserId: user.id, period: "all" });
  }

  if (action === "daifugo_start" || action === "daifugo_state" || action === "daifugo_action") {
    const user = await getUser(req);
    requirePublished(game);
    requireMultiplayer(settings.features);
    const roomId = typeof body.roomId === "string" && UUID_RE.test(body.roomId) ? body.roomId : "";
    if (!roomId) throw new HttpError(400, "roomIdが正しくありません。");

    const { data: member, error: memberError } = await admin.from("game_online_room_members")
      .select("user_id").eq("room_id", roomId).eq("user_id", user.id).maybeSingle();
    if (memberError) throw new HttpError(500, "対戦ルームの参加状態を確認できませんでした。");
    if (!member) throw new HttpError(403, "この対戦ルームの参加者ではありません。");

    const rpcError = (error: { message?: string } | null) => {
      const message = error?.message || "";
      const rules: Array<[string, number, string]> = [
        ["ROOM_NOT_FOUND",404,"対戦ルームが見つかりません。"],
        ["ROOM_MEMBERSHIP_REQUIRED",403,"対戦ルームの参加者ではありません。"],
        ["DAIFUGO_REQUIRES_TWO_PLAYERS",409,"大富豪のランダム対戦は2人で開始します。"],
        ["DAIFUGO_PLAYERS_NOT_READY",409,"2人の準備が完了してから開始できます。"],
        ["DAIFUGO_GAME_NOT_STARTED",409,"対局がまだ開始されていません。"],
        ["DAIFUGO_GAME_FINISHED",409,"この対局は終了しています。"],
        ["DAIFUGO_NOT_YOUR_TURN",409,"今はあなたの手番ではありません。"],
        ["DAIFUGO_CARD_NOT_IN_HAND",400,"そのカードは現在の手札にありません。"],
        ["DAIFUGO_DIAMOND_THREE_REQUIRED",400,"最初の手番では♦3を含めて出してください。"],
        ["DAIFUGO_INVALID_COMBINATION",400,"同じ数字のカードを組み合わせてください。"],
        ["DAIFUGO_WRONG_CARD_COUNT",400,"場と同じ枚数のカードを出してください。"],
        ["DAIFUGO_CARD_NOT_STRONG_ENOUGH",400,"場のカードより強い組み合わせを出してください。"],
        ["DAIFUGO_CANNOT_PASS_ON_EMPTY_TABLE",400,"場にカードがないときはパスできません。"],
        ["DAIFUGO_INVALID_CARD_COUNT",400,"出すカードの枚数が正しくありません。"],
        ["DAIFUGO_DUPLICATE_CARD",400,"同じカードが重複して指定されています。"],
        ["DAIFUGO_INVALID_ACTION",400,"操作内容が正しくありません。"]
      ];
      const match = rules.find(([code]) => message.includes(code));
      if (match) throw new HttpError(match[1],match[2]);
      console.error("[kurogames-online] Daifugo RPC failed",error);
      throw new HttpError(500,"大富豪の対局処理に失敗しました。");
    };

    if (action === "daifugo_start") {
      const { data: room, error: roomError } = await admin.from("game_online_rooms")
        .select("id, game_id, game_data, status")
        .eq("id",roomId).eq("game_id",game.id).maybeSingle();
      if (roomError || !room) throw new HttpError(404,"対戦ルームが見つかりません。");
      const players = await getRoomMembers(roomId);
      const { data, error } = await admin.rpc("kuro_daifugo_game_start",{
        p_game_id:game.id,
        p_room_id:roomId,
        p_user_id:user.id,
        p_rules:(body.rules && typeof body.rules==="object" && !Array.isArray(body.rules)) ? body.rules : {},
        p_players:players.map((p)=>({userId:p.userId,displayName:p.user.display_name || p.user.username || "プレイヤー"}))
      });
      if(error || !data) rpcError(error);
      return reply(200,data);
    }

    if (action === "daifugo_state") {
      const { data, error } = await admin.rpc("kuro_daifugo_game_state",{
        p_game_id:game.id,p_room_id:roomId,p_user_id:user.id
      });
      if(error || !data) rpcError(error);
      return reply(200,data);
    }

    const gameAction = body.gameAction === "play" || body.gameAction === "pass" ? body.gameAction : "";
    if(!gameAction) throw new HttpError(400,"カード操作の指定が正しくありません。");
    const rawIds = Array.isArray(body.cardIds) ? body.cardIds : [];
    if(rawIds.length>5 || rawIds.some((id)=>!Number.isSafeInteger(Number(id)) || Number(id)<0 || Number(id)>52)) {
      throw new HttpError(400,"カード指定が正しくありません。");
    }
    const { data, error } = await admin.rpc("kuro_daifugo_game_action",{
      p_game_id:game.id,
      p_room_id:roomId,
      p_user_id:user.id,
      p_action:gameAction,
      p_card_ids:rawIds.map(Number)
    });
    if(error || !data) rpcError(error);
    return reply(200,data);
  }

  if (
    action === "matchmaking_join" || action === "matchmaking_status" ||
    action === "matchmaking_cancel" || action === "matchmaking_ack" ||
    action === "unon_matchmaking_join" || action === "unon_matchmaking_status" ||
    action === "unon_matchmaking_cancel" || action === "unon_matchmaking_ack"
  ) {
    const user = await getUser(req);
    requirePublished(game);
    requireMultiplayer(settings.features);

    const isUnon = action.startsWith("unon_matchmaking_");
    const isJoin = action === "matchmaking_join" || action === "unon_matchmaking_join";
    const isStatus = action === "matchmaking_status" || action === "unon_matchmaking_status";
    const isCancel = action === "matchmaking_cancel" || action === "unon_matchmaking_cancel";
    const ruleMode = isUnon
      ? (body.ruleMode === "local" || body.ruleMode === "official" ? body.ruleMode : "")
      : "";
    if (isUnon && !ruleMode) throw new HttpError(400, "マッチングルールが正しくありません。");

    if (isJoin || isStatus) {
      const rpcName = isUnon
        ? (isJoin ? "kuro_unon_matchmaking_join" : "kuro_unon_matchmaking_status")
        : (isJoin ? "kuro_daifugo_matchmaking_join" : "kuro_daifugo_matchmaking_status");
      const rpcArgs: Record<string, unknown> = {
        p_game_id: game.id,
        p_user_id: user.id,
      };
      if (isUnon) rpcArgs.p_rule_mode = ruleMode;
      const { data, error } = await admin.rpc(rpcName, rpcArgs);
      if (error || !data) {
        if ((error?.message || "").includes("MATCH_USER_ALREADY_IN_ROOM")) {
          throw new HttpError(409, "すでにオンラインルームに参加しています。先に退出してください。");
        }
        if ((error?.message || "").includes("INVALID_MATCH_RULE")) {
          throw new HttpError(400, "マッチングルールが正しくありません。");
        }
        console.error("[kurogames-online] matchmaking RPC failed", error);
        throw new HttpError(500, "ランダムマッチの状態を取得できませんでした。");
      }
      if (data.status !== "matched" || typeof data.room_id !== "string") {
        return reply(200, { status: data.status === "cancelled" ? "cancelled" : "waiting" });
      }
      const { data: room, error: roomError } = await admin.from("game_online_rooms")
        .select("id, game_id, room_code, host_user_id, max_players, player_count, status, created_at, game_data")
        .eq("id", data.room_id).eq("game_id", game.id).maybeSingle();
      const roomData = room?.game_data && typeof room.game_data === "object"
        ? room.game_data as Record<string, unknown>
        : {};
      if (roomError || !room || room.status !== "waiting" ||
          (isUnon && roomData.ruleMode !== ruleMode)) {
        await admin.rpc("kuro_daifugo_matchmaking_cancel", { p_game_id: game.id, p_user_id: user.id });
        return reply(200, { status: "cancelled" });
      }
      const members = await getRoomMembers(String(room.id));
      if (members.length !== 2) {
        await admin.rpc("kuro_daifugo_matchmaking_cancel", { p_game_id: game.id, p_user_id: user.id });
        return reply(200, { status: "cancelled" });
      }
      return reply(200, { status: "matched", room, members });
    }

    if (isCancel) {
      const { data, error } = await admin.rpc("kuro_daifugo_matchmaking_cancel", {
        p_game_id: game.id,
        p_user_id: user.id,
      });
      if (error) throw new HttpError(500, "マッチングをキャンセルできませんでした。");
      return reply(200, { ok: true, cancelled: data === true });
    }

    const roomId = typeof body.roomId === "string" && UUID_RE.test(body.roomId) ? body.roomId : "";
    if (!roomId) throw new HttpError(400, "roomIdが正しくありません。");
    const { data, error } = await admin.rpc("kuro_daifugo_matchmaking_ack", {
      p_game_id: game.id,
      p_user_id: user.id,
      p_room_id: roomId,
    });
    if (error) throw new HttpError(500, "マッチング完了を確定できませんでした。");
    return reply(200, { ok: true, acknowledged: data === true });
  }

  if (action === "room_list" || action === "room_create" || action === "room_join" || action === "room_leave" || action === "room_heartbeat" || action === "room_send" || action === "room_poll" || action === "room_state_get" || action === "room_state_update") {
    const user = await getUser(req);
    requirePublished(game);
    requireMultiplayer(settings.features);

    if (action === "room_list") {
      const { data, error } = await admin.from("game_online_rooms")
        .select("id, room_code, player_count, max_players, created_at")
        .eq("game_id", game.id)
        .eq("status", "waiting")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new HttpError(500, "ルーム一覧を取得できませんでした。");
      return reply(200, { rooms: data ?? [] });
    }

    if (action === "room_create") {
      const maxPlayers = Math.max(2, Math.min(35, Math.floor(Number(body.maxPlayers) || 4)));
      let room: Record<string, unknown> | null = null;
      for (let attempt = 0; attempt < 6 && !room; attempt++) {
        const bytes = crypto.getRandomValues(new Uint8Array(6));
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const code = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
        const { data, error } = await admin.from("game_online_rooms").insert({
          game_id: game.id,
          room_code: code,
          host_user_id: user.id,
          max_players: maxPlayers,
          player_count: 1,
        }).select("id, game_id, room_code, host_user_id, max_players, player_count, status, created_at").single();
        if (!error) room = data;
        else if (error.code !== "23505") throw new HttpError(500, "ルームを作成できませんでした。");
      }
      if (!room) throw new HttpError(503, "ルームコードを発行できませんでした。もう一度お試しください。");
      const { error: memberError } = await admin.from("game_online_room_members").insert({
        room_id: room.id,
        user_id: user.id,
      });
      if (memberError) {
        await admin.from("game_online_rooms").delete().eq("id", room.id);
        throw new HttpError(500, "ルーム参加者を登録できませんでした。");
      }
      return reply(200, { room, members: await getRoomMembers(String(room.id)) });
    }

    if (action === "room_join") {
      const code = safeRoomCode(body.roomCode);
      const { data, error } = await admin.rpc("kuro_join_online_room", {
        p_game_id: game.id,
        p_room_code: code,
        p_user_id: user.id,
      });
      if (error) {
        if ((error.message || "").includes("ROOM_FULL")) throw new HttpError(409, "このルームは満員です。");
        if ((error.message || "").includes("ROOM_NOT_FOUND")) throw new HttpError(404, "ルームが見つからないか、参加を締め切っています。");
        throw new HttpError(500, "ルームに参加できませんでした。");
      }
      const room = Array.isArray(data) ? data[0] : data;
      return reply(200, { room, members: await getRoomMembers(String(room.id)) });
    }

    const roomId = typeof body.roomId === "string" && UUID_RE.test(body.roomId) ? body.roomId : "";
    if (!roomId) throw new HttpError(400, "roomIdが正しくありません。");

    if (action === "room_state_get" || action === "room_state_update") {
      const { data: member, error: memberError } = await admin.from("game_online_room_members")
        .select("user_id").eq("room_id", roomId).eq("user_id", user.id).maybeSingle();
      if (memberError) throw new HttpError(500, "ルーム参加状態を確認できませんでした。");
      if (!member) throw new HttpError(403, "このルームの参加者ではありません。");

      if (action === "room_state_get") {
        const { data: room, error } = await admin.from("game_online_rooms")
          .select("id, game_data, game_data_updated_at, status")
          .eq("id", roomId).eq("game_id", game.id).maybeSingle();
        if (error || !room) throw new HttpError(404, "ルームが見つかりません。");
        return reply(200, {
          state: room.game_data ?? null,
          updatedAt: room.game_data_updated_at ?? null,
          roomStatus: room.status,
        });
      }

      if (!Object.prototype.hasOwnProperty.call(body, "state") ||
          !body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
        throw new HttpError(400, "保存するゲーム状態が正しくありません。");
      }
      const bytes = new TextEncoder().encode(JSON.stringify(body.state)).length;
      if (bytes > 131072) throw new HttpError(413, "ルームのゲーム状態は128KB以内にしてください。");
      if (body.hostOnly === true) {
        const { data: owner, error: ownerError } = await admin.from("game_online_rooms")
          .select("host_user_id").eq("id", roomId).eq("game_id", game.id).maybeSingle();
        if (ownerError) throw new HttpError(500, "ルームホストを確認できませんでした。");
        if (!owner || owner.host_user_id !== user.id) {
          throw new HttpError(403, "ゲーム状態を更新できるのはルームホストだけです。");
        }
      }
      const expected = typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : null;
      const updatedAt = new Date().toISOString();
      let update = admin.from("game_online_rooms")
        .update({ game_data: body.state, game_data_updated_at: updatedAt })
        .eq("id", roomId).eq("game_id", game.id);
      update = expected ? update.eq("game_data_updated_at", expected) : update.is("game_data_updated_at", null);
      const { data: updated, error } = await update.select("game_data_updated_at").maybeSingle();
      if (error) throw new HttpError(500, "ゲーム状態を保存できませんでした。");
      if (!updated) return reply(200, { ok: false, conflict: true });
      return reply(200, { ok: true, conflict: false, updatedAt: updated.game_data_updated_at });
    }

    if (action === "room_send") {
      const type = typeof body.eventType === "string" ? body.eventType : "";
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(type)) throw new HttpError(400, "イベント名が正しくありません。");
      const payload = Object.prototype.hasOwnProperty.call(body, "payload") ? body.payload : {};
      if (new TextEncoder().encode(JSON.stringify(payload)).length > 32768) {
        throw new HttpError(413, "1回の通信データは32KB以内にしてください。");
      }
      const { data: member, error: memberError } = await admin.from("game_online_room_members")
        .select("user_id").eq("room_id", roomId).eq("user_id", user.id).maybeSingle();
      if (memberError) throw new HttpError(500, "ルーム参加状態を確認できませんでした。");
      if (!member) throw new HttpError(403, "このルームの参加者ではありません。");
      const { data: room, error: roomError } = await admin.from("game_online_rooms")
        .select("id, game_id, status").eq("id", roomId).eq("game_id", game.id).maybeSingle();
      if (roomError || !room) throw new HttpError(404, "ルームが見つかりません。");
      if (room.status === "closed") throw new HttpError(410, "このルームは終了しています。");
      const { data: inserted, error } = await admin.from("game_online_room_messages")
        .insert({ room_id: roomId, sender_user_id: user.id, event_type: type, payload })
        .select("id").single();
      if (error) throw new HttpError(500, "ゲームデータを送信できませんでした。");
      return reply(200, { ok: true, messageId: inserted.id });
    }

    if (action === "room_poll") {
      const hasCursor = body.afterId !== null && body.afterId !== undefined;
      let afterId = hasCursor && Number.isSafeInteger(Number(body.afterId)) && Number(body.afterId) >= 0
        ? Number(body.afterId) : 0;
      if (!hasCursor) {
        const { data: latest, error: latestError } = await admin.from("game_online_room_messages")
          .select("id").eq("room_id", roomId).order("id", { ascending: false }).limit(1).maybeSingle();
        if (latestError) throw new HttpError(500, "マルチプレイ通信位置を取得できませんでした。");
        afterId = latest ? Number(latest.id) : 0;
      }
      const { data: member, error: memberError } = await admin.from("game_online_room_members")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("room_id", roomId).eq("user_id", user.id)
        .select("user_id").maybeSingle();
      if (memberError) throw new HttpError(500, "ルーム接続を更新できませんでした。");
      if (!member) throw new HttpError(403, "このルームの参加者ではありません。");

      // Prune room members whose heartbeat stopped after a refresh or tab close.
      const staleBefore = new Date(Date.now() - 30000).toISOString();
      const { data: staleMembers, error: staleMembersError } = await admin.from("game_online_room_members")
        .select("user_id")
        .eq("room_id", roomId)
        .lt("last_seen_at", staleBefore);
      if (staleMembersError) throw new HttpError(500, "退出済みプレイヤーを整理できませんでした。");
      for (const staleMember of staleMembers ?? []) {
        const { error: staleLeaveError } = await admin.rpc("kuro_leave_online_room", {
          p_room_id: roomId,
          p_user_id: staleMember.user_id,
        });
        if (staleLeaveError) console.error("[kurogames-online] stale room member cleanup failed", staleLeaveError);
      }

      const { data: room, error: roomError } = await admin.from("game_online_rooms")
        .select("id, game_id, host_user_id, status").eq("id", roomId).eq("game_id", game.id).maybeSingle();
      if (roomError || !room) throw new HttpError(404, "ルームが見つかりません。");
      const { data: messages, error } = await admin.from("game_online_room_messages")
        .select("id, sender_user_id, event_type, payload, created_at")
        .eq("room_id", roomId).gt("id", afterId)
        .order("id", { ascending: true }).limit(100);
      if (error) throw new HttpError(500, "マルチプレイ通信を受信できませんでした。");
      const members = await getRoomMembers(roomId);
      const { data: voteRows, error: voteError } = await admin.from("game_sevens_room_votes")
        .select("user_id, ready, start_vote")
        .eq("room_id", roomId);
      if (voteError) throw new HttpError(500, "準備状態を取得できませんでした。");
      const votes = (voteRows ?? []).map((v) => ({
        userId: v.user_id, ready: v.ready === true, start: v.start_vote === true,
      }));
      return reply(200, {
        messages: (messages ?? []).map((m) => ({
          id: m.id, from: m.sender_user_id, type: m.event_type,
          data: m.payload, sentAt: m.created_at,
        })),
        members,
        votes,
        roomStatus: room.status,
        hostUserId: room.host_user_id,
        cursor: afterId,
      });
    }
    if (!roomId) throw new HttpError(400, "roomIdが正しくありません。");
    if (action === "room_heartbeat") {
      const { data, error } = await admin.from("game_online_room_members")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("room_id", roomId)
        .eq("user_id", user.id)
        .select("user_id")
        .maybeSingle();
      if (error) throw new HttpError(500, "ルーム接続を更新できませんでした。");
      if (!data) throw new HttpError(403, "このルームの参加者ではありません。");
      return reply(200, { ok: true });
    }
    if (!roomId) throw new HttpError(400, "roomIdが正しくありません。");
    const { data: leaveResult, error: leaveError } = await admin.rpc("kuro_leave_online_room", {
      p_room_id: roomId,
      p_user_id: user.id,
    });
    if (leaveError) throw new HttpError(500, "ルームから退出できませんでした。");
    return reply(200, { ok: true, left: leaveResult === true });
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
