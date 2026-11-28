const SUPABASE_URL = "https://cprvpphlfpmiegjiutjn.supabase.co";
const SUPABASE_KEY = "sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class KuroEconomyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function response(body, status = 200, origin = null) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
  if (origin === "https://kurolab.cc.cd" || origin === "https://admin.kurolab.cc.cd") {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function uuid() {
  return crypto.randomUUID();
}

function isoNow() {
  return new Date().toISOString();
}

async function authenticate(request, db, options = {}) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1] || "";
  if (!token || token.length > 8192 || token.split(".").length !== 3) {
    throw new KuroEconomyError(401, "ログイン状態を確認できません。再ログインしてください。");
  }

  const authResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + token,
      "Accept": "application/json"
    },
    signal: AbortSignal.timeout(8000)
  });
  if (!authResponse.ok) {
    throw new KuroEconomyError(401, "ログイン状態を確認できません。再ログインしてください。");
  }
  const user = await authResponse.json();
  if (!user || typeof user.id !== "string" || !UUID_RE.test(user.id) || user.is_anonymous === true) {
    throw new KuroEconomyError(401, "KUROアカウントでログインしてください。");
  }

  const now = isoNow();
  const suspension = await db.prepare(
    "SELECT id FROM account_suspensions WHERE user_id = ? AND revoked_at IS NULL AND starts_at <= ? AND ends_at > ? LIMIT 1"
  ).bind(user.id, now, now).first();
  if (suspension && !options.allowSuspended) {
    throw new KuroEconomyError(403, "このアカウントは一時停止中のため、経済機能を利用できません。");
  }

  if (options.adminTool || options.studioTool) {
    const tool = options.adminTool ? "admin" : "shop-studio";
    const origin = options.adminTool ? "https://admin.kurolab.cc.cd" : "https://kurolab.cc.cd";
    let gateResponse;
    try {
      gateResponse = await fetch(SUPABASE_URL + "/functions/v1/kuro-security-gate", {
        method: "POST",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
          "Origin": origin
        },
        body: JSON.stringify({ action: "check", tool }),
        signal: AbortSignal.timeout(10000)
      });
    } catch (_) {
      throw new KuroEconomyError(503, "KURO Security Gateに接続できません。");
    }
    const gate = await gateResponse.json().catch(() => ({}));
    if (!gateResponse.ok || gate?.allowed !== true) {
      throw new KuroEconomyError(gateResponse.status >= 500 ? 503 : (gateResponse.status === 401 ? 401 : 403),
        gate?.message || "KURO Security Gateでアクセスが拒否されました。");
    }
  }

  return { id: user.id, token };
}

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

async function getAll(statement) {
  return rows(await statement.all());
}

async function requireDb(env) {
  if (!env?.KURO_APP_DB) throw new KuroEconomyError(503, "Cloudflare D1に接続できません。");
  return env.KURO_APP_DB;
}

