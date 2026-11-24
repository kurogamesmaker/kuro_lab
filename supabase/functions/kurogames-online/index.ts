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
const UNON_GAME_ID = "faa155cb-2143-4361-9a96-dc759d334e46";
const ONLINE_ROOM_WORKER_URL = "https://kuro-online-room.kurogamesmaker.workers.dev";
const DEFAULT_FEATURES = { ranking: false, cloudSave: false, multiplayer: false, rankingShowcase: false };
const KNOWN_RANKING_MODES: Record<string, string[]> = {
  "faa155cb-2143-4361-9a96-dc759d334e46": ["wins-online", "wins-solo"],
  "2dbd6773-2684-4f00-973e-c46acbc348e7": ["normal", "vanish", "gobble", "reverse"],
  "2eb37847-1b7e-43e4-ad98-901d5b830ac4": ["wins-bot", "wins-online"],
  "903a4c45-37bb-4a4b-a259-a5a8245de998": ["werewolf_villager_wins", "werewolf_wolf_wins"],
  "79c9921a-d57a-45b1-8271-1ee7042801dc": ["easy", "normal", "hard"],
  "bb466662-5423-48e6-bbcc-d19da50ba818": ["number-time-easy", "number-time-normal", "number-time-hard", "number-time-expert", "number-time-master", "number-time-legend"],
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

async function verifyUnonWinProof(proof: string) {
  if (!proof || proof.length > 4096) return null;
  try {
    const response = await fetch(ONLINE_ROOM_WORKER_URL + "/verify-unon-win", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proof }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 240);
      console.warn("[kurogames-online] UNON win proof verifier rejected request", {
        status: response.status, detail,
      });
      return null;
    }
    const data = await response.json();
    return data && data.ok === true && data.claims && typeof data.claims === "object"
      ? data.claims as Record<string, unknown>
      : null;
  } catch (error) {
    console.error("[kurogames-online] UNON win proof verification failed", error);
    return null;
  }
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

async function isUserTemporarilySuspended(userId: string) {
  const now = new Date().toISOString();
  const { data, error } = await admin.from("account_suspensions")
    .select("id,ends_at")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .lte("starts_at", now)
    .gt("ends_at", now)
    .limit(1)
    .maybeSingle();
  if (error) throw new HttpError(503, "アカウントの利用状態を確認できません。時間をおいて再度お試しください。");
  return !!data;
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
  if (await isUserTemporarilySuspended(data.user.id)) {
    throw new HttpError(403, "このアカウントは一時停止中です。解除予定時刻までゲーム機能は利用できません。");
  }
  return data.user;
}
async function getOptionalUser(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  // Cloudflare relayはゲスト時にpublishable keyをBearerとして補うため、
  // JWT形式でない値は未ログインとして扱う。
  if (!token || token.length > 8192 || token.split(".").length !== 3) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) return null;
  if (await isUserTemporarilySuspended(data.user.id)) return null;
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


const NUMBER_GAME_ID = "bb466662-5423-48e6-bbcc-d19da50ba818";
const TICTACTOE_GAME_ID = "2dbd6773-2684-4f00-973e-c46acbc348e7";
const NUMBER_LEVELS: Record<string, number> = {
  easy: 10, normal: 30, hard: 100, expert: 300, master: 1000, legend: 10000,
};
const TTT_PATTERNS = [
  [0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6],
];

function randomIntInclusive(max: number) {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  let value = 0;
  do { crypto.getRandomValues(buf); value = buf[0]; } while (value >= limit);
  return (value % max) + 1;
}

function cloneGameState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

async function loadVerifiedSession(userId: string, sessionId: unknown, nonce: unknown, gameId: string, gameType: string) {
  if (typeof sessionId !== "string" || !UUID_RE.test(sessionId) ||
      typeof nonce !== "string" || !UUID_RE.test(nonce)) {
    throw new HttpError(400, "ゲーム認証情報が正しくありません。");
  }
  const { data, error } = await admin.from("game_verification_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("game_id", gameId)
    .eq("user_id", userId)
    .eq("game_type", gameType)
    .maybeSingle();
  if (error) throw new HttpError(500, "ゲーム認証状態を取得できませんでした。");
  if (!data) throw new HttpError(404, "ゲームセッションが見つかりません。");
  if (data.status !== "active") throw new HttpError(409, "このゲームセッションは終了しています。");
  if (data.nonce !== nonce) throw new HttpError(409, "認証情報が更新されています。画面を再読み込みしてください。");
  const ageMs = Date.now() - Date.parse(data.started_at);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 60 * 60 * 1000) {
    await admin.from("game_verification_sessions").update({status:"expired"}).eq("id",data.id).eq("nonce",data.nonce);
    throw new HttpError(410, "ゲームセッションの有効期限が切れました。");
  }
  return data;
}

async function saveVerifiedSession(session: Record<string, any>, patch: Record<string, unknown>) {
  const nextNonce = crypto.randomUUID();
  const { data, error } = await admin.from("game_verification_sessions")
    .update({...patch, nonce:nextNonce, last_action_at:new Date().toISOString()})
    .eq("id",session.id)
    .eq("nonce",session.nonce)
    .eq("status","active")
    .select("id")
    .maybeSingle();
  if (error) throw new HttpError(500, "ゲーム状態を更新できませんでした。");
  if (!data) throw new HttpError(409, "この操作は既に処理済みです。もう一度画面を確認してください。");
  return nextNonce;
}

type TttCell = null | "O" | "X" | {player:"O"|"X";size:number};
type TttState = {
  rule:string;
  difficulty:string;
  board:TttCell[];
  moveHistory:{O:number[];X:number[]};
  pieceStock:{O:Record<string,number>;X:Record<string,number>};
  currentPlayer:"O"|"X";
};

function tttPlayer(cell: TttCell): string | null {
  if (cell === null) return null;
  return typeof cell === "string" ? cell : cell.player;
}

