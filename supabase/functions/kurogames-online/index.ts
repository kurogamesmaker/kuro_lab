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
  "5c1e658b-f6d3-412a-8b97-61d2c0457e95": ["normal_beginner","normal_intermediate","normal_advanced","sudden_beginner","sudden_intermediate","sudden_advanced","endless_beginner","endless_intermediate","endless_advanced"],
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

function serverEpochMicroseconds(): bigint {
  const epochMs = Number(performance.timeOrigin) + Number(performance.now());
  if (!Number.isFinite(epochMs) || epochMs <= 0) return BigInt(Date.now()) * 1000n;
  return BigInt(Math.round(epochMs * 1000));
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

async function getEquippedCosmeticsForUsers(userIds: string[]) {
  const ids = [...new Set(userIds.filter((id) => typeof id === "string" && UUID_RE.test(id)))];
  const byUser = new Map<string, Record<string, unknown>>();
  if (!ids.length) return byUser;
  let upstream: Response;
  try {
    const query = new URLSearchParams({ userIds: ids.join(",") });
    upstream = await fetch("https://kurolab.cc.cd/api/kuro-economy/public-cosmetics?" + query.toString(), {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000)
    });
  } catch (_) {
    throw new HttpError(503, "装備中アイテムを取得できませんでした。");
  }
  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok || !payload?.users || typeof payload.users !== "object") {
    throw new HttpError(upstream.status >= 500 ? 503 : 500, payload?.error || "装備中アイテムを取得できませんでした。");
  }
  for (const [userId, cosmetics] of Object.entries(payload.users as Record<string, Record<string, unknown>>)) {
    const allowed = Object.fromEntries(Object.entries(cosmetics || {}).filter(([slot]) =>
      ["avatar", "frame", "background", "theme"].includes(slot)
    ));
    byUser.set(userId, allowed);
  }
  return byUser;
}

async function getRoomMembers(roomId: string, includeInactive = false) {
  let memberQuery = admin
    .from("game_online_room_members")
    .select("user_id, joined_at, last_seen_at")
    .eq("room_id", roomId);
  if (!includeInactive) {
    memberQuery = memberQuery.gte("last_seen_at", new Date(Date.now() - 90000).toISOString());
  }
  const { data: members, error } = await memberQuery
    .order("joined_at", { ascending: true });
  if (error) throw new HttpError(500, "参加者一覧を取得できませんでした。");
  const ids = (members ?? []).map((m) => m.user_id);
  const cosmeticsByUser = await getEquippedCosmeticsForUsers(ids);
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
        cosmetics: cosmeticsByUser.get(m.user_id) ?? {},
        isGuest: !hasProfile,
      },
    };
  });
}


const NUMBER_GAME_ID = "bb466662-5423-48e6-bbcc-d19da50ba818";
const TICTACTOE_GAME_ID = "2dbd6773-2684-4f00-973e-c46acbc348e7";
const PRIME_GAME_ID = "79c9921a-d57a-45b1-8271-1ee7042801dc";
const SUSHI_GAME_ID = "5c1e658b-f6d3-412a-8b97-61d2c0457e95";
const DAIFUGO_GAME_ID = "2eb37847-1b7e-43e4-ad98-901d5b830ac4";
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


const PRIME_DIFFICULTY: Record<string, { primes: number[]; minFactors: number; maxFactors: number; maxValue: number; baseScore: number }> = {
  easy: { primes: [2,3,5,7], minFactors: 2, maxFactors: 4, maxValue: 180, baseScore: 200 },
  normal: { primes: [2,3,5,7,11,13], minFactors: 3, maxFactors: 5, maxValue: 600, baseScore: 350 },
  hard: { primes: [2,3,5,7,11,13,17,19,23], minFactors: 3, maxFactors: 6, maxValue: 2500, baseScore: 500 },
};
function primeIsPrime(value: number) {
  if (!Number.isSafeInteger(value) || value < 2) return false;
  if (value === 2) return true;
  if (value % 2 === 0) return false;
  for (let divisor = 3; divisor * divisor <= value; divisor += 2) if (value % divisor === 0) return false;
  return true;
}
function primeRandomIndex(length: number) {
  if (!Number.isSafeInteger(length) || length < 1) throw new Error("INVALID_RANDOM_RANGE");
  const buffer = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / length) * length;
  let value = 0;
  do { crypto.getRandomValues(buffer); value = buffer[0]; } while (value >= limit);
  return value % length;
}
function primeCreateTarget(difficulty: string, previous: number | null = null) {
  const config = PRIME_DIFFICULTY[difficulty];
  if (!config) throw new HttpError(400, "素因数分解の難易度が正しくありません。");
  const minimumPrime = Math.min(...config.primes);
  for (let attempt = 0; attempt < 80; attempt++) {
    const factorCount = config.minFactors + primeRandomIndex(config.maxFactors - config.minFactors + 1);
    let number = 1;
    let generatedFactors = 0;
    for (let i = 0; i < factorCount; i++) {
      const remainingFactors = factorCount - i - 1;
      const candidates = config.primes.filter((prime) =>
        number * prime * Math.pow(minimumPrime, remainingFactors) <= config.maxValue
      );
      if (!candidates.length) break;
      const weighted = Math.floor(Math.pow((primeRandomIndex(1000000) + 1) / 1000000, 1.2) * candidates.length);
      const prime = candidates[Math.min(candidates.length - 1, weighted)];
      number *= prime;
      generatedFactors++;
    }
    // Reject a partial factor set instead of silently creating an easier problem.
    if (generatedFactors !== factorCount) continue;
    if (number !== previous && number > 3 && !primeIsPrime(number)) return number;
  }
  throw new HttpError(503, "問題を生成できませんでした。もう一度開始してください。");
}
function primeGetTimeLeft(session: Record<string, any>, state: Record<string, any>) {
  const elapsed = Math.max(0, (Date.now() - Date.parse(session.started_at)) / 1000);
  return Math.max(0, Math.min(90, 90 - elapsed + (Number(state.timeAdjustment) || 0)));
}
async function primeRecordCompletedRun(userId: string, session: Record<string, any>) {
  const state = session.state && typeof session.state === "object" ? session.state as Record<string, any> : {};
  const score = Math.max(0, Math.floor(Number(state.score) || 0));
  const difficulty = String(state.difficulty || session.mode || "");
  if (!Object.prototype.hasOwnProperty.call(PRIME_DIFFICULTY, difficulty)) {
    throw new HttpError(400, "保存する素因数分解の難易度が正しくありません。");
  }
  const elapsedMs = Math.max(0, Math.min(90 * 1000, Date.now() - Date.parse(session.started_at)));
  const metadata = {
    metric: "score", source: "prime-factor-server", serverVerified: "prime-breaker-v1",
    difficulty, solvedCount: Math.max(0, Math.floor(Number(state.solvedCount) || 0)),
    maxCombo: Math.max(0, Math.floor(Number(state.maxCombo) || 0)),
    durationMs: elapsedMs, sessionId: session.id,
  };
  if (score > 0) {
    const { error: scoreError } = await admin.rpc("kuro_submit_game_score", {
      p_game_id: PRIME_GAME_ID, p_user_id: userId, p_mode: difficulty,
      p_score: score, p_submission_id: session.id, p_metadata: metadata,
      p_level: null, p_cpu_difficulty: null,
    });
    if (scoreError) {
      console.error("[kurogames-online] verified prime score save failed", scoreError);
      throw new HttpError(500, "素因数分解のランキングを保存できませんでした。");
    }
    const { error: eventError } = await admin.rpc("kuro_record_user_game_event", {
      p_submission_id: session.id, p_user_id: userId, p_game_id: PRIME_GAME_ID,
      p_mode: difficulty, p_result: "played", p_score: score,
      p_duration_ms: elapsedMs, p_metadata: metadata,
    });
    if (eventError) {
      console.error("[kurogames-online] verified prime unified event save failed", eventError);
      throw new HttpError(500, "素因数分解の統合ゲーム記録を保存できませんでした。");
    }
  }
  const { error: markError } = await admin.from("game_verification_sessions")
    .update({ score_recorded: true, score_recovery_status: "recorded" })
    .eq("id", session.id).eq("game_id", PRIME_GAME_ID)
    .eq("user_id", userId).eq("status", "completed");
  if (markError) throw new HttpError(500, "素因数分解の記録状態を更新できませんでした。");
  return { scoreRecorded: score > 0, score };
}