async function handleAdmin(action, body, db, user) {
  if (action === "get_level_system") {
    const [settings, rewards, thresholds, coinRewards, games, users, ledger] = await Promise.all([
      db.prepare("SELECT enabled, default_win_xp, updated_at FROM kuro_level_system_settings WHERE singleton = 1").first(),
      getAll(db.prepare("SELECT game_id, xp_per_win, enabled, updated_at FROM kuro_level_game_rewards ORDER BY updated_at DESC")),
      getAll(db.prepare("SELECT level, required_xp FROM kuro_level_thresholds ORDER BY level")),
      getAll(db.prepare("SELECT level, reward_amount, enabled, updated_at FROM kuro_level_coin_rewards ORDER BY level")),
      getAll(db.prepare("SELECT id, title, slug, icon, status FROM game_studio_games ORDER BY title")),
      getAll(db.prepare("SELECT user_id, total_xp, current_level, updated_at FROM kuro_level_users ORDER BY total_xp DESC LIMIT 50")),
      getAll(db.prepare("SELECT id, user_id, xp_amount, total_xp_after, source_game_id, source_mode, reason, created_at FROM kuro_level_ledger ORDER BY created_at DESC LIMIT 40"))
    ]);
    const userIds = Array.from(new Set([...users, ...ledger].map(row => row.user_id).filter(Boolean)));
    const profileMap = new Map();
    if (userIds.length) {
      const placeholders = userIds.map(() => "?").join(",");
      const profiles = await getAll(db.prepare("SELECT id, username, display_name, kuro_id FROM profiles WHERE id IN (" + placeholders + ")").bind(...userIds));
      profiles.forEach(item => profileMap.set(item.id, item));
    }
    const gameMap = new Map(games.map(item => [item.id, item]));
    return {
      settings: settings || { enabled: 1, default_win_xp: 100 },
      rewards: rewards.map(row => ({ ...row, enabled: !!row.enabled, game: gameMap.get(row.game_id) || null })),
      thresholds,
      coinRewards: coinRewards.map(row => ({ ...row, enabled: !!row.enabled })),
      games,
      user_count: Number((await db.prepare("SELECT COUNT(*) AS count FROM kuro_level_users").first())?.count || 0),
      users: users.map(row => ({ ...row, profile: profileMap.get(row.user_id) || null })),
      ledger: ledger.map(row => ({
        ...row,
        profile: profileMap.get(row.user_id) || null,
        game: row.source_game_id ? (gameMap.get(row.source_game_id) || null) : null
      }))
    };
  }

  if (action === "save_level_settings") {
    const enabled = body.enabled === true ? 1 : 0;
    const defaultWinXp = Number(body.defaultWinXp);
    if (!Number.isSafeInteger(defaultWinXp) || defaultWinXp < 0 || defaultWinXp > 100000) {
      throw new KuroEconomyError(400, "基本XPは0〜100,000の整数で指定してください。");
    }
    const now = isoNow();
    await db.prepare(
      "INSERT INTO kuro_level_system_settings(singleton, enabled, default_win_xp, updated_at, updated_by) VALUES(1, ?, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET enabled=excluded.enabled, default_win_xp=excluded.default_win_xp, updated_at=excluded.updated_at, updated_by=excluded.updated_by"
    ).bind(enabled, defaultWinXp, now, user.id).run();
    return { settings: { enabled, default_win_xp: defaultWinXp, updated_at: now } };
  }

  if (action === "save_level_game_reward") {
    const gameId = String(body.gameId || "").trim();
    const xpPerWin = Number(body.xpPerWin);
    if (!UUID_RE.test(gameId)) throw new KuroEconomyError(400, "ゲームIDが正しくありません。");
    if (!Number.isSafeInteger(xpPerWin) || xpPerWin < 0 || xpPerWin > 100000) {
      throw new KuroEconomyError(400, "勝利XPは0〜100,000の整数で指定してください。");
    }
    const enabled = body.enabled === true ? 1 : 0;
    const now = isoNow();
    await db.prepare(
      "INSERT INTO kuro_level_game_rewards(game_id, xp_per_win, enabled, updated_at, updated_by) VALUES(?, ?, ?, ?, ?) ON CONFLICT(game_id) DO UPDATE SET xp_per_win=excluded.xp_per_win, enabled=excluded.enabled, updated_at=excluded.updated_at, updated_by=excluded.updated_by"
    ).bind(gameId, xpPerWin, enabled, now, user.id).run();
    return { reward: { game_id: gameId, xp_per_win: xpPerWin, enabled: !!enabled, updated_at: now } };
  }

  if (action === "save_level_thresholds") {
    const input = Array.isArray(body.thresholds) ? body.thresholds : [];
    if (input.length < 2 || input.length > 100) throw new KuroEconomyError(400, "レベル設定は2〜100段階で指定してください。");
    const thresholds = [];
    for (let index = 0; index < input.length; index++) {
      const item = input[index] || {};
      const level = Number(item.level);
      const requiredXp = Number(item.requiredXp);
      if (!Number.isSafeInteger(level) || level !== index + 1 ||
          !Number.isSafeInteger(requiredXp) || requiredXp < 0 || requiredXp > 1000000000000) {
        throw new KuroEconomyError(400, "レベルは1から連番、必要XPは0以上の整数にしてください。");
      }
      if (index === 0 && requiredXp !== 0) throw new KuroEconomyError(400, "Lv.1の必要XPは必ず0にしてください。");
      if (index > 0 && requiredXp <= thresholds[index - 1].required_xp) throw new KuroEconomyError(400, "必要XPはレベルが上がるほど大きくしてください。");
      thresholds.push({ level, required_xp: requiredXp, updated_at: isoNow() });
    }
    const statements = [
      db.prepare("DELETE FROM kuro_level_thresholds WHERE level > ?").bind(thresholds.length),
      ...thresholds.map(item => db.prepare(
        "INSERT INTO kuro_level_thresholds(level, required_xp, updated_at) VALUES(?, ?, ?) ON CONFLICT(level) DO UPDATE SET required_xp=excluded.required_xp, updated_at=excluded.updated_at"
      ).bind(item.level, item.required_xp, item.updated_at)),
      db.prepare(
        "UPDATE kuro_level_users SET current_level = (SELECT COALESCE(MAX(level), 1) FROM kuro_level_thresholds WHERE required_xp <= kuro_level_users.total_xp), updated_at = ?"
      ).bind(isoNow())
    ];
    const results = await db.batch(statements);
    const recalculated = Number(results[results.length - 1]?.meta?.changes || 0);
    return { thresholds, recalculated };
  }

  if (action === "save_level_coin_rewards") {
    const input = Array.isArray(body.rewards) ? body.rewards : [];
    if (input.length > 100) throw new KuroEconomyError(400, "報酬設定は100件以内にしてください。");
    const seen = new Set();
    const rewards = [];
    for (const item of input) {
      const level = Number(item?.level);
      const rewardAmount = Number(item?.rewardAmount);
      const enabled = item?.enabled === true ? 1 : 0;
      if (!Number.isSafeInteger(level) || level < 2 || level > 10000 ||
          !Number.isSafeInteger(rewardAmount) || rewardAmount < 0 || rewardAmount > 1000000 ||
          (enabled && rewardAmount <= 0) || seen.has(level)) {
        throw new KuroEconomyError(400, "レベル到達報酬の設定を確認してください。");
      }
      seen.add(level);
      rewards.push({ level, rewardAmount, enabled });
    }
    const now = isoNow();
    const statements = [
      db.prepare("DELETE FROM kuro_level_coin_rewards WHERE level NOT IN (" + (rewards.length ? rewards.map(() => "?").join(",") : "NULL") + ")").bind(...(rewards.length ? rewards.map(item => item.level) : [])),
      ...rewards.map(item => db.prepare(
        "INSERT INTO kuro_level_coin_rewards(level, reward_amount, enabled, updated_at, updated_by) VALUES(?, ?, ?, ?, ?) ON CONFLICT(level) DO UPDATE SET reward_amount=excluded.reward_amount, enabled=excluded.enabled, updated_at=excluded.updated_at, updated_by=excluded.updated_by"
      ).bind(item.level, item.rewardAmount, item.enabled, now, user.id))
    ];
    await db.batch(statements);
    return { ok: true, count: rewards.length };
  }

  if (action === "adjust_level_xp") {
    const userId = String(body.userId || "").trim();
    const amount = Number(body.amount);
    const reason = String(body.reason || "").trim();
    if (!UUID_RE.test(userId)) throw new KuroEconomyError(400, "ユーザーIDが正しくありません。");
    if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 1000000) {
      throw new KuroEconomyError(400, "XP補正は-1,000,000〜1,000,000の0以外の整数にしてください。");
    }
    if (!reason || reason.length > 200) throw new KuroEconomyError(400, "補正理由を1〜200文字で入力してください。");
    const current = await db.prepare("SELECT total_xp FROM kuro_level_users WHERE user_id = ?").bind(userId).first();
    if (Number(current?.total_xp || 0) + amount < 0) throw new KuroEconomyError(400, "XPは0未満にはできません。");
    const now = isoNow();
    const ledgerId = uuid();
    const results = await db.batch([
      db.prepare("INSERT OR IGNORE INTO kuro_level_users(user_id, total_xp, current_level, updated_at) VALUES(?, 0, 1, ?)").bind(userId, now),
      db.prepare(
        "UPDATE kuro_level_users SET total_xp=total_xp+?, current_level=(SELECT COALESCE(MAX(level),1) FROM kuro_level_thresholds WHERE required_xp <= total_xp+?), updated_at=? WHERE user_id=? AND total_xp+? >= 0"
      ).bind(amount, amount, now, userId, amount),
      db.prepare(
        "INSERT INTO kuro_level_ledger(id,user_id,xp_amount,total_xp_after,reason,created_by,created_at) SELECT ?,user_id,?,total_xp,?,?,? FROM kuro_level_users WHERE user_id=? AND changes()=1"
      ).bind(ledgerId, amount, "管理者補正：" + reason, user.id, now, userId)
    ]);
    if (Number(results[1]?.meta?.changes || 0) !== 1) throw new KuroEconomyError(409, "XPを更新できませんでした。残高を再確認してください。");
    const result = await db.prepare("SELECT user_id,total_xp,current_level,updated_at FROM kuro_level_users WHERE user_id=?").bind(userId).first();
    return { ok: true, result };
  }

  if (action === "get_coin_economy") {
    const [balances, totals, rewards, ledger, games] = await Promise.all([
      db.prepare("SELECT COALESCE(SUM(balance),0) AS total_balance, COUNT(*) AS funded_users FROM kuro_coin_balances WHERE balance > 0").first(),
      db.prepare("SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END),0) AS total_issued, COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END),0) AS total_spent, COUNT(*) AS transaction_count FROM kuro_coin_ledger").first(),
      getAll(db.prepare("SELECT game_id,mode,reward_amount,enabled,required_cpu_difficulty,reward_label,reward_type,score_tiers,updated_at FROM kuro_coin_game_rewards ORDER BY updated_at DESC")),
      getAll(db.prepare("SELECT id,user_id,amount,balance_after,transaction_type,description,source_game_id,source_mode,created_at FROM kuro_coin_ledger ORDER BY created_at DESC LIMIT 60")),
      getAll(db.prepare("SELECT id,title,slug,icon,status FROM game_studio_games ORDER BY title"))
    ]);
    const userIds = Array.from(new Set(ledger.map(row => row.user_id).filter(Boolean)));
    const profiles = userIds.length
      ? await getAll(db.prepare("SELECT id,username,display_name,kuro_id FROM profiles WHERE id IN (" + userIds.map(() => "?").join(",") + ")").bind(...userIds))
      : [];
    const profileMap = new Map(profiles.map(row => [row.id, row]));
    const gameMap = new Map(games.map(row => [row.id, row]));
    return {
      summary: {
        total_balance: Number(balances?.total_balance || 0),
        total_issued: Number(totals?.total_issued || 0),
        total_spent: Number(totals?.total_spent || 0),
        funded_users: Number(balances?.funded_users || 0),
        transaction_count: Number(totals?.transaction_count || 0)
      },
      games: games.filter(game => [
        "faa155cb-2143-4361-9a96-dc759d334e46",
        "2eb37847-1b7e-43e4-ad98-901d5b830ac4",
        "4ccccb72-d5db-4098-a7d4-1c28a0755e7b",
        "903a4c45-37bb-4a4b-a259-a5a8245de998"
      ].includes(game.id)),
      rewards: rewards.filter(reward =>
        ((reward.game_id === "faa155cb-2143-4361-9a96-dc759d334e46" ||
          reward.game_id === "2eb37847-1b7e-43e4-ad98-901d5b830ac4") && reward.mode === "wins-online" ||
         reward.game_id === "4ccccb72-d5db-4098-a7d4-1c28a0755e7b" && reward.mode === "online" ||
         reward.game_id === "903a4c45-37bb-4a4b-a259-a5a8245de998" &&
          ["werewolf_villager_wins","werewolf_wolf_wins"].includes(reward.mode)) &&
        reward.required_cpu_difficulty === "NONE"
      ).map(reward => ({ ...reward, enabled: !!reward.enabled, game: gameMap.get(reward.game_id) || null })),
      transactions: ledger.map(row => ({
        ...row,
        profile: profileMap.get(row.user_id) || null,
        game: row.source_game_id ? (gameMap.get(row.source_game_id) || null) : null
      }))
    };
  }

  if (action === "update_coin_reward") {
    const gameId = String(body.gameId || "");
    const mode = String(body.mode || "").trim();
    const amount = Number(body.rewardAmount);
    const label = String(body.rewardLabel || "").trim();
    if (!UUID_RE.test(gameId) || !/^[A-Za-z0-9_-]{1,40}$/.test(mode)) throw new KuroEconomyError(400, "ゲームIDまたはモード指定が正しくありません。");
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000) throw new KuroEconomyError(400, "固定報酬は0〜1000 Pで設定してください。");
    if (!label || label.length > 80) throw new KuroEconomyError(400, "報酬表示名は1〜80文字で入力してください。");
    const isAllowed =
      ((gameId === "faa155cb-2143-4361-9a96-dc759d334e46" || gameId === "2eb37847-1b7e-43e4-ad98-901d5b830ac4") && mode === "wins-online") ||
      (gameId === "4ccccb72-d5db-4098-a7d4-1c28a0755e7b" && mode === "online") ||
      (gameId === "903a4c45-37bb-4a4b-a259-a5a8245de998" && ["werewolf_villager_wins","werewolf_wolf_wins"].includes(mode));
    if (!isAllowed) throw new KuroEconomyError(400, "このゲームまたはモードのオンライン勝利報酬は変更できません。");
    const existing = await db.prepare("SELECT score_tiers FROM kuro_coin_game_rewards WHERE game_id=? AND mode=? AND required_cpu_difficulty='NONE'").bind(gameId, mode).first();
    const now = isoNow();
    const enabled = body.enabled === true ? 1 : 0;
    await db.prepare(
      "INSERT INTO kuro_coin_game_rewards(game_id,mode,reward_amount,enabled,required_cpu_difficulty,reward_label,updated_by_user_id,updated_at,reward_type,score_tiers) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(game_id,mode,required_cpu_difficulty) DO UPDATE SET reward_amount=excluded.reward_amount,enabled=excluded.enabled,reward_label=excluded.reward_label,updated_by_user_id=excluded.updated_by_user_id,updated_at=excluded.updated_at,reward_type=excluded.reward_type"
    ).bind(gameId, mode, amount, enabled, "NONE", label, user.id, now, "fixed", existing?.score_tiers || "[]").run();
    return { reward: { game_id: gameId, mode, reward_amount: amount, enabled: !!enabled, required_cpu_difficulty: "NONE", reward_label: label, reward_type: "fixed", score_tiers: existing?.score_tiers || "[]", updated_at: now } };
  }

  if (action === "adjust_coin_balance") {
    const userId = String(body.userId || "").trim();
    const amount = Number(body.amount);
    const reason = String(body.reason || "").trim();
    if (!UUID_RE.test(userId)) throw new KuroEconomyError(400, "ユーザーIDが正しくありません。");
    if (!Number.isSafeInteger(amount) || amount === 0 || amount < -100000 || amount > 100000) {
      throw new KuroEconomyError(400, "ポイント補正は-100,000〜100,000の0以外の整数にしてください。");
    }
    if (reason.length < 3 || reason.length > 200) throw new KuroEconomyError(400, "補正理由は3〜200文字で入力してください。");
    const now = isoNow();
    const ledgerId = uuid();
    const results = await db.batch([
      db.prepare("INSERT OR IGNORE INTO kuro_coin_balances(user_id,balance,updated_at) VALUES(?,0,?)").bind(userId, now),
      db.prepare("UPDATE kuro_coin_balances SET balance=balance+?,updated_at=? WHERE user_id=? AND balance+? >= 0").bind(amount, now, userId, amount),
      db.prepare(
        "INSERT INTO kuro_coin_ledger(id,user_id,amount,balance_after,transaction_type,created_by_user_id,description,metadata,created_at) SELECT ?,user_id,?,balance,'admin_adjustment',?,?,?,? FROM kuro_coin_balances WHERE user_id=? AND changes()=1"
      ).bind(ledgerId, userId, amount, user.id, reason, JSON.stringify({ actorUserId: user.id, reason }), now, userId)
    ]);
    if (Number(results[1]?.meta?.changes || 0) !== 1) throw new KuroEconomyError(400, "KURO COIN残高が0未満になるため補正できません。");
    const result = await db.prepare("SELECT user_id,balance,updated_at FROM kuro_coin_balances WHERE user_id=?").bind(userId).first();
    return { ok: true, result };
  }

  throw new KuroEconomyError(400, "経済管理操作が正しくありません。");
}