function tttLinePlayer(state: TttState): string | null {
  for (const pattern of TTT_PATTERNS) {
    const first = tttPlayer(state.board[pattern[0]]);
    if (first && pattern.every(i => tttPlayer(state.board[i]) === first)) return first;
  }
  return null;
}

function tttCanPlace(state:TttState,index:number,player:"O"|"X",size:number) {
  if (!Number.isInteger(index) || index < 0 || index > 8) return false;
  const cell = state.board[index];
  if (state.rule === "gobble") {
    if (![1,2,3].includes(size) || Number(state.pieceStock[player][String(size)] || 0) <= 0) return false;
    if (cell === null) return true;
    return typeof cell === "object" && cell.player !== player && cell.size < size;
  }
  return cell === null;
}

function tttMoves(state:TttState,player:"O"|"X") {
  const moves:Array<{index:number;size:number}> = [];
  if (state.rule === "gobble") {
    for (const size of [1,2,3]) for (let index=0;index<9;index++) {
      if (tttCanPlace(state,index,player,size)) moves.push({index,size});
    }
  } else {
    for (let index=0;index<9;index++) if (tttCanPlace(state,index,player,2)) moves.push({index,size:2});
  }
  return moves;
}

function tttApplyMove(state:TttState,index:number,player:"O"|"X",size:number) {
  if (!tttCanPlace(state,index,player,size)) throw new HttpError(400, "そのマスには置けません。");
  if (state.rule === "vanish" && state.moveHistory[player].length >= 3) {
    const oldest = state.moveHistory[player].shift();
    if (oldest !== undefined) state.board[oldest] = null;
  }
  if (state.rule === "gobble") {
    state.pieceStock[player][String(size)] -= 1;
    state.board[index] = {player,size};
  } else {
    state.board[index] = player;
  }
  state.moveHistory[player].push(index);
  state.currentPlayer = player === "O" ? "X" : "O";
}

function tttTerminal(state:TttState, movedPlayer:"O"|"X") {
  const linePlayer = tttLinePlayer(state);
  if (linePlayer) {
    return {done:true,winner:state.rule === "reverse" ? (linePlayer === "O" ? "X" : "O") : linePlayer};
  }
  const next = movedPlayer === "O" ? "X" : "O";
  if (tttMoves(state,next).length === 0) return {done:true,winner:"draw"};
  if (state.rule !== "vanish" && state.rule !== "gobble" && state.board.every(cell => cell !== null)) {
    return {done:true,winner:"draw"};
  }
  return {done:false,winner:null};
}

function tttHeuristic(state:TttState) {
  let value = 0;
  const reverse = state.rule === "reverse";
  for (const pattern of TTT_PATTERNS) {
    const owners = pattern.map(i => tttPlayer(state.board[i]));
    const x = owners.filter(v=>v==="X").length;
    const o = owners.filter(v=>v==="O").length;
    if (x && o) continue;
    if (x) value += (reverse ? -1 : 1) * (x===2?8:x===1?2:0);
    if (o) value += (reverse ? 1 : -1) * (o===2?8:o===1?2:0);
  }
  const center = tttPlayer(state.board[4]);
  if (center === "X") value += reverse ? -2 : 2;
  if (center === "O") value += reverse ? 2 : -2;
  return value;
}

function tttChooseCpuMove(state:TttState) {
  const moves = tttMoves(state,"X");
  if (!moves.length) return null;
  const difficulty = state.difficulty;
  if (difficulty === "easy") return moves[Math.floor(Math.random()*moves.length)];

  const evaluated = moves.map(move => {
    const afterX = cloneGameState(state);
    tttApplyMove(afterX,move.index,"X",move.size);
    const first = tttTerminal(afterX,"X");
    if (first.done) {
      const terminalScore = first.winner === "X" ? 10000 : first.winner === "O" ? -10000 : 0;
      return {move,score:terminalScore};
    }
    const responses = tttMoves(afterX,"O");
    let worst = 10000;
    for (const response of responses) {
      const afterO = cloneGameState(afterX);
      tttApplyMove(afterO,response.index,"O",response.size);
      const outcome = tttTerminal(afterO,"O");
      let score = outcome.done
        ? (outcome.winner === "X" ? 9000 : outcome.winner === "O" ? -9000 : 0)
        : tttHeuristic(afterO);
      if (score < worst) worst = score;
    }
    const position = move.index === 4 ? 2 : [0,2,6,8].includes(move.index) ? 1 : 0;
    const sizeCost = state.rule === "gobble" ? move.size * 0.3 : 0;
    return {move,score:worst + position - sizeCost};
  });

  if (difficulty === "normal" && Math.random() < 0.4) {
    return moves[Math.floor(Math.random()*moves.length)];
  }
  evaluated.sort((a,b)=>b.score-a.score);
  const bestScore = evaluated[0].score;
  const best = evaluated.filter(item=>item.score===bestScore).map(item=>item.move);
  return best[Math.floor(Math.random()*best.length)];
}