const SUSHI_WORD_BANK = {"advanced":[{"kana":"かいせんちらし","romaji":"kaisenchirashi"},{"kana":"しんせんまぐろ","romaji":"shinsenmaguro"},{"kana":"サーモンアボカド","romaji":"sa-monnabokado"},{"kana":"ほたてのバターやき","romaji":"hotatenobata-yaki"},{"kana":"あぶりえんがわ","romaji":"aburiengawa"},{"kana":"とろサーモン","romaji":"torosa-mon"},{"kana":"かにクリームコロッケ","romaji":"kanikuri-mukorokke"},{"kana":"まぐろづくし","romaji":"magurozukushi"},{"kana":"ねぎとろぐんかん","romaji":"negitorogunkan"},{"kana":"ぜいたくにぎり","romaji":"zeitakunigiri"},{"kana":"あぶりとろサーモン","romaji":"aburitorosa-mon"},{"kana":"おおとろづくし","romaji":"ootorozukushi"},{"kana":"ちゅうとろづくし","romaji":"chuutorozukushi"},{"kana":"とくじょうにぎり","romaji":"tokujounigiri"},{"kana":"さしみもりあわせ","romaji":"sashimimoriawase"},{"kana":"にぎりのもりあわせ","romaji":"nigirinomoriawase"},{"kana":"えびアボカドまき","romaji":"ebiabokadomaki"},{"kana":"カリフォルニアロール","romaji":"kariforuniaro-ru"},{"kana":"こんがりチーズやき","romaji":"kongarichi-zuyaki"},{"kana":"サーモンチーズやき","romaji":"sa-monchi-zuyaki"},{"kana":"てりやきチキンにぎり","romaji":"teriyakichikinnnigiri"},{"kana":"ローストビーフにぎり","romaji":"ro-sutobi-funigiri"},{"kana":"ほたてマヨやき","romaji":"hotatemayoyaki"},{"kana":"とろたくまき","romaji":"torotakumaki"},{"kana":"やきとりぐんかん","romaji":"yakitorigunkan"},{"kana":"とびこぐんかん","romaji":"tobikogunkan"},{"kana":"ツナマヨぐんかん","romaji":"tsunamayogunkan"},{"kana":"コーンマヨぐんかん","romaji":"ko-nmayogunkan"},{"kana":"たまごサラダぐんかん","romaji":"tamagosaradagunkan"},{"kana":"うにいくらどん","romaji":"uniikuradon"},{"kana":"まぐろどん","romaji":"magurodon"},{"kana":"ねぎとろどん","romaji":"negitorodon"},{"kana":"いくらのしょうゆづけ","romaji":"ikuranoshouyuzuke"},{"kana":"うなぎのかばやき","romaji":"unaginokabayaki"},{"kana":"あなごのてんぷら","romaji":"anagonotempura"},{"kana":"さんまのしおやき","romaji":"sanmanoshioyaki"},{"kana":"はまちのあぶり","romaji":"hamachinoaburi"},{"kana":"ぶりだいこん","romaji":"buridaikon"},{"kana":"いかげそのからあげ","romaji":"ikagesonokaraage"},{"kana":"やさいてんぷらもりあわせ","romaji":"yasaitempuramoriawase"},{"kana":"たこやき","romaji":"takoyaki"},{"kana":"おすすめせっと","romaji":"osusumesetto"},{"kana":"きょうのおすすめ","romaji":"kyounoosusume"},{"kana":"ほんじつのにぎり","romaji":"honjitsunonigiri"},{"kana":"しゅんのさかな","romaji":"shunnnosakana"},{"kana":"いかのおさしみ","romaji":"ikanoosashimi"},{"kana":"いらっしゃいませ","romaji":"irasshaimase"},{"kana":"ありがとうございます","romaji":"arigatougozaimasu"},{"kana":"ごちそうさまでした","romaji":"gochisousamadeshita"}],"beginner":[{"kana":"すし","romaji":"sushi"},{"kana":"まぐろ","romaji":"maguro"},{"kana":"たまご","romaji":"tamago"},{"kana":"さけ","romaji":"sake"},{"kana":"えび","romaji":"ebi"},{"kana":"いか","romaji":"ika"},{"kana":"たい","romaji":"tai"},{"kana":"ほたて","romaji":"hotate"},{"kana":"あなご","romaji":"anago"},{"kana":"うに","romaji":"uni"},{"kana":"いくら","romaji":"ikura"},{"kana":"かっぱまき","romaji":"kappamaki"},{"kana":"ぶり","romaji":"buri"},{"kana":"さば","romaji":"saba"},{"kana":"あじ","romaji":"aji"},{"kana":"たこ","romaji":"tako"},{"kana":"かに","romaji":"kani"},{"kana":"ひらめ","romaji":"hirame"},{"kana":"かつお","romaji":"katsuo"},{"kana":"はまち","romaji":"hamachi"},{"kana":"いわし","romaji":"iwashi"},{"kana":"あわび","romaji":"awabi"},{"kana":"あさり","romaji":"asari"},{"kana":"かんぱち","romaji":"kanpachi"},{"kana":"さわら","romaji":"sawara"},{"kana":"ふぐ","romaji":"fugu"},{"kana":"さんま","romaji":"sanma"},{"kana":"ほっけ","romaji":"hokke"},{"kana":"たら","romaji":"tara"},{"kana":"えんがわ","romaji":"engawa"},{"kana":"まき","romaji":"maki"},{"kana":"てまき","romaji":"temaki"},{"kana":"にぎり","romaji":"nigiri"},{"kana":"いなり","romaji":"inari"},{"kana":"おにぎり","romaji":"onigiri"},{"kana":"ぐんかん","romaji":"gunkan"},{"kana":"のり","romaji":"nori"},{"kana":"ごはん","romaji":"gohan"},{"kana":"わさび","romaji":"wasabi"},{"kana":"がり","romaji":"gari"},{"kana":"おちゃ","romaji":"ocha"},{"kana":"あがり","romaji":"agari"},{"kana":"さら","romaji":"sara"},{"kana":"はし","romaji":"hashi"},{"kana":"ゆのみ","romaji":"yunomi"},{"kana":"おかわり","romaji":"okawari"},{"kana":"おあいそ","romaji":"oaiso"},{"kana":"かいてん","romaji":"kaiten"},{"kana":"おまかせ","romaji":"omakase"},{"kana":"おしぼり","romaji":"oshibori"},{"kana":"まいど","romaji":"maido"},{"kana":"いらっしゃい","romaji":"irasshai"},{"kana":"おいしい","romaji":"oishii"},{"kana":"うまい","romaji":"umai"},{"kana":"ありがとう","romaji":"arigatou"},{"kana":"ひとつ","romaji":"hitotsu"},{"kana":"ふたつ","romaji":"futatsu"},{"kana":"えだまめ","romaji":"edamame"},{"kana":"ちくわ","romaji":"chikuwa"},{"kana":"ねぎ","romaji":"negi"},{"kana":"しそ","romaji":"shiso"},{"kana":"そば","romaji":"soba"},{"kana":"うどん","romaji":"udon"},{"kana":"おでん","romaji":"oden"},{"kana":"とうふ","romaji":"toufu"},{"kana":"たまねぎ","romaji":"tamanegi"},{"kana":"きゅうり","romaji":"kyuuri"},{"kana":"しょうが","romaji":"shouga"},{"kana":"みそしる","romaji":"misoshiru"},{"kana":"ちらし","romaji":"chirashi"}],"intermediate":[{"kana":"てんぷら","romaji":"tempura"},{"kana":"しんこまき","romaji":"shinkomaki"},{"kana":"ねぎとろ","romaji":"negitoro"},{"kana":"あぶりさーもん","romaji":"aburisa-mon"},{"kana":"こはだ","romaji":"kohada"},{"kana":"しめさば","romaji":"shimesaba"},{"kana":"かにみそ","romaji":"kanimiso"},{"kana":"てっかまき","romaji":"tekkamaki"},{"kana":"おおとろ","romaji":"ootoro"},{"kana":"ちゅうとろ","romaji":"chuutoro"},{"kana":"ぶりとろ","romaji":"buritoro"},{"kana":"あかみ","romaji":"akami"},{"kana":"はまちとろ","romaji":"hamachitoro"},{"kana":"さーもん","romaji":"sa-mon"},{"kana":"あぶりさけ","romaji":"aburisake"},{"kana":"ひらまさ","romaji":"hiramasa"},{"kana":"しまあじ","romaji":"shimaaji"},{"kana":"きんめだい","romaji":"kinmedai"},{"kana":"のどぐろ","romaji":"nodoguro"},{"kana":"ししゃも","romaji":"shishamo"},{"kana":"たらこ","romaji":"tarako"},{"kana":"めんたいこ","romaji":"mentaiko"},{"kana":"すじこ","romaji":"sujiko"},{"kana":"かずのこ","romaji":"kazunoko"},{"kana":"とびこ","romaji":"tobiko"},{"kana":"いくらぐんかん","romaji":"ikuragunkan"},{"kana":"うにぐんかん","romaji":"unigunkan"},{"kana":"ほっきがい","romaji":"hokkigai"},{"kana":"つぶがい","romaji":"tsubugai"},{"kana":"あかがい","romaji":"akagai"},{"kana":"とりがい","romaji":"torigai"},{"kana":"みるがい","romaji":"mirugai"},{"kana":"あおやぎ","romaji":"aoyagi"},{"kana":"ばいがい","romaji":"baigai"},{"kana":"しゃこ","romaji":"shako"},{"kana":"はまぐり","romaji":"hamaguri"},{"kana":"しじみ","romaji":"shijimi"},{"kana":"あまえび","romaji":"amaebi"},{"kana":"ぼたんえび","romaji":"botannebi"},{"kana":"くるまえび","romaji":"kurumaebi"},{"kana":"さくらえび","romaji":"sakuraebi"},{"kana":"たらばがに","romaji":"tarabagani"},{"kana":"ずわいがに","romaji":"zuwaigani"},{"kana":"かにかま","romaji":"kanikama"},{"kana":"いかそうめん","romaji":"ikasoumen"},{"kana":"げそ","romaji":"geso"},{"kana":"やりいか","romaji":"yariika"},{"kana":"すみいか","romaji":"sumiika"},{"kana":"あおりいか","romaji":"aoriika"},{"kana":"たこわさ","romaji":"takowasa"},{"kana":"かんぴょうまき","romaji":"kanpyoumaki"},{"kana":"ふとまき","romaji":"futomaki"},{"kana":"えほうまき","romaji":"ehoumaki"},{"kana":"ねぎとろまき","romaji":"negitoromaki"},{"kana":"ちらしずし","romaji":"chirashizushi"},{"kana":"おしずし","romaji":"oshizushi"},{"kana":"はこずし","romaji":"hakozushi"},{"kana":"さばずし","romaji":"sabazushi"},{"kana":"あなきゅう","romaji":"anakyuu"},{"kana":"てっかどん","romaji":"tekkadon"},{"kana":"だしまき","romaji":"dashimaki"},{"kana":"たまごやき","romaji":"tamagoyaki"},{"kana":"ちゃわんむし","romaji":"chawanmushi"},{"kana":"あらじる","romaji":"arajiru"},{"kana":"しらす","romaji":"shirasu"},{"kana":"かんぴょう","romaji":"kanpyou"},{"kana":"ひかりもの","romaji":"hikarimono"},{"kana":"ぎょくにぎり","romaji":"gyokunigiri"},{"kana":"あおさ","romaji":"aosa"}]};
const SUSHI_ALIASES: Record<string,string[]> = {"ぁ":["xa","la"],"ぃ":["xi","li"],"ぅ":["xu","lu"],"ぇ":["xe","le"],"ぉ":["xo","lo"],"し":["shi","si"],"じ":["ji","zi"],"ち":["chi","ti"],"ぢ":["ji","di","zi"],"っ":["xtu","ltu","xtsu","ltsu"],"つ":["tsu","tu"],"づ":["zu","du"],"ふ":["fu","hu"],"ゃ":["xya","lya"],"ゅ":["xyu","lyu"],"ょ":["xyo","lyo"],"ん":["nn","n","xn","ln"],"ゔ":["vu"],"ー":["-"],"うぃ":["wi"],"うぇ":["we"],"きゃ":["kya"],"きゅ":["kyu"],"きょ":["kyo"],"ぎゃ":["gya"],"ぎゅ":["gyu"],"ぎょ":["gyo"],"しぇ":["she"],"しゃ":["sha","sya"],"しゅ":["shu","syu"],"しょ":["sho","syo"],"じぇ":["je"],"じゃ":["ja","jya","zya"],"じゅ":["ju","jyu","zyu"],"じょ":["jo","jyo","zyo"],"ちぇ":["che"],"ちゃ":["cha","tya","cya"],"ちゅ":["chu","tyu","cyu"],"ちょ":["cho","tyo","cyo"],"ぢゃ":["dya"],"ぢゅ":["dyu"],"ぢょ":["dyo"],"つぁ":["tsa"],"つぃ":["tsi"],"つぇ":["tse"],"つぉ":["tso"],"てぃ":["thi"],"てゅ":["thu"],"でぃ":["dhi"],"でゅ":["dhu"],"にゃ":["nya"],"にゅ":["nyu"],"にょ":["nyo"],"ひゃ":["hya"],"ひゅ":["hyu"],"ひょ":["hyo"],"びゃ":["bya"],"びゅ":["byu"],"びょ":["byo"],"ぴゃ":["pya"],"ぴゅ":["pyu"],"ぴょ":["pyo"],"ふぁ":["fa"],"ふぃ":["fi"],"ふぇ":["fe"],"ふぉ":["fo"],"ふゃ":["fya"],"ふゅ":["fyu"],"ふょ":["fyo"],"みゃ":["mya"],"みゅ":["myu"],"みょ":["myo"],"りゃ":["rya"],"りゅ":["ryu"],"りょ":["ryo"],"ゔぁ":["va"],"ゔぃ":["vi"],"ゔぇ":["ve"],"ゔぉ":["vo"]};
const SUSHI_KANA_MAP: Record<string,string> = {"あ":"a","い":"i","う":"u","え":"e","お":"o","か":"ka","が":"ga","き":"ki","ぎ":"gi","く":"ku","ぐ":"gu","け":"ke","げ":"ge","こ":"ko","ご":"go","さ":"sa","ざ":"za","す":"su","ず":"zu","せ":"se","ぜ":"ze","そ":"so","ぞ":"zo","た":"ta","だ":"da","て":"te","で":"de","と":"to","ど":"do","な":"na","に":"ni","ぬ":"nu","ね":"ne","の":"no","は":"ha","ば":"ba","ぱ":"pa","ひ":"hi","び":"bi","ぴ":"pi","ふ":"fu","ぶ":"bu","ぷ":"pu","へ":"he","べ":"be","ぺ":"pe","ほ":"ho","ぼ":"bo","ぽ":"po","ま":"ma","み":"mi","む":"mu","め":"me","も":"mo","や":"ya","ゆ":"yu","よ":"yo","ら":"ra","り":"ri","る":"ru","れ":"re","ろ":"ro","わ":"wa","を":"wo","♾ 上限なし！ ":"⏱ "};
const SUSHI_CFG: Record<string,{gain:number;fever:number;gold:number;miss:number;bonus:number}> = {
  normal:{gain:10,fever:15,gold:10,miss:10,bonus:5},
  sudden:{gain:10,fever:15,gold:10,miss:10,bonus:5},
  endless:{gain:25,fever:35,gold:15,miss:10,bonus:8},
};
function sushiNormalizeKana(value:string) {
  return value.replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
}
function sushiTokensOf(value:string) {
  const units:string[]=[];
  for(let i=0;i<value.length;) {
    let part:string|null=null;
    for(const n of [2,1]) {
      const candidate=value.slice(i,i+n);
      if(SUSHI_ALIASES[candidate]||(n===1&&SUSHI_KANA_MAP[candidate])) {part=candidate;break;}
    }
    if(!part) part=value[i];
    units.push(part); i+=part.length;
  }
  return units;
}
function sushiRomajiOf(unit:string) {
  return SUSHI_ALIASES[unit]||(SUSHI_KANA_MAP[unit]?[SUSHI_KANA_MAP[unit]]:[unit]);
}
function sushiVariants(kana:string) {
  const units=sushiTokensOf(sushiNormalizeKana(kana));
  let out=[{s:""}];
  for(let k=0;k<units.length;k++) {
    const unit=units[k],next=units[k+1];
    let opts:string[];
    if(unit==="っ") {
      const firsts=next?sushiRomajiOf(next).map(r=>r[0]).filter(c=>c&&!"aiueonyx".includes(c)):[];
      opts=firsts.length?Array.from(new Set(firsts)):SUSHI_ALIASES["っ"];
    } else if(unit==="ん") opts=["nn","xn"];
    else opts=sushiRomajiOf(unit);
    const nextOut:Array<{s:string}>=[];
    for(const prefix of out) for(const option of opts||[]) nextOut.push({s:prefix.s+option});
    out=nextOut;
    if(out.length>2048) throw new HttpError(400,"単語の入力パターンが多すぎます。");
  }
  const seen=new Set<string>();
  return out.filter(item=>!seen.has(item.s)&&!!seen.add(item.s)).map(item=>item.s);
}
function sushiShuffle<T>(items:T[]) {
  const out=items.slice();
  for(let i=out.length-1;i>0;i--) {
    const j=primeRandomIndex(i+1);
    [out[i],out[j]]=[out[j],out[i]];
  }
  return out;
}
function sushiNextWord(state:Record<string,any>) {
  const bank=SUSHI_WORD_BANK[String(state.level)] as Array<{kana:string;romaji:string}>;
  if(!Array.isArray(bank)||!bank.length) throw new HttpError(400,"寿司タイピングのコースが正しくありません。");
  if(!Array.isArray(state.wordQueue)||state.wordCursor>=state.wordQueue.length) {
    state.wordQueue=sushiShuffle(bank.map((_,index)=>index));
    state.wordCursor=0;
  }
  const word=bank[Number(state.wordQueue[state.wordCursor++])];
  if(!word) throw new HttpError(500,"単語データを読み込めません。");
  state.currentWord={kana:word.kana,romaji:word.romaji};
  state.wordStartedAt=Date.now();
  return state.currentWord;
}
function sushiTimeLeft(session:Record<string,any>,state:Record<string,any>) {
  const elapsed=Math.max(0,Date.now()-Date.parse(session.started_at));
  return Math.max(0,60000+Math.max(0,Number(state.timeAdjustment)||0)*1000-elapsed);
}
function sushiSnapshot(state:Record<string,any>,session:Record<string,any>,nonce:string) {
  return {
    nonce,score:Number(state.score)||0,miss:Number(state.miss)||0,combo:Number(state.combo)||0,
    maxCombo:Number(state.maxCombo)||0,completed:Number(state.completed)||0,
    gauge:Number(state.gauge)||0,gaugeLevel:Number(state.gaugeLevel)||0,
    diffValue:Number(state.diffValue)||0,timeLeft:Math.round(sushiTimeLeft(session,state)/100)/10,
  };
}
function sushiRandomChance(percent:number) {
  const buffer=new Uint32Array(1);crypto.getRandomValues(buffer);
  return (buffer[0]%10000)<percent*100;
}
async function sushiRecordCompletedRun(userId:string,session:Record<string,any>) {
  const state=session.state&&typeof session.state==="object"?session.state as Record<string,any>:{};
  const score=Math.max(0,Math.floor(Number(state.score)||0));
  const mode=String(state.mode||"normal"),level=String(state.level||"beginner"),rankingMode=mode+"_"+level;
  if(!SUSHI_CFG[mode]||!SUSHI_WORD_BANK[level]) throw new HttpError(400,"寿司タイピングの記録形式が正しくありません。");
  const durationMs=Math.max(0,Math.min(10*60*1000,Date.now()-Date.parse(session.started_at)));
  const metadata={
    metric:"score",source:"sushi-typing-server",serverVerified:"sushi-typing-v1",
    mode,level,completed:Number(state.completed)||0,miss:Number(state.miss)||0,
    maxCombo:Number(state.maxCombo)||0,durationMs,sessionId:session.id,
  };
  if(score>0) {
    const {error:scoreError}=await admin.rpc("kuro_submit_game_score",{
      p_game_id:SUSHI_GAME_ID,p_user_id:userId,p_mode:rankingMode,p_score:score,
      p_submission_id:session.id,p_metadata:metadata,p_level:null,p_cpu_difficulty:null,
    });
    if(scoreError) {
      console.error("[kurogames-online] verified Sushi score save failed",scoreError);
      throw new HttpError(500,"回転ずしタイピングのランキングを保存できませんでした。");
    }
    const {error:eventError}=await admin.rpc("kuro_record_user_game_event",{
      p_submission_id:session.id,p_user_id:userId,p_game_id:SUSHI_GAME_ID,
      p_mode:rankingMode,p_result:"played",p_score:score,p_duration_ms:durationMs,p_metadata:metadata,
    });
    if(eventError) {
      console.error("[kurogames-online] verified Sushi event save failed",eventError);
      throw new HttpError(500,"回転ずしタイピングの統合記録を保存できませんでした。");
    }
  }
  const {error:markError}=await admin.from("game_verification_sessions")
    .update({score_recorded:true,score_recovery_status:"recorded"})
    .eq("id",session.id).eq("game_id",SUSHI_GAME_ID).eq("user_id",userId).eq("status","completed");
  if(markError) throw new HttpError(500,"回転ずしタイピングの記録状態を更新できません。");
  return {scoreRecorded:score>0,score};
}