async function handleStore(action, body, db, user) {
  if (action === "catalog") {
    const [items, inventory, equipped, balance] = await Promise.all([
      getAll(db.prepare("SELECT id,item_key,name,description,category,icon,image_url,rarity,price_kc,is_free,sort_order FROM kuro_store_items WHERE is_active=1 AND deleted_at IS NULL ORDER BY sort_order,created_at DESC")),
      getAll(db.prepare("SELECT inv.id,inv.item_id,inv.source,inv.acquired_at,i.id AS joined_id,i.item_key,i.name,i.description,i.category,i.icon,i.image_url,i.rarity,i.price_kc,i.is_free,i.sort_order FROM kuro_store_user_inventory inv JOIN kuro_store_items i ON i.id=inv.item_id WHERE inv.user_id=? ORDER BY inv.acquired_at DESC").bind(user.id)),
      getAll(db.prepare("SELECT e.slot,e.item_id,e.updated_at,i.item_key,i.name,i.category,i.icon,i.image_url,i.rarity FROM kuro_store_equipped_items e JOIN kuro_store_items i ON i.id=e.item_id WHERE e.user_id=?").bind(user.id)),
      db.prepare("SELECT balance FROM kuro_coin_balances WHERE user_id=?").bind(user.id).first()
    ]);
    const mappedInventory = inventory.map(row => ({
      id: row.id, item_id: row.item_id, source: row.source, acquired_at: row.acquired_at,
      item: { id: row.joined_id, item_key: row.item_key, name: row.name, description: row.description, category: row.category,
        icon: row.icon, image_url: row.image_url, rarity: row.rarity, price_kc: row.price_kc, is_free: !!row.is_free, sort_order: row.sort_order }
    }));
    const mappedEquipped = equipped.map(row => ({
      slot: row.slot, item_id: row.item_id, updated_at: row.updated_at,
      item: { item_key: row.item_key, name: row.name, category: row.category, icon: row.icon, image_url: row.image_url, rarity: row.rarity }
    }));
    return { inventory: mappedInventory, equipped: mappedEquipped, coinBalance: Number(balance?.balance ?? 0) };
  }

  if (action === "claim_free") {
    const itemId = String(body.itemId || "");
    if (!UUID_RE.test(itemId)) throw new KuroEconomyError(400, "商品IDが正しくありません。");
    const item = await db.prepare("SELECT id,is_active,is_free,price_kc FROM kuro_store_items WHERE id=? AND deleted_at IS NULL").bind(itemId).first();
    if (!item || !item.is_active) throw new KuroEconomyError(404, "このアイテムは現在取得できません。");
    if (!item.is_free || Number(item.price_kc) !== 0) throw new KuroEconomyError(400, "このアイテムは無料取得の対象ではありません。");
    const owned = await db.prepare("SELECT id FROM kuro_store_user_inventory WHERE user_id=? AND item_id=?").bind(user.id, itemId).first();
    if (owned) return { result: { ok: true, alreadyOwned: true } };
    const inventoryId = uuid();
    const transactionId = uuid();
    const now = isoNow();
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO kuro_store_user_inventory(id,user_id,item_id,source,acquired_at) SELECT ?,?,?, 'free_claim', ? WHERE EXISTS(SELECT 1 FROM kuro_store_items WHERE id=? AND is_active=1 AND is_free=1 AND price_kc=0 AND deleted_at IS NULL)")
        .bind(inventoryId, user.id, itemId, now, itemId),
      db.prepare("INSERT INTO kuro_store_transactions(id,user_id,item_id,inventory_id,transaction_type,amount_kc,status,created_at) SELECT ?,?,?,?,'free_claim',0,'completed',? WHERE EXISTS(SELECT 1 FROM kuro_store_user_inventory WHERE id=? AND user_id=?)")
        .bind(transactionId, user.id, itemId, inventoryId, now, inventoryId, user.id)
    ]);
    const created = await db.prepare("SELECT id FROM kuro_store_user_inventory WHERE user_id=? AND item_id=?").bind(user.id, itemId).first();
    return { result: { ok: true, alreadyOwned: created?.id !== inventoryId, inventoryId: created?.id || null } };
  }

  if (action === "purchase") {
    const itemId = String(body.itemId || "");
    const requestId = String(body.requestId || "");
    if (!UUID_RE.test(itemId) || !UUID_RE.test(requestId)) throw new KuroEconomyError(400, "購入リクエストが正しくありません。");
    const existing = await db.prepare("SELECT item_id,amount_kc FROM kuro_store_transactions WHERE user_id=? AND request_id=?").bind(user.id, requestId).first();
    if (existing) {
      if (existing.item_id !== itemId) throw new KuroEconomyError(409, "購入リクエストが重複しました。ページを再読み込みしてください。");
      return { result: { ok: true, alreadyOwned: true, alreadyPurchased: true, charged: false, priceKC: Number(existing.amount_kc) } };
    }
    const item = await db.prepare("SELECT id,name,item_key,is_active,is_free,price_kc FROM kuro_store_items WHERE id=? AND deleted_at IS NULL").bind(itemId).first();
    if (!item || !item.is_active) throw new KuroEconomyError(404, "このアイテムは現在販売されていません。");
    if (item.is_free || Number(item.price_kc) <= 0) throw new KuroEconomyError(400, "この商品は無料アイテムです。");
    const owned = await db.prepare("SELECT id FROM kuro_store_user_inventory WHERE user_id=? AND item_id=?").bind(user.id, itemId).first();
    if (owned) return { result: { ok: true, alreadyOwned: true, charged: false, priceKC: 0 } };
    const inventoryId = uuid();
    const ledgerId = uuid();
    const transactionId = uuid();
    const now = isoNow();
    const results = await db.batch([
      db.prepare("INSERT OR IGNORE INTO kuro_coin_balances(user_id,balance,updated_at) VALUES(?,0,?)").bind(user.id, now),
      db.prepare("UPDATE kuro_coin_balances SET balance=balance-(SELECT price_kc FROM kuro_store_items WHERE id=? AND is_active=1 AND is_free=0 AND price_kc>0 AND deleted_at IS NULL),updated_at=? WHERE user_id=? AND balance >= (SELECT price_kc FROM kuro_store_items WHERE id=? AND is_active=1 AND is_free=0 AND price_kc>0 AND deleted_at IS NULL) AND NOT EXISTS(SELECT 1 FROM kuro_store_user_inventory WHERE user_id=? AND item_id=?) AND NOT EXISTS(SELECT 1 FROM kuro_store_transactions WHERE user_id=? AND request_id=?)")
        .bind(itemId, now, user.id, itemId, user.id, itemId, user.id, requestId),
      db.prepare("INSERT OR IGNORE INTO kuro_store_user_inventory(id,user_id,item_id,source,acquired_at) SELECT ?,?,?, 'shop_purchase', ? WHERE changes()=1")
        .bind(inventoryId, user.id, itemId, now),
      db.prepare("INSERT INTO kuro_coin_ledger(id,user_id,amount,balance_after,transaction_type,description,metadata,created_at) SELECT ?,?, -i.price_kc, b.balance,'shop_purchase','KURO STORE購入：'||i.name,?,? FROM kuro_store_items i JOIN kuro_coin_balances b ON b.user_id=? JOIN kuro_store_user_inventory inv ON inv.id=? AND inv.user_id=? WHERE i.id=?")
        .bind(ledgerId, user.id, JSON.stringify({ itemId, itemKey: item.item_key, requestId }), now, user.id, inventoryId, user.id, itemId),
      db.prepare("INSERT INTO kuro_store_transactions(id,user_id,item_id,inventory_id,transaction_type,amount_kc,status,created_at,request_id) SELECT ?,?,?,?,'shop_purchase',i.price_kc,'completed',?,? FROM kuro_store_items i JOIN kuro_store_user_inventory inv ON inv.id=? WHERE i.id=?")
        .bind(transactionId, user.id, itemId, inventoryId, now, requestId, inventoryId, itemId)
    ]);
    const bought = await db.prepare("SELECT item_id,amount_kc,inventory_id FROM kuro_store_transactions WHERE user_id=? AND request_id=?").bind(user.id, requestId).first();
    if (bought) {
      if (bought.item_id !== itemId) throw new KuroEconomyError(409, "購入リクエストが重複しました。ページを再読み込みしてください。");
      return { result: { ok: true, alreadyOwned: false, charged: true, priceKC: Number(bought.amount_kc), balance: Number((await db.prepare("SELECT balance FROM kuro_coin_balances WHERE user_id=?").bind(user.id).first())?.balance || 0), inventoryId: bought.inventory_id } };
    }
    const latestItem = await db.prepare("SELECT is_active,is_free,price_kc FROM kuro_store_items WHERE id=?").bind(itemId).first();
    if (!latestItem || !latestItem.is_active) throw new KuroEconomyError(404, "このアイテムは現在販売されていません。");
    if (latestItem.is_free || Number(latestItem.price_kc) <= 0) throw new KuroEconomyError(400, "この商品は無料アイテムです。");
    const latestOwned = await db.prepare("SELECT id FROM kuro_store_user_inventory WHERE user_id=? AND item_id=?").bind(user.id, itemId).first();
    if (latestOwned) return { result: { ok: true, alreadyOwned: true, charged: false, priceKC: 0 } };
    const balance = Number((await db.prepare("SELECT balance FROM kuro_coin_balances WHERE user_id=?").bind(user.id).first())?.balance || 0);
    if (balance < Number(latestItem.price_kc)) throw new KuroEconomyError(409, "KURO COINが不足しています。");
    throw new KuroEconomyError(409, "購入状態を確定できませんでした。ページを再読み込みしてください。");
  }

  if (action === "discard_item") {
    const inventoryId = String(body.inventoryId || "");
    if (!UUID_RE.test(inventoryId)) throw new KuroEconomyError(400, "所持アイテムIDが正しくありません。");
    const item = await db.prepare("SELECT inv.item_id,i.name FROM kuro_store_user_inventory inv JOIN kuro_store_items i ON i.id=inv.item_id WHERE inv.id=? AND inv.user_id=?").bind(inventoryId, user.id).first();
    if (!item) throw new KuroEconomyError(404, "このアイテムは所持品に見つかりません。ページを再読み込みしてください。");
    await db.batch([
      db.prepare("DELETE FROM kuro_store_equipped_items WHERE user_id=? AND item_id=?").bind(user.id, item.item_id),
      db.prepare("DELETE FROM kuro_store_user_inventory WHERE id=? AND user_id=?").bind(inventoryId, user.id)
    ]);
    return { result: { ok: true, discarded: true, itemId: item.item_id, itemName: item.name } };
  }

  if (action === "equip") {
    const slot = String(body.slot || "");
    const itemId = body.itemId == null ? null : String(body.itemId);
    const slots = ["avatar","frame","background","theme","nameplate","banner"];
    if (!slots.includes(slot)) throw new KuroEconomyError(400, "装備スロットが正しくありません。");
    if (itemId !== null && !UUID_RE.test(itemId)) throw new KuroEconomyError(400, "アイテムIDが正しくありません。");
    if (itemId === null) {
      await db.prepare("DELETE FROM kuro_store_equipped_items WHERE user_id=? AND slot=?").bind(user.id, slot).run();
      return { result: { ok: true, equipped: false, slot } };
    }
    const item = await db.prepare("SELECT i.category FROM kuro_store_items i JOIN kuro_store_user_inventory inv ON inv.item_id=i.id AND inv.user_id=? WHERE i.id=?").bind(user.id, itemId).first();
    if (!item || (slot === "avatar" ? !["avatar","icon_image"].includes(item.category) : item.category !== slot)) {
      throw new KuroEconomyError(403, "このスロットに装備できる所持アイテムではありません。");
    }
    const now = isoNow();
    await db.prepare("INSERT INTO kuro_store_equipped_items(user_id,slot,item_id,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,slot) DO UPDATE SET item_id=excluded.item_id,updated_at=excluded.updated_at")
      .bind(user.id, slot, itemId, now).run();
    return { result: { ok: true, equipped: true, slot, itemId } };
  }

  if (action === "studio_sales") {
    const summary = await db.prepare("SELECT COUNT(*) AS purchaseCount, COALESCE(SUM(amount_kc),0) AS totalKC FROM kuro_store_transactions WHERE transaction_type='shop_purchase' AND status='completed'").first();
    const recentSales = await getAll(db.prepare("SELECT t.id,t.amount_kc,t.created_at,i.name,i.item_key FROM kuro_store_transactions t LEFT JOIN kuro_store_items i ON i.id=t.item_id WHERE t.transaction_type='shop_purchase' AND t.status='completed' ORDER BY t.created_at DESC LIMIT 20"));
    return { summary: { purchaseCount: Number(summary?.purchaseCount || 0), totalKC: Number(summary?.totalKC || 0) }, recentSales: recentSales.map(row => ({ id: row.id, amount_kc: row.amount_kc, created_at: row.created_at, item: { name: row.name, item_key: row.item_key } })) };
  }

  throw new KuroEconomyError(400, "ストア操作が正しくありません。");
}