async function reconcilePendingVerifiedSessions(userId:string,gameId:string) {
  const {data:pending,error} = await admin.from("game_verification_sessions")
    .select("*")
    .eq("game_id",gameId)
    .eq("user_id",userId)
    .eq("status","completed")
    .eq("score_recorded",false)
    .order("completed_at",{ascending:true})
    .limit(10);
  if(error) {
    console.warn("[kurogames-online] pending verified session lookup failed",error);
    return;
  }
  for(const session of pending ?? []) {
    try {
      if(gameId===NUMBER_GAME_ID && session.game_type==="number_guess") {
        const level=String(session.state?.level ?? "").toLowerCase();
        if(session.state?.playMode!=="time" || session.result!=="correct" ||
          !Object.prototype.hasOwnProperty.call(NUMBER_LEVELS,level)) continue;
        const mode="number-time-"+level;
        const metadata={
          metric:"clear_time_ms",
          difficulty:level,
          rangeMax:Number(session.range_max),
          attempts:Number(session.attempts),
          source:"number-guess-server",
          serverVerified:"number-guess-v1",
          sessionId:session.id,
        };
        const {error:recordError}=await admin.rpc("kuro_submit_verified_number_score",{
          p_game_id:gameId,
          p_user_id:userId,
          p_mode:mode,
          p_submission_id:session.id,
          p_metadata:metadata,
        });
        if(recordError) {
          console.warn("[kurogames-online] pending number score recovery failed",recordError);
          continue;
        }
      } else if(gameId===TICTACTOE_GAME_ID && session.game_type==="tictactoe") {
        if(!["win","loss","draw"].includes(String(session.result)) ||
          !["normal","vanish","gobble","reverse"].includes(String(session.mode)) ||
          !["easy","normal","hard"].includes(String(session.state?.difficulty))) continue;
        const {error:recordError}=await admin.rpc("kuro_record_verified_tictactoe_result",{
          p_game_id:gameId,
          p_user_id:userId,
          p_rule:session.mode,
          p_result:session.result,
          p_submission_id:session.id,
          p_cpu_difficulty:String(session.state.difficulty).toUpperCase(),
        });
        if(recordError) {
          console.warn("[kurogames-online] pending tic-tac-toe result recovery failed",recordError);
          continue;
        }
      }
    } catch(error) {
      console.warn("[kurogames-online] pending verified session recovery failed",error);
    }
  }
}