async function setVerifiedSessionRecoveryStatus(
  session: Record<string, any>,
  userId: string,
  gameId: string,
  status: "recorded" | "not_rankable",
) {
  const { error } = await admin.from("game_verification_sessions")
    .update({ score_recovery_status: status })
    .eq("id", session.id)
    .eq("game_id", gameId)
    .eq("user_id", userId)
    .eq("status", "completed");
  if (error) {
    console.warn("[kurogames-online] verified session recovery status update failed", {
      sessionId: session.id, status, error,
    });
  }
}

function isPermanentVerifiedRecoveryError(error: { message?: string } | null) {
  const message = String(error?.message || "");
  return /INVALID_(?:ELAPSED_TIME|LEVEL|MODE|VERIFICATION_METADATA|CPU_DIFFICULTY|RESULT|RULE)|VERIFIED_(?:SESSION_NOT_FOUND|TICTACTOE_SESSION_NOT_FOUND)/.test(message);
}

async function reconcilePendingVerifiedSessions(userId:string,gameId:string) {
  const {data:pending,error} = await admin.from("game_verification_sessions")
    .select("*")
    .eq("game_id",gameId)
    .eq("user_id",userId)
    .eq("status","completed")
    .eq("score_recorded",false)
    .eq("score_recovery_status","pending")
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
        const playMode=String(session.state?.playMode ?? "");
        if(playMode!=="time" || session.result!=="correct" ||
          !Object.prototype.hasOwnProperty.call(NUMBER_LEVELS,level)) {
          await setVerifiedSessionRecoveryStatus(session,userId,gameId,"not_rankable");
          continue;
        }

        const startedAt=Date.parse(String(session.started_at || ""));
        const completedAt=Date.parse(String(session.completed_at || ""));
        const elapsedMs=completedAt-startedAt;
        if(!Number.isFinite(startedAt) || !Number.isFinite(completedAt) ||
          !Number.isSafeInteger(elapsedMs) || elapsedMs<400 || elapsedMs>3600000) {
          await setVerifiedSessionRecoveryStatus(session,userId,gameId,"not_rankable");
          continue;
        }

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
          if(isPermanentVerifiedRecoveryError(recordError)) {
            await setVerifiedSessionRecoveryStatus(session,userId,gameId,"not_rankable");
          } else {
            console.warn("[kurogames-online] pending number score recovery failed",recordError);
          }
          continue;
        }
        await setVerifiedSessionRecoveryStatus(session,userId,gameId,"recorded");
      } else if(gameId===PRIME_GAME_ID && session.game_type==="prime_factor") {
        if(session.result!=="completed" || !["easy","normal","hard"].includes(String(session.state?.difficulty))) {
          await setVerifiedSessionRecoveryStatus(session,userId,gameId,"not_rankable");
          continue;
        }
        await primeRecordCompletedRun(userId,session);
      } else if(gameId===SUSHI_GAME_ID && session.game_type==="sushi_typing") {
        if(session.result!=="completed" || !SUSHI_CFG[String(session.state?.mode)] || !SUSHI_WORD_BANK[String(session.state?.level)]) {
          await setVerifiedSessionRecoveryStatus(session,userId,gameId,"not_rankable");
          continue;
        }
        await sushiRecordCompletedRun(userId,session);
      } else if(gameId===TICTACTOE_GAME_ID && session.game_type==="tictactoe") {
        if(!["win","loss","draw"].includes(String(session.result)) ||
          !["normal","vanish","gobble","reverse"].includes(String(session.mode)) ||
          !["easy","normal","hard"].includes(String(session.state?.difficulty))) {
          await setVerifiedSessionRecoveryStatus(session,userId,gameId,"not_rankable");
          continue;
        }
        const {error:recordError}=await admin.rpc("kuro_record_verified_tictactoe_result",{
          p_game_id:gameId,
          p_user_id:userId,
          p_rule:session.mode,
          p_result:session.result,
          p_submission_id:session.id,
          p_cpu_difficulty:String(session.state.difficulty).toUpperCase(),
        });
        if(recordError) {
          if(isPermanentVerifiedRecoveryError(recordError)) {
            await setVerifiedSessionRecoveryStatus(session,userId,gameId,"not_rankable");
          } else {
            console.warn("[kurogames-online] pending tic-tac-toe result recovery failed",recordError);
          }
          continue;
        }
        await setVerifiedSessionRecoveryStatus(session,userId,gameId,"recorded");
      }
    } catch(error) {
      console.warn("[kurogames-online] pending verified session recovery failed",error);
    }
  }
}