async function handleNotifications(request, db, user) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const limitInput = Number(url.searchParams.get("limit") || 100);
    const limit = Number.isFinite(limitInput) ? Math.max(1, Math.min(200, Math.floor(limitInput))) : 100;
    const unreadOnly = url.searchParams.get("unread") === "1";
    const count = await db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE recipient_id=? AND read_at IS NULL").bind(user.id).first();
    const query = "SELECT n.id,n.type,n.actor_id,n.created_at,n.read_at,n.group_id,n.message_id,n.notification_details,p.username,p.display_name FROM notifications n LEFT JOIN profiles p ON p.id=n.actor_id WHERE n.recipient_id=?" +
      (unreadOnly ? " AND n.read_at IS NULL" : "") + " ORDER BY n.created_at DESC LIMIT ?";
    const result = await getAll(db.prepare(query).bind(user.id, limit));
    return {
      notifications: result.map(row => ({
        id: row.id, type: row.type, actor_id: row.actor_id, created_at: row.created_at, read_at: row.read_at,
        group_id: row.group_id, message_id: row.message_id,
        notification_details: (() => { try { return JSON.parse(row.notification_details || "{}"); } catch (_) { return {}; } })(),
        actor: row.actor_id ? { id: row.actor_id, username: row.username, display_name: row.display_name } : null
      })),
      unread_count: Number(count?.count || 0)
    };
  }
  if (request.method !== "POST") throw new KuroEconomyError(405, "Method not allowed");
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  if (action === "mark_read") {
    const id = String(body.id || "");
    if (!UUID_RE.test(id)) throw new KuroEconomyError(400, "通知IDが正しくありません。");
    await db.prepare("UPDATE notifications SET read_at=? WHERE id=? AND recipient_id=? AND read_at IS NULL")
      .bind(isoNow(), id, user.id).run();
    return { ok: true };
  }
  if (action === "mark_all_read") {
    await db.prepare("UPDATE notifications SET read_at=? WHERE recipient_id=? AND read_at IS NULL")
      .bind(isoNow(), user.id).run();
    return { ok: true };
  }
  throw new KuroEconomyError(400, "通知操作が正しくありません。");
}