async function handle(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") throw new HttpError(405, "POSTで呼び出してください。");

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    throw new HttpError(400, "JSON形式のリクエストを送信してください。");
  }
  if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    throw new HttpError(400, "リクエスト本文はJSONオブジェクトで指定してください。");
  }
  const body = parsedBody as Record<string, unknown>;
  const action = body.action;
  if (typeof action !== "string" || action.length > 64) {
    throw new HttpError(400, "操作名が正しくありません。");
  }
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

  if (action === "stats_get") {
    const user = await getUser(req);
    requirePublished(game);
    const allGames = body.allGames === true;
    // When not explicitly requesting all of the caller's games, scope the
    // result to the game authenticated by this request, never a body-supplied id.
    const targetGameId = game.id;
    const limit = Math.max(1, Math.min(250, Number.isFinite(Number(body.limit)) ? Math.floor(Number(body.limit)) : 100));
    let query = admin.from("kuro_game_user_stats")
      .select("user_id,game_id,mode,plays,wins,losses,draws,best_score,best_time_ms,total_time_ms,last_played_at,metadata,updated_at")
      .eq("user_id", user.id);
    if (!allGames) query = query.eq("game_id", targetGameId);
    if (typeof body.mode === "string" && body.mode.trim()) query = query.eq("mode", safeMode(body.mode));
    const { data, error } = await query.order("updated_at", { ascending: false }).limit(limit);
    if (error) {
      console.error("[kurogames-online] unified stats read failed", error);
      throw new HttpError(500, "ゲーム記録を取得できませんでした。");
    }
    return reply(200, { stats: data || [], allGames });
  }

  if (action === "stats_history") {
    const user = await getUser(req);
    requirePublished(game);
    const allGames = body.allGames === true;
    // Compatibility endpoint only: return one aggregate row per game/mode.
    // The per-play event archive is no longer queried by the new record system.
    const targetGameId = game.id;
    const limit = Math.max(1, Math.min(250, Number.isFinite(Number(body.limit)) ? Math.floor(Number(body.limit)) : 100));
    let query = admin.from("kuro_game_user_stats")
      .select("user_id,game_id,mode,plays,wins,losses,draws,best_score,best_time_ms,total_time_ms,last_played_at,metadata,updated_at")
      .eq("user_id", user.id);
    if (!allGames) query = query.eq("game_id", targetGameId);
    if (typeof body.mode === "string" && body.mode.trim()) query = query.eq("mode", safeMode(body.mode));
    const { data, error } = await query.order("updated_at", { ascending: false }).limit(limit);
    if (error) {
      console.error("[kurogames-online] aggregate stats compatibility read failed", error);
      throw new HttpError(500, "ゲーム記録を取得できませんでした。");
    }
    return reply(200, { stats: data || [], events: [], deprecated: true, allGames });
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
    if (game.id === TICTACTOE_GAME_ID || game.id === NUMBER_GAME_ID || game.id === UNON_GAME_ID) {
      return reply(200, {
        modes: [...(KNOWN_RANKING_MODES[game.id] ?? [])],
        showcaseConfig: sanitizeRankingShowcaseConfig(settings.features.rankingShowcaseConfig),
      });
    }
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
    if (game.id === UNON_GAME_ID && !(KNOWN_RANKING_MODES[game.id] ?? []).includes(mode)) {
      throw new HttpError(400, "UNONのランキングは勝利回数のみです。");
    }
    const limit = Math.max(1, Math.min(100, Number.isFinite(Number(body.limit)) ? Math.floor(Number(body.limit)) : 20));
    // Time rankings use lower scores (milliseconds) as better results.
    const isTimeRanking = /(^|[_-])(time|duration|elapsed|seconds?|milliseconds?|ms|fastest|clear_time)([_-]|$)/i.test(mode);
    if (game.id === NUMBER_GAME_ID) {
      if (!(KNOWN_RANKING_MODES[game.id] ?? []).includes(mode)) {
        throw new HttpError(400, "数字当てのランキングモードが正しくありません。");
      }
      const rankingViewer = await getOptionalUser(req);
      if (rankingViewer) await reconcilePendingVerifiedSessions(rankingViewer.id, game.id);
    }
    if (game.id === TICTACTOE_GAME_ID) {
      const rankingViewer = await getOptionalUser(req);
      if (rankingViewer) await reconcilePendingVerifiedSessions(rankingViewer.id, game.id);
    }

    // Tic-Tac-Toe win rankings use the shared user/game/mode aggregate.
    // The dedicated verified stats table remains the source for streak and win-rate views.
    if (game.id === TICTACTOE_GAME_ID) {
      if (!["normal", "vanish", "gobble", "reverse"].includes(mode)) {
        throw new HttpError(400, "ランキングルールが正しくありません。");
      }
      const { data: verifiedRows, error: verifiedError } = await admin
        .from("kuro_game_user_stats")
        .select("user_id, wins, updated_at")
        .eq("game_id", game.id)
        .eq("mode", mode)
        .contains("metadata", { metric: "wins", source: "tictactoe-server" })
        .gt("wins", 0);
      if (verifiedError) throw new HttpError(500, "〇✕ゲームの集計ランキングを取得できませんでした。");
      const combinedRows = (verifiedRows ?? [])
        .map((row) => ({ ...row, wins: Number(row.wins) || 0 }))
        .sort((a, b) => b.wins - a.wins || String(a.updated_at).localeCompare(String(b.updated_at)))
        .slice(0, limit);
      const verifiedUserIds = Array.from(new Set(combinedRows.map((row) => row.user_id)));
      const verifiedProfiles = new Map<string, { kuro_id: string; username: string; avatar_url: string | null }>();
      if (verifiedUserIds.length) {
        const { data: profiles, error: profileError } = await admin
          .from("profiles")
          .select("id, kuro_id, username, avatar_url")
          .in("id", verifiedUserIds);
        if (profileError) throw new HttpError(500, "ランキング参加者のプロフィールを取得できませんでした。");
        for (const profile of profiles ?? []) {
          verifiedProfiles.set(profile.id, {
            kuro_id: profile.kuro_id ?? "",
            username: profile.username ?? "プレイヤー",
            avatar_url: profile.avatar_url ?? null,
          });
        }
      }
      return reply(200, {
        mode,
        scores: combinedRows.map((row, index) => {
          const profile = verifiedProfiles.get(row.user_id) ?? { kuro_id: "", username: "プレイヤー", avatar_url: null };
          return {
            rank: index + 1,
            userId: row.user_id,
            score: row.wins,
            mode,
            createdAt: row.updated_at,
            recordType: "verified",
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

    let scores:any[] = [];
    if (game.id === NUMBER_GAME_ID) {
      // Number Guess time rankings read only server-verified best times from the common aggregate.
      const { data: verifiedScores, error: verifiedError } = await admin.from("kuro_game_user_stats")
        .select("user_id, mode, best_time_ms, last_played_at, updated_at")
        .eq("game_id", game.id)
        .eq("mode", mode)
        .contains("metadata", { verifiedRanking: "number-guess-v1" })
        .gte("best_time_ms", 500)
        .lte("best_time_ms", 3600000)
        .order("best_time_ms", { ascending: true })
        .limit(limit);
      if (verifiedError) throw new HttpError(500, "検証済みランキングを取得できませんでした。");
      scores = (verifiedScores ?? []).map((row) => ({
        user_id: row.user_id,
        score: Number(row.best_time_ms),
        mode: row.mode,
        created_at: row.last_played_at || row.updated_at,
        recordType: "verified",
      }));
    } else {
      // Normal rankings are read from the single aggregate row per user/game/mode.
      // The verified TicTacToe and Number Guess branches above intentionally retain
      // their specialized trusted sources and validation rules.
      const { data, error } = await admin.from("kuro_game_user_stats")
        .select("user_id,mode,wins,best_score,best_time_ms,last_played_at,created_at,updated_at,metadata")
        .eq("game_id", game.id)
        .eq("mode", mode);
      if (error) throw new HttpError(500, "集計ランキングを取得できませんでした。");

      const aggregateRows = data ?? [];
      const metricFor = (row: any) => String(
        row?.metadata && typeof row.metadata === "object" ? row.metadata.metric ?? "" : ""
      ).toLowerCase();
      const isAggregateTimeRanking = isTimeRanking || aggregateRows.some((row: any) =>
        ["clear_time_ms", "time_ms", "duration_ms"].includes(metricFor(row))
      );

      scores = aggregateRows.map((row: any) => {
        const hasScore = row.best_score !== null && row.best_score !== undefined;
        const hasTime = row.best_time_ms !== null && row.best_time_ms !== undefined;
        const wins = Number(row.wins) || 0;
        const isWinsMetric = metricFor(row) === "wins" || (!hasScore && !hasTime && wins > 0);
        const rawValue = isWinsMetric
          ? row.wins
          : (isAggregateTimeRanking ? row.best_time_ms : row.best_score);
        if (rawValue === null || rawValue === undefined) return null;
        const score = Number(rawValue);
        if (!Number.isFinite(score)) return null;
        return {
          user_id: row.user_id,
          score,
          mode: row.mode,
          created_at: row.last_played_at || row.updated_at || row.created_at,
        };
      }).filter((row: any) => row !== null)
        .sort((a: any, b: any) =>
          (isAggregateTimeRanking ? a.score - b.score : b.score - a.score) ||
          String(a.created_at || "").localeCompare(String(b.created_at || ""))
        )
        .slice(0, limit);
    }

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
          userId: row.user_id,
          score: row.score,
          mode: row.mode,
          createdAt: row.created_at,
          ...(game.id === NUMBER_GAME_ID ? { recordType: row.recordType } : {}),
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

    const viewer = await getOptionalUser(req);
    if (viewer) await reconcilePendingVerifiedSessions(viewer.id, game.id);

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
      recordType?: string;
    }> = [];

    if (metric === "wins") {
      // The common aggregate is authoritative for the regular win-count ranking.
      const { data, error } = await admin.from("kuro_game_user_stats")
        .select("user_id, plays, wins, losses, draws, updated_at, metadata")
        .eq("game_id", game.id)
        .eq("mode", rule)
        .contains("metadata", { metric: "wins", source: "tictactoe-server" })
        .gt("wins", 0);
      if (error) throw new HttpError(500, "〇✕ゲームの集計ランキングを取得できませんでした。");
      for (const row of data ?? []) {
        statsRows.push({
          user_id: row.user_id,
          played: row.plays,
          wins: row.wins,
          losses: row.losses,
          draws: row.draws,
          current_streak: 0,
          best_streak: 0,
          updated_at: row.updated_at,
          recordType: "unified",
        });
      }
    } else {
      // Win-rate and streak metrics are not stored in the compact common row.
      for (let offset = 0; offset < 50000; offset += PAGE_SIZE) {
        const { data, error } = await admin.from("game_tictactoe_verified_stats")
          .select("user_id, played, wins, losses, draws, current_streak, best_streak, updated_at")
          .eq("game_id", game.id)
          .eq("rule", rule)
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw new HttpError(500, "〇✕ゲームのランキングを取得できませんでした。");
        const page = (data ?? []) as typeof statsRows;
        statsRows.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
    }

    const mergedStats = new Map<string, any>();
    for (const row of statsRows) mergedStats.set(row.user_id,{
      user_id:row.user_id,played:Number(row.played)||0,wins:Number(row.wins)||0,losses:Number(row.losses)||0,draws:Number(row.draws)||0,
      current_streak:Number(row.current_streak)||0,best_streak:Number(row.best_streak)||0,updated_at:row.updated_at,recordType:row.recordType || "migrated"
    });
    const entries = Array.from(mergedStats.values()).map(row => {
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
      return {userId:row.user_id,played,wins,losses,draws,currentStreak,bestStreak,updatedAt:row.updated_at,score,recordType:row.recordType};
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


  if (action === "number_start") {
    const user = await getUser(req);
    requirePublished(game);
    requireFeature(settings.features, "ranking");
    if (game.id !== NUMBER_GAME_ID) throw new HttpError(404, "数字当ての認証先ではありません。");
    const playMode = body.playMode === "classic" ? "classic" : body.playMode === "time" ? "time" : "";
    const level = typeof body.level === "string" ? body.level.trim().toLowerCase() : "";
    if (!playMode || !Object.prototype.hasOwnProperty.call(NUMBER_LEVELS,level)) {
      throw new HttpError(400, "ゲームモードまたは難易度が正しくありません。");
    }
    const {error:expireError} = await admin.from("game_verification_sessions").update({status:"expired"})
      .eq("game_id",game.id).eq("user_id",user.id).eq("game_type","number_guess").eq("status","active");
    if (expireError) throw new HttpError(500,"前の数字当てセッションを終了できませんでした。");
    const max = NUMBER_LEVELS[level];
    const answer = randomIntInclusive(max);
    const {data,error} = await admin.from("game_verification_sessions").insert({
      game_id:game.id,user_id:user.id,game_type:"number_guess",mode:playMode+":"+level,
      secret_number:answer,range_max:max,attempts:0,state:{playMode,level},status:"active",
    }).select("id,nonce,started_at").single();
    if (error?.code === "23505") throw new HttpError(409,"別のゲームが同時に開始されました。画面を再読み込みしてからお試しください。");
    if (error || !data) throw new HttpError(500,"ゲームを開始できませんでした。");
    return reply(200,{ok:true,sessionId:data.id,nonce:data.nonce,rangeMax:max,startedAt:data.started_at});
  }

  if (action === "number_guess") {
    const user = await getUser(req);
    requirePublished(game);
    requireFeature(settings.features, "ranking");
    if (game.id !== NUMBER_GAME_ID) throw new HttpError(404,"数字当ての認証先ではありません。");
    const session = await loadVerifiedSession(user.id,body.sessionId,body.nonce,game.id,"number_guess");
    const guess = Number(body.guess);
    if (!Number.isSafeInteger(guess) || guess < 1 || guess > Number(session.range_max)) {
      throw new HttpError(400,"範囲内の整数を入力してください。");
    }
    const lastActionMs = Date.now() - Date.parse(session.last_action_at);
    if (Number.isFinite(lastActionMs) && lastActionMs < 80) {
      throw new HttpError(429,"入力が速すぎます。少し待ってからもう一度お試しください。");
    }
    const attempts = Number(session.attempts || 0) + 1;
    const playMode = String(session.state?.playMode || "");
    const level = String(session.state?.level || "");
    const correct = guess === Number(session.secret_number);
    const remaining = playMode === "classic" ? Math.max(0,5-attempts) : null;
    const lost = !correct && playMode === "classic" && attempts >= 5;
    const elapsedMs = correct ? Math.max(0,Date.now()-Date.parse(session.started_at)) : null;
    const completed = correct || lost;
    const nextNonce = await saveVerifiedSession(session,{
      attempts,
      status:completed ? "completed" : "active",
      result:correct ? "correct" : lost ? "failed" : null,
      completed_at:completed ? new Date().toISOString() : null,
    });

    let recordResult:Record<string,unknown> = {scoreRecorded:false,improved:false};
    if (correct && playMode === "time" && elapsedMs !== null) {
      if (elapsedMs >= 500) {
        const mode = "number-time-" + level;
        const metadata = {
          metric:"clear_time_ms",
          difficulty:level,
          rangeMax:Number(session.range_max),
          attempts,
          source:"number-guess-server",
          serverVerified:"number-guess-v1",
          sessionId:session.id,
        };
        const {data,error} = await admin.rpc("kuro_submit_verified_number_score",{
          p_game_id:game.id,p_user_id:user.id,p_mode:mode,
          p_submission_id:session.id,p_metadata:metadata,
        });
        if (!error) {
          const saved = Array.isArray(data) ? data[0] : data;
          recordResult = {
            scoreRecorded:!!saved,
            improved:saved?.improved !== false,
            score:Number(saved?.score)||elapsedMs,
          };

        } else {
          console.error("[kurogames-online] verified number score save failed",error);
        }
      } else {
        recordResult = {scoreRecorded:false,improved:false,rejectedReason:"time-too-short"};
      }
    }
    return reply(200,{
      ok:true,correct,attempts,remainingChances:remaining,lost,
      direction:correct ? "correct" : guess < Number(session.secret_number) ? "higher" : "lower",
      answer:lost ? Number(session.secret_number) : undefined,
      completed,elapsedMs,nonce:completed ? null : nextNonce,
      ...recordResult,
    });
  }

  if (action === "tictactoe_start") {
    const user = await getUser(req);
    requirePublished(game);
    requireFeature(settings.features,"ranking");
    if (game.id !== TICTACTOE_GAME_ID) throw new HttpError(404,"〇✕ゲームの認証先ではありません。");
    const rule = typeof body.rule === "string" ? body.rule.trim() : "";
    const difficulty = typeof body.difficulty === "string" ? body.difficulty.trim().toLowerCase() : "";
    if (!["normal","vanish","gobble","reverse"].includes(rule)) throw new HttpError(400,"対戦ルールが正しくありません。");
    if (!["easy","normal","hard"].includes(difficulty)) throw new HttpError(400,"CPU難易度が正しくありません。");
    const {error:expireError} = await admin.from("game_verification_sessions").update({status:"expired"})
      .eq("game_id",game.id).eq("user_id",user.id).eq("game_type","tictactoe").eq("status","active");
    if (expireError) throw new HttpError(500,"前の〇✕ゲームセッションを終了できませんでした。");
    const state:TttState = {
      rule,difficulty,board:Array(9).fill(null),
      moveHistory:{O:[],X:[]},
      pieceStock:{O:{"1":2,"2":2,"3":2},X:{"1":2,"2":2,"3":2}},
      currentPlayer:"O",
    };
    const {data,error} = await admin.from("game_verification_sessions").insert({
      game_id:game.id,user_id:user.id,game_type:"tictactoe",mode:rule,state,status:"active",
    }).select("id,nonce").single();
    if (error?.code === "23505") throw new HttpError(409,"別の対局が同時に開始されました。画面を再読み込みしてからお試しください。");
    if (error || !data) throw new HttpError(500,"対戦認証を開始できませんでした。");
    return reply(200,{ok:true,sessionId:data.id,nonce:data.nonce});
  }

  if (action === "tictactoe_move") {
    const user = await getUser(req);
    requirePublished(game);
    requireFeature(settings.features,"ranking");
    if (game.id !== TICTACTOE_GAME_ID) throw new HttpError(404,"〇✕ゲームの認証先ではありません。");
    const session = await loadVerifiedSession(user.id,body.sessionId,body.nonce,game.id,"tictactoe");
    const state = cloneGameState(session.state as TttState);
    if (!state || state.currentPlayer !== "O") throw new HttpError(409,"現在はあなたの手番ではありません。");
    const index = Number(body.index);
    const size = state.rule === "gobble" ? Number(body.size) : 2;
    if (!Number.isInteger(index) || index < 0 || index > 8 || !tttCanPlace(state,index,"O",size)) {
      throw new HttpError(400,"そのマスには置けません。");
    }
    const moves:Array<{index:number;player:"O"|"X";size:number}> = [];
    tttApplyMove(state,index,"O",size);
    moves.push({index,player:"O",size});
    let outcome = tttTerminal(state,"O");
    if (!outcome.done) {
      const cpu = tttChooseCpuMove(state);
      if (!cpu) {
        outcome = {done:true,winner:"draw"};
      } else {
        tttApplyMove(state,cpu.index,"X",cpu.size);
        moves.push({index:cpu.index,player:"X",size:cpu.size});
        outcome = tttTerminal(state,"X");
      }
    }
    const completed = outcome.done;
    const result = completed
      ? outcome.winner === "O" ? "win" : outcome.winner === "X" ? "loss" : "draw"
      : null;
    const nextNonce = await saveVerifiedSession(session,{
      state,
      status:completed ? "completed" : "active",
      result,
      completed_at:completed ? new Date().toISOString() : null,
    });
    let recorded = false;
    let stats:Record<string,unknown>|null = null;
    if (completed && result) {
      const {data,error} = await admin.rpc("kuro_record_verified_tictactoe_result",{
        p_game_id:game.id,p_user_id:user.id,p_rule:state.rule,p_result:result,
        p_submission_id:session.id,p_cpu_difficulty:state.difficulty.toUpperCase(),
      });
      if (error) {
        console.error("[kurogames-online] verified tic-tac-toe result save failed",error);
      } else {
        const saved = Array.isArray(data) ? data[0] : data;
        recorded = !!saved;
        stats = saved ? {
          played:Number(saved.played)||0,wins:Number(saved.wins)||0,
          losses:Number(saved.losses)||0,draws:Number(saved.draws)||0,
          currentStreak:Number(saved.current_streak)||0,bestStreak:Number(saved.best_streak)||0,
        } : null;

      }
    }
    return reply(200,{
      ok:true,moves,completed,result,recorded,stats,
      nonce:completed ? null : nextNonce,
    });
  }

  if (action === "tictactoe_submit") {
    throw new HttpError(403,"〇✕ゲームの結果はサーバー検証済みの対戦からのみ記録できます。");
  }

  if (action === "score_submit") {
    const user = await getUser(req);
    requirePublished(game);
    requireFeature(settings.features, "ranking");
    if (game.id === TICTACTOE_GAME_ID || game.id === NUMBER_GAME_ID) {
      throw new HttpError(403, "このゲームの記録はサーバー検証済みのプレイからのみ登録できます。");
    }
    const score = Number(body.score);
    if (!Number.isSafeInteger(score) || score < 0 || score > 1000000000) {
      throw new HttpError(400, "スコアは0〜1,000,000,000の整数で指定してください。");
    }
    const mode = safeMode(body.mode);
    if (game.id === UNON_GAME_ID && !(KNOWN_RANKING_MODES[game.id] ?? []).includes(mode)) {
      throw new HttpError(403, "UNONのランキングは勝利回数のみ登録できます。");
    }
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

    if (game.id === UNON_GAME_ID && mode === "wins-solo") {
      const difficulty = typeof metadata.difficulty === "string" ? metadata.difficulty : "";
      const players = Number(metadata.players);
      if (score !== 1 || metadata.metric !== "wins" || metadata.source !== "unon-solo" ||
          !["easy", "normal", "hard"].includes(difficulty) ||
          !Number.isSafeInteger(players) || players < 2 || players > 4) {
        throw new HttpError(400, "UNONひとり用の勝利記録データが正しくありません。");
      }
    }

    if (game.id === UNON_GAME_ID && mode === "wins-online") {
      console.info("[kurogames-online] UNON online win submission received", {
        userId: user.id, submissionId, score, source: metadata.source,
      });
      if (score !== 1 || metadata.metric !== "wins" || metadata.source !== "unon-online" ||
          metadata.matchId !== submissionId || typeof metadata.roomId !== "string") {
        throw new HttpError(400, "UNONオンライン勝利の記録データが正しくありません。");
      }
      const claims = typeof metadata.winProof === "string"
        ? await verifyUnonWinProof(metadata.winProof)
        : null;
      if (!claims || claims.typ !== "unon_win" || claims.sub !== user.id ||
          claims.game !== game.id || claims.match !== submissionId || claims.room !== metadata.roomId) {
        console.warn("[kurogames-online] UNON online win proof claims mismatch", {
          hasClaims: !!claims, correctType: claims?.typ === "unon_win",
          correctUser: claims?.sub === user.id, correctGame: claims?.game === game.id,
          correctMatch: claims?.match === submissionId, correctRoom: claims?.room === metadata.roomId,
        });
        throw new HttpError(403, "サーバーが確認した勝利記録ではありません。");
      }
      console.info("[kurogames-online] UNON online win proof validated", { submissionId });
    }

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

    // Every accepted ranking submission also enters the user-centred event ledger.
    // Win-event triggers may already have inserted the same submission; the RPC is idempotent.
    const rawDuration = Number(metadata.durationMs ?? metadata.duration_ms);
    const durationMs = Number.isSafeInteger(rawDuration) && rawDuration >= 0 ? rawDuration : null;
    const { error: unifiedRecordError } = await admin.rpc("kuro_record_user_game_event", {
      p_submission_id: submissionId,
      p_user_id: user.id,
      p_game_id: game.id,
      p_mode: mode,
      p_result: metadata.metric === "wins" ? "win" : "played",
      p_score: score,
      p_duration_ms: durationMs,
      p_metadata: metadata,
    });
    if (unifiedRecordError) {
      console.error("[kurogames-online] unified score event save failed", unifiedRecordError);
      throw new HttpError(500, "統合ゲーム記録を保存できませんでした。再度お試しください。");
    }

    if (game.id === UNON_GAME_ID && mode === "wins-online") {
      console.info("[kurogames-online] UNON online win recorded", {
        userId: user.id, submissionId, totalWins: Number(submitted.score) || 0,
      });
    }
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

    // The shared aggregate is the only ranking source; orphaned legacy results
    // are excluded by the authenticated user foreign key during reconciliation.
    const { data: stats, error } = await admin.from("kuro_game_user_stats")
      .select("user_id, wins, updated_at")
      .eq("game_id", game.id)
      .eq("mode", "online")
      .gt("wins", 0)
      .order("wins", { ascending: false })
      .order("updated_at", { ascending: true })
      .limit(100);
    if (error) throw new HttpError(500, "七並べランキングを取得できませんでした。");

    const ids = (stats ?? []).map((entry) => entry.user_id);
    const profiles = new Map<string, string>();
    if (ids.length) {
      const { data: profileRows, error: profileError } = await admin.from("profiles")
        .select("id, username, display_name").in("id", ids);
      if (profileError) throw new HttpError(500, "ランキングのプレイヤー名を取得できませんでした。");
      for (const profile of profileRows ?? []) {
        profiles.set(profile.id, profile.display_name || profile.username || "プレイヤー");
      }
    }

    const rows = (stats ?? []).map((entry) => ({
      name: profiles.get(entry.user_id) || "プレイヤー",
      userId: entry.user_id,
      wins: Number(entry.wins) || 0,
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
      if (isUnon ? (members.length < 2 || members.length > 4) : members.length !== 2) {
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

  if (action === "werewolf_action") {
    const user = await getUser(req);
    requirePublished(game);
    requireMultiplayer(settings.features);
    if (game.id !== "903a4c45-37bb-4a4b-a259-a5a8245de998") {
      throw new HttpError(404, "このゲームでは使用できない操作です。");
    }
    const roomId = typeof body.roomId === "string" && UUID_RE.test(body.roomId) ? body.roomId : "";
    const gameAction = typeof body.gameAction === "string" ? body.gameAction : "";
    const allowed = new Set([
      "set_config","reaction","start","confirm_role","force_start_day1",
      "adjust_discuss_time","advance_vote","submit_vote","force_tally",
      "night_action","force_finish_night","return_to_lobby","disband"
    ]);
    const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? body.payload as Record<string, unknown> : {};
    const actionId = typeof body.actionId === "string" && UUID_RE.test(body.actionId) ? body.actionId : "";
    if (!roomId || !allowed.has(gameAction) || !actionId) {
      throw new HttpError(400, "人狼の操作内容が正しくありません。");
    }
    const { data, error } = await admin.rpc("kuro_werewolf_action", {
      p_game_id: game.id, p_room_id: roomId, p_user_id: user.id,
      p_action: gameAction, p_payload: payload, p_action_id: actionId
    });
    if (error) {
      const message = error.message || "";
      const rules: Array<[string, number, string]> = [
        ["ROOM_MEMBERSHIP_REQUIRED",403,"このルームの参加者ではありません。"],
        ["ROOM_NOT_FOUND",404,"ルームが見つかりません。"],
        ["HOST_ONLY_ACTION",403,"この操作はルームホストだけが実行できます。"],
        ["PLAYER_NOT_IN_GAME",403,"ゲーム参加者として登録されていません。"],
        ["GAME_ALREADY_STARTED",409,"ゲームは既に始まっています。"],
        ["GAME_NOT_STARTED",409,"ゲームはまだ始まっていません。"],
        ["GAME_NOT_PLAYING",409,"ゲームは進行中ではありません。"],
        ["GAME_NOT_FINISHED",409,"ゲーム終了後に実行できます。"],
        ["WEREWOLF_REQUIRES_THREE_PLAYERS",409,"3人以上で開始してください。"],
        ["ROLE_COUNT_EXCEEDS_PLAYERS",409,"役職数が参加人数を超えています。"],
        ["INVALID_PHASE",409,"現在のフェーズでは実行できない操作です。"],
        ["PLAYER_DEAD",409,"死亡したプレイヤーはこの操作を実行できません。"],
        ["INVALID_VOTE_TARGET",400,"投票先を選び直してください。"],
        ["ROLE_CANNOT_ACT",403,"この役職では夜行動できません。"],
        ["INVALID_NIGHT_TARGET",400,"夜の対象を選び直してください。"],
        ["ALREADY_ACTED",409,"この夜の行動は完了しています。"],
        ["UNKNOWN_WEREWOLF_ACTION",400,"未対応の操作です。"]
      ];
      const match = rules.find(([code]) => message.includes(code));
      if (match) throw new HttpError(match[1],match[2]);
      console.error("[kurogames-online] Werewolf action failed", error);
      throw new HttpError(500,"人狼の操作をサーバーで処理できませんでした。");
    }
    return reply(200, data || { ok: true });
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
      if (game.id === "903a4c45-37bb-4a4b-a259-a5a8245de998") {
        const { error: initError } = await admin.rpc("kuro_werewolf_join", {
          p_game_id: game.id, p_room_id: String(room.id), p_user_id: user.id
        });
        if (initError) {
          await admin.rpc("kuro_leave_online_room", { p_room_id: String(room.id), p_user_id: user.id });
          await admin.from("game_online_rooms").delete().eq("id", room.id);
          console.error("[kurogames-online] Werewolf room init failed", initError);
          throw new HttpError(500, "人狼ルームを初期化できませんでした。");
        }
      }
      return reply(200, { room: { ...room, game_data: game.id === "903a4c45-37bb-4a4b-a259-a5a8245de998" ? (await admin.from("game_online_rooms").select("game_data").eq("id",room.id).single()).data?.game_data : null }, members: await getRoomMembers(String(room.id)) });
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
      if (game.id === "903a4c45-37bb-4a4b-a259-a5a8245de998") {
        const { error: joinError } = await admin.rpc("kuro_werewolf_join", {
          p_game_id: game.id, p_room_id: String(room.id), p_user_id: user.id
        });
        if (joinError) {
          await admin.rpc("kuro_leave_online_room", { p_room_id: String(room.id), p_user_id: user.id });
          if ((joinError.message || "").includes("GAME_ALREADY_STARTED")) throw new HttpError(409,"このルームは既にゲームが始まっています。");
          if ((joinError.message || "").includes("ROOM_FULL")) throw new HttpError(409,"ルームが満員です。");
          console.error("[kurogames-online] Werewolf join state failed",joinError);
          throw new HttpError(500,"人狼ルームへ参加者を追加できませんでした。");
        }
      }
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
        if (game.id === "903a4c45-37bb-4a4b-a259-a5a8245de998") {
          const { data: personalized, error: stateError } = await admin.rpc("kuro_werewolf_state", {
            p_game_id: game.id, p_room_id: roomId, p_user_id: user.id
          });
          if (stateError) {
            console.error("[kurogames-online] Werewolf state load failed",stateError);
            throw new HttpError(500,"人狼の個人状態を取得できませんでした。");
          }
          return reply(200, {
            state: personalized ?? room.game_data ?? null,
            updatedAt: room.game_data_updated_at ?? null,
            roomStatus: room.status,
          });
        }
        return reply(200, {
          state: room.game_data ?? null,
          updatedAt: room.game_data_updated_at ?? null,
          roomStatus: room.status,
        });
      }

      if (game.id === "903a4c45-37bb-4a4b-a259-a5a8245de998") {
        throw new HttpError(403,"人狼のゲーム状態はサーバー処理でのみ更新できます。");
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
        if (game.id === "903a4c45-37bb-4a4b-a259-a5a8245de998") {
          const { error: syncError } = await admin.rpc("kuro_werewolf_sync_room", { p_room_id: roomId });
          if (syncError) console.error("[kurogames-online] Werewolf stale-room sync failed",syncError);
        }
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
    if (game.id === "903a4c45-37bb-4a4b-a259-a5a8245de998") {
      const { error: syncError } = await admin.rpc("kuro_werewolf_sync_room", { p_room_id: roomId });
      if (syncError) {
        console.error("[kurogames-online] Werewolf leave sync failed",syncError);
        throw new HttpError(500,"退出者のゲーム状態を同期できませんでした。");
      }
      await admin.from("game_online_room_messages").insert({
        room_id:roomId,sender_user_id:user.id,event_type:"room-state-updated",payload:{type:"player-left"}
      });
    }
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