async function loadHardTictactoeStats(gameId: string, rule: string | null = null) {
  const PAGE_SIZE = 1000;
  const events: Array<{ user_id: string; result: string; created_at: string; submission_id: string }> = [];
  for (let offset = 0; offset < 50000; offset += PAGE_SIZE) {
    let query = admin.from("game_tictactoe_verified_events")
      .select("user_id,result,created_at,submission_id")
      .eq("game_id", gameId)
      .eq("cpu_difficulty", "HARD")
      .order("created_at", { ascending: true })
      .order("submission_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (rule) query = query.eq("rule", rule);
    const { data, error } = await query;
    if (error) {
      console.error("[kurogames-online] hard CPU tic-tac-toe event read failed", error);
      throw new HttpError(500, "〇✕ゲームの最強CPUランキング記録を取得できませんでした。");
    }
    const page = (data ?? []) as typeof events;
    events.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const byUser = new Map<string, {
    user_id: string; played: number; wins: number; losses: number; draws: number;
    current_streak: number; best_streak: number; updated_at: string;
  }>();
  for (const event of events) {
    let stats = byUser.get(event.user_id);
    if (!stats) {
      stats = {
        user_id: event.user_id, played: 0, wins: 0, losses: 0, draws: 0,
        current_streak: 0, best_streak: 0, updated_at: event.created_at,
      };
      byUser.set(event.user_id, stats);
    }
    stats.played += 1;
    if (event.result === "win") {
      stats.wins += 1;
      stats.current_streak += 1;
      stats.best_streak = Math.max(stats.best_streak, stats.current_streak);
    } else {
      if (event.result === "loss") stats.losses += 1;
      else if (event.result === "draw") stats.draws += 1;
      stats.current_streak = 0;
    }
    stats.updated_at = event.created_at;
  }
  return Array.from(byUser.values());
}

async function loadHardUnonSoloScores(gameId: string, limit: number) {
  // Hard CPU wins are kept as a separate aggregate row, not as play-by-play events.
  const { data, error } = await admin.from("kuro_game_user_stats")
    .select("user_id, wins, mode, last_played_at, updated_at, metadata")
    .eq("game_id", gameId)
    .eq("mode", "wins-solo-hard")
    .contains("metadata", { metric: "wins", source: "unon-solo-server", serverVerified: "unon-solo-v1", cpuDifficulty: "hard" })
    .gt("wins", 0)
    .order("wins", { ascending: false })
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.error("[kurogames-online] UNON hard CPU aggregate read failed", error);
    throw new HttpError(500, "UNONの最強CPUランキング記録を取得できませんでした。");
  }
  return (data ?? []).map((row) => ({
    user_id: row.user_id,
    score: Number(row.wins) || 0,
    mode: "wins-solo",
    created_at: row.last_played_at || row.updated_at,
  }));
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
  // KURO COIN is account-wide and does not depend on a particular game ID or ranking flag.
  if (action === "coin_summary") {
    await getUser(req);
    const authorization = req.headers.get("Authorization") || "";
    let upstream: Response;
    try {
      upstream = await fetch("https://kurolab.cc.cd/api/kuro-d1/coin-summary", {
        headers: { "Authorization": authorization, "Accept": "application/json" },
        signal: AbortSignal.timeout(10000)
      });
    } catch (_) {
      throw new HttpError(503, "CloudflareからKURO COIN情報を取得できませんでした。");
    }
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) throw new HttpError(upstream.status >= 500 ? 503 : upstream.status, result?.error || "KURO COINの残高を取得できませんでした。");
    return reply(200, {
      currency: "KC",
      balance: Number(result.balance) || 0,
      updatedAt: result.updatedAt || null,
      transactions: Array.isArray(result.transactions) ? result.transactions : [],
      source: "cloudflare-d1"
    });
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
    const cosmeticsByUser = await getEquippedCosmeticsForUsers([user.id]);
    return reply(200, {
      profile: {
        cosmetics: cosmeticsByUser.get(user.id) ?? {},
        kuroId: profile.kuro_id,
        username: profile.username,
        displayName: profile.username,
        avatarUrl: profile.avatar_url,
      },
    });
  }

  if (action === "record_result") {
    const user = await getUser(req);
    requirePublished(game);
    requireFeature(settings.features, "ranking");

    const mode = safeMode(body.mode);
    if (game.id === DAIFUGO_GAME_ID && mode === "wins-bot") {
      throw new HttpError(403, "大富豪のCPU戦ランキングはサーバー検証方式への移行中です。オンライン対戦の勝利数はこれまでどおり登録できます。");
    }
    if (game.id === UNON_GAME_ID && mode === "wins-solo") {
      throw new HttpError(403, "UNONのCPU戦ランキングはサーバー検証方式への移行中です。オンライン対戦の勝利数はこれまでどおり登録できます。");
    }
    const result = body.result === "loss" ? "loss" : null;
    const submissionId = typeof body.submissionId === "string" && UUID_RE.test(body.submissionId)
      ? body.submissionId
      : null;
    const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : {};
    if (!result || !submissionId) {
      throw new HttpError(400, "敗北結果には有効なsubmissionIdとresult=lossが必要です。");
    }
    if (new TextEncoder().encode(JSON.stringify(metadata)).length > 8192) {
      throw new HttpError(400, "追加データは8KB以内にしてください。");
    }

    let trustedSource = "";
    if (game.id === UNON_GAME_ID && mode === "wins-online") {
      if (metadata.source !== "unon-online" || metadata.matchId !== submissionId ||
          typeof metadata.roomId !== "string" || typeof metadata.lossProof !== "string") {
        throw new HttpError(400, "UNONオンラインの敗北記録データが正しくありません。");
      }
      const claims = await verifyUnonWinProof(metadata.lossProof);
      if (!claims || claims.typ !== "unon_loss" || claims.sub !== user.id ||
          claims.game !== game.id || claims.match !== submissionId || claims.room !== metadata.roomId) {
        throw new HttpError(403, "サーバーが確認した敗北記録ではありません。");
      }
      trustedSource = "unon-online-server-proof";

    } else {
      throw new HttpError(403, "このモードの結果は対戦サーバー、または専用の記録処理からのみ登録できます。");
    }

    const safeMetadata = {
      source: trustedSource,
      metric: "wins",
      clientResult: trustedSource.endsWith("client-result"),
      serverVerified: trustedSource.endsWith("server-proof"),
      matchId: submissionId,
      ...(game.id === UNON_GAME_ID && mode === "wins-solo"
        ? { cpuDifficulty: "hard", difficulty: "hard", players: Number(metadata.players) }
        : {}),
      ...(game.id === "2eb37847-1b7e-43e4-ad98-901d5b830ac4"
        ? { opponentMode: "bot" }
        : {}),
    };
    const { data: recorded, error } = await admin.rpc("kuro_record_user_game_event", {
      p_submission_id: submissionId,
      p_user_id: user.id,
      p_game_id: game.id,
      p_mode: mode,
      p_result: "loss",
      p_score: null,
      p_duration_ms: null,
      p_metadata: safeMetadata,
    });
    if (error) {
      console.error("[kurogames-online] result aggregate write failed", error);
      throw new HttpError(500, "敗北回数を保存できませんでした。");
    }

    // Mirror Hard-only UNON solo losses into the hidden mode used for its private aggregate.
    if (game.id === UNON_GAME_ID && mode === "wins-solo") {
      const { error: hardStatsError } = await admin.rpc("kuro_record_user_game_event", {
        p_submission_id: submissionId,
        p_user_id: user.id,
        p_game_id: game.id,
        p_mode: "wins-solo-hard",
        p_result: "loss",
        p_score: null,
        p_duration_ms: null,
        p_metadata: {
          metric: "wins",
          source: "unon-solo",
          cpuDifficulty: "hard",
          difficulty: "hard",
          players: Number(metadata.players),
          internalRankingMode: true,
        },
      });
      if (hardStatsError) {
        console.error("[kurogames-online] UNON hard CPU loss aggregate save failed", hardStatsError);
        throw new HttpError(500, "UNON最強CPUの敗北記録を保存できませんでした。");
      }
    }
    return reply(200, { ok: true, recorded: recorded === true, duplicate: recorded === false });
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
    return reply(200, { stats: (data || []).filter((row) => row.metadata?.internalRankingMode !== true), allGames });
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
    return reply(200, { stats: (data || []).filter((row) => row.metadata?.internalRankingMode !== true), events: [], deprecated: true, allGames });
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
    const { data: aggregateRows, error: aggregateError } = await admin
      .from("kuro_game_user_stats")
      .select("mode,metric,metadata")
      .eq("game_id", game.id)
      .limit(5000);
    if (aggregateError) throw new HttpError(500, "ランキングモードを取得できませんでした。");

    let modes: string[];
    if (KNOWN_RANKING_MODES[game.id]) {
      modes = [...KNOWN_RANKING_MODES[game.id]];
    } else {
      const { data: scoreRows, error: scoreError } = await admin
        .from("game_scores")
        .select("mode")
        .eq("game_id", game.id)
        .limit(5000);
      if (scoreError) throw new HttpError(500, "ランキングモードを取得できませんでした。");
      modes = Array.from(new Set([
        ...(scoreRows ?? []).map((row) => row.mode),
        ...(aggregateRows ?? []).filter((row) => row.metadata?.internalRankingMode !== true).map((row) => row.mode),
      ].filter((mode) => typeof mode === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(mode)))).sort();
    }
    const modeMetrics: Record<string, string> = {};
    for (const mode of modes) {
      const metrics = Array.from(new Set((aggregateRows ?? [])
        .filter((row) => row.mode === mode && row.metadata?.internalRankingMode !== true)
        .map((row) => String(row.metric || "score"))));
      if (metrics.length === 1) modeMetrics[mode] = metrics[0];
    }
    return reply(200, {
      modes: modes.length ? modes : ["default"],
      modeMetrics,
      showcaseConfig: sanitizeRankingShowcaseConfig(settings.features.rankingShowcaseConfig),
    });
  }

  if (action === "leaderboard") {
    // Public read-only rankings; score submission remains authenticated.
    requirePublished(game);
    requireFeature(settings.features, "ranking");
    const mode = safeMode(body.mode);
    if (game.id === DAIFUGO_GAME_ID && mode === "wins-bot") {
      // CPU bot actions are still client-simulated. Keep legacy client claims out of the public ranking.
      return reply(200, { mode, scores: [], serverVerified: true, unavailableReason: "CPU戦のサーバー検証移行中です。" });
    }
    if (game.id === UNON_GAME_ID && !(KNOWN_RANKING_MODES[game.id] ?? []).includes(mode)) {
      throw new HttpError(400, "UNONのランキングは勝利回数のみです。");
    }
    const limit = Math.max(1, Math.min(100, Number.isFinite(Number(body.limit)) ? Math.floor(Number(body.limit)) : 20));
    // Time rankings use lower measured values as better results.
    const isTimeRanking = /(^|[_-])(time|duration|elapsed|seconds?|milliseconds?|ms|fastest|clear_time)([_-]|$)/i.test(mode);
    if (game.id === NUMBER_GAME_ID) {
      if (!(KNOWN_RANKING_MODES[game.id] ?? []).includes(mode)) {
        throw new HttpError(400, "数字当てのランキングモードが正しくありません。");
      }
      const rankingViewer = await getOptionalUser(req);
      if (rankingViewer) await reconcilePendingVerifiedSessions(rankingViewer.id, game.id);
    }
    if (game.id === TICTACTOE_GAME_ID || game.id === PRIME_GAME_ID) {
      const rankingViewer = await getOptionalUser(req);
      if (rankingViewer) await reconcilePendingVerifiedSessions(rankingViewer.id, game.id);
    }

    // Tic-Tac-Toe win rankings use the shared user/game/mode aggregate.
    // The dedicated verified stats table remains the source for streak and win-rate views.
    // 〇✕ゲームはCPU最強（HARD）でサーバー確定した対局だけを公開ランキングへ集計する。
    if (game.id === TICTACTOE_GAME_ID) {
      if (!["normal", "vanish", "gobble", "reverse"].includes(mode)) {
        throw new HttpError(400, "ランキングルールが正しくありません。");
      }
      const aggregates = await loadHardTictactoeStats(game.id, mode);
      const ranked = aggregates
        .filter((row) => row.wins > 0)
        .sort((a, b) => b.wins - a.wins || String(a.updated_at).localeCompare(String(b.updated_at)))
        .slice(0, limit);
      const ids = Array.from(new Set(ranked.map((row) => row.user_id)));
      const profileMap = new Map<string, { kuro_id: string; username: string; avatar_url: string | null }>();
      if (ids.length) {
        const { data: profiles, error: profileError } = await admin.from("profiles")
          .select("id,kuro_id,username,avatar_url")
          .in("id", ids);
        if (profileError) throw new HttpError(500, "ランキング参加者のプロフィールを取得できませんでした。");
        for (const profile of profiles ?? []) {
          profileMap.set(profile.id, {
            kuro_id: profile.kuro_id ?? "",
            username: profile.username ?? "プレイヤー",
            avatar_url: profile.avatar_url ?? null,
          });
        }
      }
      return reply(200, {
        mode,
        metric: "wins",
        cpuDifficulty: "HARD",
        scores: ranked.map((row, index) => {
          const profile = profileMap.get(row.user_id) ?? { kuro_id: "", username: "プレイヤー", avatar_url: null };
          return {
            rank: index + 1,
            userId: row.user_id,
            score: row.wins,
            mode,
            metric: "wins",
            createdAt: row.updated_at,
            recordType: "verified-hard-cpu",
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

    if (game.id === UNON_GAME_ID && mode === "wins-solo") {
      const hardScores = await loadHardUnonSoloScores(game.id, limit);
      const ids = Array.from(new Set(hardScores.map((row) => row.user_id)));
      const profileMap = new Map<string, { kuro_id: string; username: string; avatar_url: string | null }>();
      if (ids.length) {
        const { data: profiles, error: profileError } = await admin.from("profiles")
          .select("id,kuro_id,username,avatar_url")
          .in("id", ids);
        if (profileError) throw new HttpError(500, "ランキング参加者のプロフィールを取得できませんでした。");
        for (const profile of profiles ?? []) {
          profileMap.set(profile.id, {
            kuro_id: profile.kuro_id ?? "",
            username: profile.username ?? "プレイヤー",
            avatar_url: profile.avatar_url ?? null,
          });
        }
      }
      return reply(200, {
        mode,
        metric: "wins",
        cpuDifficulty: "hard",
        scores: hardScores.map((row, index) => {
          const profile = profileMap.get(row.user_id) ?? { kuro_id: "", username: "プレイヤー", avatar_url: null };
          return {
            rank: index + 1,
            userId: row.user_id,
            score: row.score,
            mode,
            metric: "wins",
            createdAt: row.created_at,
            recordType: "hard-cpu",
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
        .select("user_id, mode, best_time_us, last_played_at, updated_at")
        .eq("game_id", game.id)
        .eq("mode", mode)
        .contains("metadata", { verifiedRanking: "number-guess-v1" })
        .gte("best_time_us", 400000)
        .lte("best_time_us", 3600000000)
        .order("best_time_us", { ascending: true })
        .limit(limit);
      if (verifiedError) throw new HttpError(500, "検証済みランキングを取得できませんでした。");
      scores = (verifiedScores ?? []).map((row) => ({
        user_id: row.user_id,
        score: Number(row.best_time_us),
        mode: row.mode,
        metric: "time_us",
        created_at: row.last_played_at || row.updated_at,
        recordType: "verified",
      }));
    } else {
      // Normal rankings are read from the single aggregate row per user/game/mode.
      // The verified TicTacToe and Number Guess branches above intentionally retain
      // their specialized trusted sources and validation rules.
      let metricQuery = admin.from("kuro_game_user_stats")
        .select("metric")
        .eq("game_id", game.id)
        .eq("mode", mode)
        .limit(5000);
      if (game.id === PRIME_GAME_ID) {
        metricQuery = metricQuery.contains("metadata", {
          source: "prime-factor-server",
          serverVerified: "prime-breaker-v1",
        });
      } else if (game.id === SUSHI_GAME_ID) {
        metricQuery = metricQuery.contains("metadata", {
          source: "sushi-typing-server",
          serverVerified: "sushi-typing-v1",
        });
      }
      const { data: metricRows, error: metricError } = await metricQuery;
      if (metricError) throw new HttpError(500, "ランキング指標を取得できませんでした。");

      const metricCounts = new Map<string, number>();
      for (const row of metricRows ?? []) {
        const metric = ["wins", "score", "time"].includes(String(row.metric)) ? String(row.metric) : "score";
        metricCounts.set(metric, (metricCounts.get(metric) || 0) + 1);
      }
      // A mode has one metric. Legacy rows with conflicting metrics are excluded
      // rather than comparing wins, scores and milliseconds in the same ranking.
      const preferredMetric = isTimeRanking ? "time" : "";
      const metricOrder = ["score", "wins", "time"];
      const canonicalMetric = preferredMetric || Array.from(metricCounts.entries())
        .sort((a, b) => b[1] - a[1] || metricOrder.indexOf(a[0]) - metricOrder.indexOf(b[0]))[0]?.[0] || "score";
      if (metricCounts.size > 1) {
        console.warn("[kurogames-online] mixed legacy ranking metrics; excluded non-canonical rows", {
          gameId: game.id, mode, canonicalMetric, metrics: Object.fromEntries(metricCounts),
        });
      }

      let rankingQuery = admin.from("kuro_game_user_stats")
        .select("user_id,mode,metric,wins,best_score,best_time_ms,last_played_at,created_at,updated_at,metadata")
        .eq("game_id", game.id)
        .eq("mode", mode)
        .eq("metric", canonicalMetric);
      if (game.id === PRIME_GAME_ID) {
        rankingQuery = rankingQuery.contains("metadata", {
          source: "prime-factor-server",
          serverVerified: "prime-breaker-v1",
        });
      } else if (game.id === SUSHI_GAME_ID) {
        rankingQuery = rankingQuery.contains("metadata", {
          source: "sushi-typing-server",
          serverVerified: "sushi-typing-v1",
        });
      }
      const orderColumn = canonicalMetric === "wins" ? "wins"
        : canonicalMetric === "time" ? "best_time_ms"
        : "best_score";
      if (canonicalMetric === "wins") rankingQuery = rankingQuery.gt("wins", 0);
      else rankingQuery = rankingQuery.not(orderColumn, "is", null);
      const { data, error } = await rankingQuery
        .order(orderColumn, { ascending: canonicalMetric === "time" })
        .order("updated_at", { ascending: true })
        .limit(limit);
      if (error) throw new HttpError(500, "集計ランキングを取得できませんでした。");

      scores = (data ?? []).map((row: any) => ({
        user_id: row.user_id,
        score: Number(canonicalMetric === "wins" ? row.wins
          : canonicalMetric === "time" ? row.best_time_ms
          : row.best_score),
        mode: row.mode,
        metric: canonicalMetric,
        created_at: row.last_played_at || row.updated_at || row.created_at,
      })).filter((row: any) => Number.isFinite(row.score) && (canonicalMetric !== "wins" || row.score > 0));
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
      metric: (scores ?? [])[0]?.metric || (isTimeRanking ? "time" : "score"),
      scores: (scores ?? []).map((row, index) => {
        const profile = profileMap.get(row.user_id) ?? { kuro_id: "", username: "プレイヤー", avatar_url: null };
        return {
          rank: index + 1,
          userId: row.user_id,
          score: row.score,
          mode: row.mode,
          metric: row.metric || (isTimeRanking ? "time" : "score"),
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

    const statsRows = await loadHardTictactoeStats(game.id, rule);
    const mergedStats = new Map<string, any>();
    for (const row of statsRows) mergedStats.set(row.user_id, {
      user_id: row.user_id,
      played: Number(row.played) || 0,
      wins: Number(row.wins) || 0,
      losses: Number(row.losses) || 0,
      draws: Number(row.draws) || 0,
      current_streak: Number(row.current_streak) || 0,
      best_streak: Number(row.best_streak) || 0,
      updated_at: row.updated_at,
      recordType: "verified-hard-cpu",
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
      .filter(entry => metric === "wins" ? entry.wins > 0 : metric === "win_rate" ? entry.played >= 10 : true)
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




  if (action === "sushi_start") {
    const user=await getUser(req);
    requirePublished(game);
    requireFeature(settings.features,"ranking");
    if(game.id!==SUSHI_GAME_ID) throw new HttpError(404,"回転ずしタイピングの認証先ではありません。");
    const mode=typeof body.mode==="string"?body.mode.trim():"normal";
    const level=typeof body.level==="string"?body.level.trim():"beginner";
    if(!SUSHI_CFG[mode]||!SUSHI_WORD_BANK[level]) throw new HttpError(400,"ゲームモードまたはコースが正しくありません。");
    const {error:expireError}=await admin.from("game_verification_sessions").update({status:"expired"})
      .eq("game_id",game.id).eq("user_id",user.id).eq("game_type","sushi_typing").eq("status","active");
    if(expireError) throw new HttpError(500,"前の寿司タイピングセッションを終了できませんでした。");
    const state={
      mode,level,score:0,miss:0,combo:0,maxCombo:0,completed:0,
      gauge:0,gaugeLevel:0,diffValue:0,timeAdjustment:0,suddenEnded:false,
      wordQueue:sushiShuffle(SUSHI_WORD_BANK[level].map((_:unknown,index:number)=>index)),
      wordCursor:0,wordStartedAt:Date.now(),currentWord:null,
    };
    const currentWord=sushiNextWord(state);
    const {data,error}=await admin.from("game_verification_sessions").insert({
      game_id:game.id,user_id:user.id,game_type:"sushi_typing",mode:mode+"_"+level,state,status:"active",
    }).select("id,nonce,started_at").single();
    if(error?.code==="23505") throw new HttpError(409,"別の寿司タイピングが同時に開始されました。");
    if(error||!data) throw new HttpError(500,"回転ずしタイピングを開始できませんでした。");
    const session={...data,started_at:data.started_at};
    return reply(200,{ok:true,sessionId:data.id,currentWord,...sushiSnapshot(state,session,data.nonce),serverVerified:true});
  }

  if (action === "sushi_word") {
    const user=await getUser(req);
    requirePublished(game);
    requireFeature(settings.features,"ranking");
    if(game.id!==SUSHI_GAME_ID) throw new HttpError(404,"回転ずしタイピングの認証先ではありません。");
    const session=await loadVerifiedSession(user.id,body.sessionId,body.nonce,game.id,"sushi_typing");
    const state=cloneGameState(session.state as Record<string,any>);
    if(state.suddenEnded===true) throw new HttpError(409,"一発勝負は終了しています。");
    if(sushiTimeLeft(session,state)<=0) throw new HttpError(410,"制限時間が終了しました。");
    const answer=typeof body.answer==="string"?body.answer.trim().toLowerCase():"";
    if(!answer||!sushiVariants(String(state.currentWord?.kana||"")).includes(answer)) {
      throw new HttpError(400,"入力内容が現在の単語と一致しません。");
    }
    const elapsed=Math.max(0,Date.now()-Number(state.wordStartedAt||Date.now()));
    const minElapsed=Math.max(300,Math.min(1800,String(state.currentWord?.romaji||"").length*45));
    if(elapsed<minElapsed) throw new HttpError(429,"入力速度の確認中です。少しだけ待ってから次の単語を確定してください。");
    const config=SUSHI_CFG[String(state.mode)];
    const fever=Number(state.combo||0)>=10;
    const gold=sushiRandomChance(10);
    let gain=10+Math.min(Number(state.combo)||0,20);
    if(fever) gain*=2;
    if(gold) gain+=50;
    state.score=(Number(state.score)||0)+gain;
    state.combo=(Number(state.combo)||0)+1;
    state.maxCombo=Math.max(Number(state.maxCombo)||0,state.combo);
    state.completed=(Number(state.completed)||0)+1;
    const rate=state.mode==="endless"
      ? Math.max(.1,1-.9*(Number(state.diffValue)||0)/100)
      : Math.max(.5,1-.1*(Number(state.gaugeLevel)||0));
    state.gauge=(Number(state.gauge)||0)+((fever?config.fever:config.gain)+(gold?config.gold:0))*rate;
    let extended=false;
    if(state.gauge>=100) {
      state.gauge-=100;
      state.gaugeLevel=(Number(state.gaugeLevel)||0)+1;
      state.timeAdjustment=(Number(state.timeAdjustment)||0)+config.bonus;
      extended=true;
      if(state.mode==="endless") state.diffValue=Math.min(100,(Number(state.diffValue)||0)+8);
    }
    const currentWord=sushiNextWord(state);
    const nonce=await saveVerifiedSession(session,{state,attempts:Number(session.attempts||0)+1});
    const nextSession={...session,last_action_at:new Date().toISOString()};
    return reply(200,{ok:true,correct:true,gain,fever,gold,extended,currentWord,...sushiSnapshot(state,nextSession,nonce)});
  }

  if (action === "sushi_miss") {
    const user=await getUser(req);
    requirePublished(game);
    requireFeature(settings.features,"ranking");
    if(game.id!==SUSHI_GAME_ID) throw new HttpError(404,"回転ずしタイピングの認証先ではありません。");
    const session=await loadVerifiedSession(user.id,body.sessionId,body.nonce,game.id,"sushi_typing");
    const state=cloneGameState(session.state as Record<string,any>);
    if(state.suddenEnded===true) return reply(200,{ok:true,suddenEnded:true,nonce:session.nonce,...sushiSnapshot(state,session,session.nonce)});
    state.miss=(Number(state.miss)||0)+1;
    state.combo=0;
    const config=SUSHI_CFG[String(state.mode)];
    state.gauge=Math.max(0,(Number(state.gauge)||0)-config.miss);
    if(state.mode==="sudden") state.suddenEnded=true;
    const nonce=await saveVerifiedSession(session,{state,attempts:Number(session.attempts||0)+1});
    return reply(200,{ok:true,suddenEnded:state.suddenEnded===true,nonce,...sushiSnapshot(state,{...session,last_action_at:new Date().toISOString()},nonce)});
  }

  if (action === "sushi_finish") {
    const user=await getUser(req);
    requirePublished(game);
    requireFeature(settings.features,"ranking");
    if(game.id!==SUSHI_GAME_ID) throw new HttpError(404,"回転ずしタイピングの認証先ではありません。");
    const session=await loadVerifiedSession(user.id,body.sessionId,body.nonce,game.id,"sushi_typing");
    const state=cloneGameState(session.state as Record<string,any>);
    // Only award a completed run with a positive score calculated by the server.
    if ((Number(state.score) || 0) > 0) {
      const rewardMode=String(state.mode || "normal") + "_" + String(state.level || "beginner");
      const {error:coinEventError}=await admin.from("kuro_coin_verified_game_events").insert({
        game_id:SUSHI_GAME_ID,
        user_id:user.id,
        mode:rewardMode,
        submission_id:session.id,
        cpu_difficulty:null,
        verified_score:Math.max(0,Math.floor(Number(state.score)||0)),
      });
      if (coinEventError && coinEventError.code !== "23505") {
        console.error("[kurogames-online] sushi coin reward event failed",coinEventError);
        throw new HttpError(500,"回転ずしタイピングの報酬を確定できませんでした。");
      }
    }
    const patch={state:{...state,timeLeftAtFinish:sushiTimeLeft(session,state)},status:"completed",result:"completed",completed_at:new Date().toISOString()};
    await saveVerifiedSession(session,patch);
    const saved=await sushiRecordCompletedRun(user.id,{...session,...patch});
    return reply(200,{ok:true,completed:true,recorded:saved.scoreRecorded,score:saved.score});
  }

  if (action === "prime_start") {
    const user = await getUser(req);
    requirePublished(game);
    requireFeature(settings.features, "ranking");
    if (game.id !== PRIME_GAME_ID) throw new HttpError(404, "素因数分解の認証先ではありません。");
    const difficulty = typeof body.difficulty === "string" ? body.difficulty.trim().toLowerCase() : "";
    if (!Object.prototype.hasOwnProperty.call(PRIME_DIFFICULTY,difficulty)) {
      throw new HttpError(400, "素因数分解の難易度が正しくありません。");
    }
    const { error:expireError } = await admin.from("game_verification_sessions").update({status:"expired"})
      .eq("game_id",game.id).eq("user_id",user.id).eq("game_type","prime_factor").eq("status","active");
    if (expireError) throw new HttpError(500, "前の素因数分解セッションを終了できませんでした。");
    const targetNumber = primeCreateTarget(difficulty);
    const state = { difficulty, score:0, combo:0, maxCombo:0, solvedCount:0, targetNumber, timeAdjustment:0, maxTime:90 };
    const { data, error } = await admin.from("game_verification_sessions").insert({
      game_id:game.id,user_id:user.id,game_type:"prime_factor",mode:difficulty,
      secret_number:targetNumber,attempts:0,state,status:"active",
    }).select("id,nonce,started_at").single();
    if (error?.code === "23505") throw new HttpError(409,"別の素因数分解ゲームが同時に開始されました。画面を再読み込みしてください。");
    if (error || !data) throw new HttpError(500,"素因数分解ゲームを開始できませんでした。");
    return reply(200,{ok:true,sessionId:data.id,nonce:data.nonce,targetNumber,score:0,combo:0,maxCombo:0,solvedCount:0,timeLeft:90,startedAt:data.started_at,serverVerified:true});
  }

  if (action === "prime_answer") {
    const user = await getUser(req);
    requirePublished(game);
    requireFeature(settings.features,"ranking");
    if (game.id !== PRIME_GAME_ID) throw new HttpError(404,"素因数分解の認証先ではありません。");
    const session = await loadVerifiedSession(user.id,body.sessionId,body.nonce,game.id,"prime_factor");
    const state = cloneGameState(session.state as Record<string,any>);
    const difficulty = String(state.difficulty || "");
    const config = PRIME_DIFFICULTY[difficulty];
    if (!config || Number(session.secret_number)!==Number(state.targetNumber)) throw new HttpError(409,"問題の認証状態が一致しません。ゲームを再読み込みしてください。");
    const lastActionMs = Date.now() - Date.parse(session.last_action_at);
    if (Number.isFinite(lastActionMs) && lastActionMs < 70) throw new HttpError(429,"入力が速すぎます。少し待ってから確定してください。");
    const timeBefore = primeGetTimeLeft(session,state);
    if (timeBefore <= 0) throw new HttpError(410,"制限時間が終了しました。結果を保存してください。");
    const raw = Array.isArray(body.factors) ? body.factors : [];
    if (raw.length > config.maxFactors || raw.some((v) => !Number.isSafeInteger(Number(v)) || Number(v)<2 || Number(v)>2500)) {
      throw new HttpError(400,"入力された因数の形式が正しくありません。");
    }
    const factors = raw.map(Number);
    const product = factors.reduce((acc,value)=>acc*value,1);
    const nonPrime = factors.find(value=>!primeIsPrime(value));
    const correct = factors.length >= config.minFactors && factors.length <= config.maxFactors &&
      product === Number(session.secret_number) && nonPrime === undefined;
    let reason = "";
    if (factors.length===0) reason = "式を入力してから確定しよう！";
    else if (product !== Number(session.secret_number)) reason = "積が " + product + " になってしまう！ (" + Number(session.secret_number) + " ではない)";
    else if (nonPrime !== undefined) reason = "「" + nonPrime + "」はまだ分解できるぞ！（素数ではない）";
    else if (factors.length < config.minFactors || factors.length > config.maxFactors) reason = "素数の個数がこの難易度の範囲外です。";
    if (!correct) {
      state.combo = 0;
      if (factors.length > 0) state.timeAdjustment = (Number(state.timeAdjustment)||0) - 3;
      const nonce = await saveVerifiedSession(session,{state,attempts:Number(session.attempts||0)+1});
      const timeLeft = primeGetTimeLeft({...session,last_action_at:new Date().toISOString()},state);
      return reply(200,{ok:true,correct:false,reason,nonce,targetNumber:Number(session.secret_number),score:Number(state.score)||0,combo:0,maxCombo:Number(state.maxCombo)||0,solvedCount:Number(state.solvedCount)||0,timeLeft:Math.round(timeLeft*100)/100});
    }
    const nextCombo = Number(state.combo||0)+1;
    const earned = config.baseScore + factors.length*50 + nextCombo*40;
    const timeBonus = Math.min(4.5,1.5+factors.length*0.5);
    const elapsed = Math.max(0,(Date.now()-Date.parse(session.started_at))/1000);
    const before = Math.max(0,Math.min(90,90-elapsed+(Number(state.timeAdjustment)||0)));
    const after = Math.min(90,before+timeBonus);
    state.combo = nextCombo;
    state.maxCombo = Math.max(Number(state.maxCombo)||0,nextCombo);
    state.solvedCount = (Number(state.solvedCount)||0)+1;
    state.score = (Number(state.score)||0)+earned;
    state.timeAdjustment = after-(90-elapsed);
    const targetNumber = primeCreateTarget(difficulty,Number(session.secret_number));
    state.targetNumber = targetNumber;
    const nonce = await saveVerifiedSession(session,{state,secret_number:targetNumber,attempts:Number(session.attempts||0)+1});
    const timeLeft = primeGetTimeLeft({...session,last_action_at:new Date().toISOString()},state);
    return reply(200,{ok:true,correct:true,earnedPoints:earned,timeBonus,nonce,targetNumber,score:state.score,combo:state.combo,maxCombo:state.maxCombo,solvedCount:state.solvedCount,timeLeft:Math.round(timeLeft*100)/100});
  }

  if (action === "prime_skip") {
    const user = await getUser(req);
    requirePublished(game);
    requireFeature(settings.features,"ranking");
    if (game.id !== PRIME_GAME_ID) throw new HttpError(404,"素因数分解の認証先ではありません。");
    const session = await loadVerifiedSession(user.id,body.sessionId,body.nonce,game.id,"prime_factor");
    const state = cloneGameState(session.state as Record<string,any>);
    if (primeGetTimeLeft(session,state) <= 0) throw new HttpError(410,"制限時間が終了しました。結果を保存してください。");
    state.combo = 0;
    state.timeAdjustment = (Number(state.timeAdjustment)||0)-5;
    const targetNumber = primeCreateTarget(String(state.difficulty),Number(session.secret_number));
    state.targetNumber = targetNumber;
    const nonce = await saveVerifiedSession(session,{state,secret_number:targetNumber,attempts:Number(session.attempts||0)+1});
    const timeLeft = primeGetTimeLeft({...session,last_action_at:new Date().toISOString()},state);
    return reply(200,{ok:true,skipped:true,nonce,targetNumber,score:Number(state.score)||0,combo:0,maxCombo:Number(state.maxCombo)||0,solvedCount:Number(state.solvedCount)||0,timeLeft:Math.round(timeLeft*100)/100});
  }

  if (action === "prime_finish") {
    const user = await getUser(req);
    requirePublished(game);
    requireFeature(settings.features,"ranking");
    if (game.id !== PRIME_GAME_ID) throw new HttpError(404,"素因数分解の認証先ではありません。");
    const sessionId = typeof body.sessionId === "string" && UUID_RE.test(body.sessionId)
      ? body.sessionId : "";
    if (!sessionId) throw new HttpError(400,"ゲームセッションIDが正しくありません。");

    // A previous finish request can complete the session successfully and then
    // fail while writing the aggregate. Allow the same authenticated owner to
    // retry that completed session; the submission id makes score writes idempotent.
    const {data:existingSession,error:existingError} = await admin.from("game_verification_sessions")
      .select("*")
      .eq("id",sessionId)
      .eq("game_id",game.id)
      .eq("user_id",user.id)
      .eq("game_type","prime_factor")
      .maybeSingle();
    if (existingError) throw new HttpError(500,"素因数分解の完了状態を確認できませんでした。");
    if (!existingSession) throw new HttpError(404,"ゲームセッションが見つかりません。");

    if (existingSession.status === "completed" && existingSession.result === "completed") {
      const completedState = cloneGameState(existingSession.state as Record<string,any>);
      const saved = existingSession.score_recorded
        ? {scoreRecorded:Number(completedState.score||0)>0,score:Math.max(0,Math.floor(Number(completedState.score)||0))}
        : await primeRecordCompletedRun(user.id,existingSession);
      return reply(200,{
        ok:true,completed:true,recorded:saved.scoreRecorded,score:saved.score,
        solvedCount:Number(completedState.solvedCount)||0,maxCombo:Number(completedState.maxCombo)||0,
        recovered:true,
      });
    }

    if (existingSession.status !== "active") {
      throw new HttpError(409,"このゲームセッションは終了しています。");
    }
    const session = await loadVerifiedSession(user.id,sessionId,body.nonce,game.id,"prime_factor");
    const state = cloneGameState(session.state as Record<string,any>);
    const timeLeft = primeGetTimeLeft(session,state);
    // The client only calls finishPrimeSession after the timer ends. Enforce
    // this server-side so a live run cannot be finalized early.
    if (timeLeft > 1.0) {
      throw new HttpError(409,"素因数分解は制限時間が終了してから結果を確定できます。");
    }
    if ((Number(state.solvedCount) || 0) > 0 && (Number(state.score) || 0) > 0) {
      const {error:coinEventError} = await admin.from("kuro_coin_verified_game_events").insert({
        game_id: PRIME_GAME_ID,
        user_id: user.id,
        mode: String(state.difficulty || session.mode || ""),
        submission_id: session.id,
        cpu_difficulty: null,
        verified_score: Math.max(0, Math.floor(Number(state.score) || 0)),
      });
      if (coinEventError && coinEventError.code !== "23505") {
        console.error("[kurogames-online] prime coin reward event failed",coinEventError);
        throw new HttpError(500,"素因数分解の報酬を確定できませんでした。");
      }
    }
    const patch = {
      state:{...state,timeLeftAtFinish:timeLeft},
      status:"completed",
      result:"completed",
      completed_at:new Date().toISOString(),
      score_recorded:false,
      score_recovery_status:"pending",
    };
    await saveVerifiedSession(session,patch);
    const saved = await primeRecordCompletedRun(user.id,{...session,...patch});
    return reply(200,{
      ok:true,completed:true,recorded:saved.scoreRecorded,score:saved.score,
      solvedCount:Number(state.solvedCount)||0,maxCombo:Number(state.maxCombo)||0,
    });
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
    const sessionState: Record<string, unknown> = {playMode,level};
    if (playMode === "time") sessionState.serverStartedAtUs = serverEpochMicroseconds().toString();
    const {data,error} = await admin.from("game_verification_sessions").insert({
      game_id:game.id,user_id:user.id,game_type:"number_guess",mode:playMode+":"+level,
      secret_number:answer,range_max:max,attempts:0,state:sessionState,status:"active",
    }).select("id,nonce,started_at").single();
    if (error?.code === "23505") throw new HttpError(409,"別のゲームが同時に開始されました。画面を再読み込みしてからお試しください。");
    if (error || !data) throw new HttpError(500,"ゲームを開始できませんでした。");
    return reply(200,{ok:true,sessionId:data.id,nonce:data.nonce,rangeMax:max,startedAt:data.started_at});
  }

  if (action === "number_guess") {
    const requestReceivedAtUs = serverEpochMicroseconds();
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
    const preciseStartUsText = playMode === "time" ? String(session.state?.serverStartedAtUs || "") : "";
    let elapsedUs: bigint | null = null;
    let legacyStartUs = "";
    if (correct && playMode === "time") {
      if (/^\d+$/.test(preciseStartUsText)) {
        const deltaUs = requestReceivedAtUs - BigInt(preciseStartUsText);
        elapsedUs = deltaUs >= 0n ? deltaUs : 0n;
        legacyStartUs = preciseStartUsText;
      } else {
        const fallbackMs = Math.max(0,Date.now()-Date.parse(session.started_at));
        elapsedUs = BigInt(Math.round(fallbackMs * 1000));
        legacyStartUs = (requestReceivedAtUs - elapsedUs).toString();
      }
    }
    const elapsedMs = correct
      ? elapsedUs !== null ? Number(elapsedUs) / 1000 : Math.max(0,Date.now()-Date.parse(session.started_at))
      : null;
    const completed = correct || lost;
    // The answer and difficulty are read from the server-owned session.
    // The session UUID is the idempotency key for this exact successful run.
    // Keep the same 500ms floor used by the time-attack ranking verifier.
    if (correct && elapsedMs !== null && elapsedMs >= 500) {
      const rewardMode = "number-" + playMode + "-" + level;
      const {error:coinEventError} = await admin.from("kuro_coin_verified_game_events").insert({
        game_id: NUMBER_GAME_ID,
        user_id: user.id,
        mode: rewardMode,
        submission_id: session.id,
        cpu_difficulty: null,
      });
      if (coinEventError && coinEventError.code !== "23505") {
        console.error("[kurogames-online] number coin reward event failed",coinEventError);
        throw new HttpError(500,"数字当ての報酬を確定できませんでした。");
      }
    }
    const sessionPatch: Record<string, unknown> = {
      attempts,
      status:completed ? "completed" : "active",
      result:correct ? "correct" : lost ? "failed" : null,
      completed_at:completed ? new Date().toISOString() : null,
    };
    if (correct && playMode === "time" && elapsedUs !== null) {
      sessionPatch.state = {
        ...(session.state || {}),
        serverStartedAtUs: legacyStartUs,
        serverFinishedAtUs: requestReceivedAtUs.toString(),
      };
    }
    const nextNonce = await saveVerifiedSession(session,sessionPatch);

    let recordResult:Record<string,unknown> = {scoreRecorded:false,improved:false};
    if (correct && playMode === "time" && elapsedUs !== null) {
      if (elapsedUs >= 400_000n) {
        const mode = "number-time-" + level;
        const metadata = {
          metric:"clear_time_us",
          elapsedUs:elapsedUs.toString(),
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
      completed,elapsedMs:elapsedUs !== null ? Number(elapsedUs) / 1000 : elapsedMs,
      elapsedUs:elapsedUs !== null ? Number(elapsedUs) : undefined,
      nonce:completed ? null : nextNonce,
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
    if (game.id === TICTACTOE_GAME_ID || game.id === NUMBER_GAME_ID || game.id === PRIME_GAME_ID || game.id === SUSHI_GAME_ID) {
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
    if (game.id === DAIFUGO_GAME_ID && mode === "wins-bot") {
      throw new HttpError(403, "大富豪のCPU戦はサーバー検証方式への移行中のため、ランキング記録を停止しています。");
    }
    if (game.id === DAIFUGO_GAME_ID && mode === "wins-online") {
      throw new HttpError(403, "オンライン勝利数は対局サーバーが登録します。");
    }
    const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? { ...(body.metadata as Record<string, unknown>) }
      : {};
    const requestedMetric = String(body.metric || metadata.metric || "").toLowerCase();
    const timeMode = /(^|[_-])(time|duration|elapsed|seconds?|milliseconds?|ms|fastest|clear_time)([_-]|$)/i.test(mode);
    if (/^(time|time_ms|clear_time_ms|duration_ms)$/.test(requestedMetric) && !timeMode) {
      throw new HttpError(400, "タイムランキングでは mode 名に time を含めてください。");
    }
    metadata.metric = timeMode
      ? "time"
      : /^(wins|win|win_count)$/.test(requestedMetric) ||
        /(^|[_-])(wins?|victories)([_-]|$)/i.test(mode)
        ? "wins"
        : "score";
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
      throw new HttpError(403, "UNONのCPU戦ランキングはサーバー検証方式への移行中です。オンライン対戦の勝利数はこれまでどおり登録できます。");
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
      p_level: metadata.level !== null && metadata.level !== undefined &&
        Number.isSafeInteger(Number(metadata.level)) && Number(metadata.level) >= 0
        ? Number(metadata.level)
        : null,
      p_cpu_difficulty: ["EASY", "NORMAL", "HARD", "EXPERT"].includes(String(metadata.cpuDifficulty || metadata.cpu_difficulty || "").toUpperCase())
        ? String(metadata.cpuDifficulty || metadata.cpu_difficulty).toUpperCase()
        : null,
    });
    if (error) {
      console.error("[kurogames-online] score_submit RPC failed", error);
      throw new HttpError(500, "スコアを登録できませんでした。");
    }
    const submitted = Array.isArray(submittedRows) ? submittedRows[0] : submittedRows;
    if (!submitted) throw new HttpError(500, "スコア登録結果を取得できませんでした。");

    // UNON wins are accepted only after the independent online-room worker has
    // verified a signed win proof bound to this user, game, match and room above.
    // Persist that verified victory in the authoritative win-event table so its
    // AFTER INSERT trigger awards KURO COIN and synchronizes unified game records.
    // The unique dimensions index makes retries/parallel duplicate submissions safe.
    if (game.id === UNON_GAME_ID && mode === "wins-online") {
      const { error: winEventError } = await admin.from("kuro_game_win_events").insert({
        game_id: game.id,
        user_id: user.id,
        mode,
        submission_id: submissionId,
        level: null,
        cpu_difficulty: null,
      });
      if (winEventError && winEventError.code !== "23505") {
        console.error("[kurogames-online] verified UNON win event insert failed", winEventError);
        throw new HttpError(500, "UNONの勝利報酬を確定できませんでした。再度お試しください。");
      }
      console.info("[kurogames-online] verified UNON win event persisted", {
        userId: user.id, submissionId, duplicate: winEventError?.code === "23505",
      });
    }

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

    // Keep a dedicated compact aggregate for the Hard-only UNON solo leaderboard.
    // The regular wins-solo row remains the user's overall solo record.
    if (game.id === UNON_GAME_ID && mode === "wins-solo") {
      const { error: hardStatsError } = await admin.rpc("kuro_record_user_game_event", {
        p_submission_id: submissionId,
        p_user_id: user.id,
        p_game_id: game.id,
        p_mode: "wins-solo-hard",
        p_result: "win",
        p_score: 1,
        p_duration_ms: null,
        p_metadata: {
          metric: "wins",
          source: "unon-solo",
          cpuDifficulty: "hard",
          difficulty: "hard",
          players: Number(metadata.players),
          internalRankingMode: true,
        },
      });
      if (hardStatsError) {
        console.error("[kurogames-online] UNON hard CPU aggregate save failed", hardStatsError);
        throw new HttpError(500, "UNONの最強CPUランキング記録を保存できませんでした。");
      }
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

  if (action === "unon_room_set_started") {
    const user = await getUser(req);
    requirePublished(game);
    requireMultiplayer(settings.features);
    if (game.id !== UNON_GAME_ID) throw new HttpError(404, "この操作はUNON専用です。");

    const roomId = typeof body.roomId === "string" && UUID_RE.test(body.roomId) ? body.roomId : "";
    if (!roomId) throw new HttpError(400, "roomIdが正しくありません。");
    const { data: room, error: roomError } = await admin.from("game_online_rooms")
      .select("id, host_user_id, status")
      .eq("id", roomId).eq("game_id", game.id).maybeSingle();
    if (roomError || !room) throw new HttpError(404, "対戦ルームが見つかりません。");
    if (room.host_user_id !== user.id) throw new HttpError(403, "ゲームを開始できるのはルームホストだけです。");

    const { data: member, error: memberError } = await admin.from("game_online_room_members")
      .select("user_id").eq("room_id", roomId).eq("user_id", user.id).maybeSingle();
    if (memberError) throw new HttpError(500, "ルーム参加状態を確認できませんでした。");
    if (!member) throw new HttpError(403, "このルームの参加者ではありません。");

    const started = body.started !== false;
    if (started) {
      if (room.status === "closed") throw new HttpError(409, "このルームは終了しています。");
      if (room.status !== "playing") {
        const { data: updated, error: updateError } = await admin.from("game_online_rooms")
          .update({ status: "playing" })
          .eq("id", roomId).eq("game_id", game.id).eq("status", "waiting")
          .select("id").maybeSingle();
        if (updateError) throw new HttpError(500, "対戦開始状態を保存できませんでした。");
        if (!updated) {
          const { data: current, error: currentError } = await admin.from("game_online_rooms")
            .select("status").eq("id", roomId).eq("game_id", game.id).maybeSingle();
          if (currentError || current?.status !== "playing") {
            throw new HttpError(409, "ルーム状態が変更されたため開始できません。");
          }
        }
      }
      return reply(200, { ok: true, started: true });
    }

    // The client calls this only after the server explicitly rejected a start request.
    if (room.status === "playing") {
      const { error: unlockError } = await admin.from("game_online_rooms")
        .update({ status: "waiting" })
        .eq("id", roomId).eq("game_id", game.id).eq("status", "playing");
      if (unlockError) throw new HttpError(500, "待機状態へ戻せませんでした。");
    }
    return reply(200, { ok: true, started: false });
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
      const roomJoinable = room && (room.status === "waiting" || (isUnon && room.status === "playing"));
      if (roomError || !roomJoinable ||
          (isUnon && roomData.ruleMode !== ruleMode)) {
        await admin.rpc(isUnon ? "kuro_unon_matchmaking_cancel" : "kuro_daifugo_matchmaking_cancel", { p_game_id: game.id, p_user_id: user.id });
        return reply(200, { status: "cancelled" });
      }
      // UNON random matches support two to four players. Include every assigned
      // member, even when a participant's presence timestamp is temporarily stale.
      const members = await getRoomMembers(String(room.id), isUnon);
      if (isUnon ? (members.length < 2 || members.length > 4) : members.length !== 2) {
        await admin.rpc(isUnon ? "kuro_unon_matchmaking_cancel" : "kuro_daifugo_matchmaking_cancel", { p_game_id: game.id, p_user_id: user.id });
        return reply(200, { status: "cancelled" });
      }
      return reply(200, { status: "matched", room, members });
    }

    if (isCancel) {
      const { data, error } = await admin.rpc(isUnon ? "kuro_unon_matchmaking_cancel" : "kuro_daifugo_matchmaking_cancel", {
        p_game_id: game.id,
        p_user_id: user.id,
      });
      if (error) throw new HttpError(500, "マッチングをキャンセルできませんでした。");
      return reply(200, { ok: true, cancelled: data === true });
    }

    const roomId = typeof body.roomId === "string" && UUID_RE.test(body.roomId) ? body.roomId : "";
    if (!roomId) throw new HttpError(400, "roomIdが正しくありません。");
    const { data, error } = await admin.rpc(isUnon ? "kuro_unon_matchmaking_ack" : "kuro_daifugo_matchmaking_ack", {
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

  if (action === "room_list" || action === "room_create" || action === "room_join" || action === "room_disband" || action === "room_leave" || action === "room_heartbeat" || action === "room_send" || action === "room_poll" || action === "room_state_get" || action === "room_state_update") {
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
      const maxAllowed = game.id === "faa155cb-2143-4361-9a96-dc759d334e46" ? 4 : 35;
      const availableRooms = (data ?? []).filter((room) => {
        const capacity = Math.min(maxAllowed, Math.max(2, Number(room.max_players) || 4));
        return Number(room.player_count) < capacity;
      });
      return reply(200, { rooms: availableRooms });
    }

    if (action === "room_create") {
      const maxAllowed = game.id === "faa155cb-2143-4361-9a96-dc759d334e46" ? 4 : 35;
      const maxPlayers = Math.max(2, Math.min(maxAllowed, Math.floor(Number(body.maxPlayers) || 4)));
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

    if (action === "room_disband") {
      const { data: room, error: roomError } = await admin.from("game_online_rooms")
        .select("id, host_user_id, status")
        .eq("id", roomId).eq("game_id", game.id).maybeSingle();
      if (roomError) throw new HttpError(500, "ルーム情報を確認できませんでした。");
      if (!room) throw new HttpError(404, "ルームが見つかりません。");
      if (room.host_user_id !== user.id) throw new HttpError(403, "ルームを解散できるのはホストだけです。");
      if (room.status !== "closed") {
        const { data: closed, error: closeError } = await admin.from("game_online_rooms")
          .update({ status: "closed", player_count: 0 })
          .eq("id", roomId).eq("game_id", game.id).eq("host_user_id", user.id)
          .select("id").maybeSingle();
        if (closeError) throw new HttpError(500, "ルームを解散できませんでした。");
        if (!closed) throw new HttpError(409, "ルームの状態が変わりました。再読み込みしてください。");
      }
      const { error: matchCleanupError } = await admin.from("game_online_matchmaking")
        .delete().eq("game_id", game.id).eq("room_id", roomId);
      if (matchCleanupError) throw new HttpError(500, "マッチング情報を整理できませんでした。");
      // Keep member rows until clients poll the closed status; deleting them here
      // would make room_poll return 403 before it can notify connected clients.
      return reply(200, { ok: true, disbanded: true });
    }

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