export async function handleKuroEconomyRequest(request, env) {
  const origin = request.headers.get("Origin") || null;
  if (request.method === "OPTIONS") {
    const headers = {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin"
    };
    if (origin === "https://kurolab.cc.cd" || origin === "https://admin.kurolab.cc.cd") headers["Access-Control-Allow-Origin"] = origin;
    return new Response(null, { status: 204, headers });
  }

  try {
    const db = await requireDb(env);
    const url = new URL(request.url);
    const isAdmin = url.pathname === "/api/kuro-economy/admin";
    const isStore = url.pathname === "/api/kuro-economy/store";
    const isNotifications = url.pathname === "/api/kuro-economy/notifications";
    if (!isAdmin && !isStore && !isNotifications) throw new KuroEconomyError(404, "not_found");

    const user = await authenticate(request, db, {
      adminTool: isAdmin,
      studioTool: isStore && request.method === "POST" && (request.headers.get("X-KURO-Store-Tool") === "shop-studio")
    });

    if (isNotifications) {
      const data = await handleNotifications(request, db, user);
      return response(data, 200, origin);
    }
    if (request.method !== "POST") throw new KuroEconomyError(405, "POST required");
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 32768) throw new KuroEconomyError(413, "Request body is too large.");
    let body;
    try { body = raw ? JSON.parse(raw) : {}; } catch (_) { throw new KuroEconomyError(400, "JSONが正しくありません。"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new KuroEconomyError(400, "JSONが正しくありません。");
    const action = typeof body.action === "string" ? body.action : "";
    const data = isAdmin
      ? await handleAdmin(action, body, db, user)
      : await handleStore(action, body, db, user);
    return response(data, 200, origin);
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error("[KURO D1 economy]", String(error?.message || error).slice(0, 200));
    return response({ error: error?.message || "経済処理に失敗しました。" }, status, origin);
  }
}
