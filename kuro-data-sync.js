const SUPABASE_URL = "https://cprvpphlfpmiegjiutjn.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn";
const PULL_RPC = "/rest/v1/rpc/kuro_cloudflare_sync_pull";
const ACK_RPC = "/rest/v1/rpc/kuro_cloudflare_sync_ack";
const BATCH_SIZE = 100;

const SYNC_TABLES = new Set([
  "profiles", "posts", "post_likes", "post_replies", "follows", "notifications",
  "account_suspensions", "__kuro_economy_mirror_control",
  "chat_conversations", "chat_messages", "chat_message_reads", "chat_message_hides",
  "group_conversations", "group_chat_members", "group_chat_messages",
  "group_chat_message_reads", "group_chat_mentions",
  "public_chat_daily_stats", "public_chat_messages", "game_activity_presence",
  "game_daifugo_private_sessions", "game_daifugo_room_ready",
  "game_online_matchmaking", "game_online_room_members", "game_online_room_messages",
  "game_online_rooms", "game_online_settings", "game_saves", "game_scores",
  "game_sevens_private_sessions", "game_sevens_results", "game_sevens_room_votes",
  "game_studio_games", "game_tictactoe_verified_events", "game_tictactoe_verified_stats",
  "game_world_blocks", "werewolf_action_receipts", "werewolf_chat_messages",
  "werewolf_private_sessions", "werewolf_rooms",
  "kuro_coin_verified_game_events", "kuro_game_user_stats", "kuro_game_win_events", "kuro_economy_pending_events",
  "kuro_store_design_drafts", "kuro_store_items", "kuro_store_studio_members",
  "kurogames_home_banners", "portal_announcements", "portal_history",
  "portal_preferences", "admin_message_reads", "admin_messages", "feature_flags",
  "user_last_activity"
]);

// Legacy favorites events are acknowledged without being copied to D1.
const RETIRED_SYNC_TABLES = new Set(["portal_favorites", "kuro_coin_balances", "kuro_coin_game_rewards", "kuro_coin_ledger", "kuro_level_coin_reward_claims", "kuro_level_coin_rewards", "kuro_level_game_rewards", "kuro_level_ledger", "kuro_level_system_settings", "kuro_level_thresholds", "kuro_level_users", "kuro_store_equipped_items", "kuro_store_user_inventory", "kuro_store_transactions"]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}



async function ensureEconomySchema(db) {
  const statements = [
    "CREATE TABLE IF NOT EXISTS kuro_economy_pending_events (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, source_table TEXT NOT NULL, source_id TEXT NOT NULL, user_id TEXT NOT NULL, game_id TEXT, mode TEXT, submission_id TEXT, cpu_difficulty TEXT, verified_score INTEGER, result TEXT, created_at TEXT NOT NULL)",
    "CREATE UNIQUE INDEX IF NOT EXISTS kuro_economy_pending_event_source_uq ON kuro_economy_pending_events(event_type, source_table, source_id)",
    "CREATE TABLE IF NOT EXISTS kuro_economy_processed_events (event_id TEXT PRIMARY KEY, process_state INTEGER NOT NULL DEFAULT 0, processed_at TEXT NOT NULL)",
    "CREATE UNIQUE INDEX IF NOT EXISTS kuro_coin_ledger_game_award_uq ON kuro_coin_ledger(user_id, source_game_id, source_submission_id) WHERE transaction_type='game_win_reward' AND source_game_id IS NOT NULL AND source_submission_id IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS kuro_level_ledger_submission_uq ON kuro_level_ledger(user_id, source_game_id, source_mode, source_submission_id) WHERE source_submission_id IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS kuro_level_coin_claim_user_level_uq ON kuro_level_coin_reward_claims(user_id, level)",
    "CREATE UNIQUE INDEX IF NOT EXISTS kuro_store_inventory_user_item_uq ON kuro_store_user_inventory(user_id, item_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS kuro_store_transaction_request_uq ON kuro_store_transactions(user_id, request_id) WHERE request_id IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS kuro_notifications_recipient_created_idx ON notifications(recipient_id, created_at DESC)",
    "CREATE TABLE IF NOT EXISTS kuro_economy_schema_meta (id INTEGER PRIMARY KEY CHECK (id=1), version INTEGER NOT NULL, updated_at TEXT NOT NULL)",
  ];
  await db.batch(statements.map(sql => db.prepare(sql)));

  const current = await db.prepare(
    "SELECT version FROM kuro_economy_schema_meta WHERE id=1"
  ).first();
  if (Number(current?.version || 0) < 1) {
    const triggerStatements = [
      "DROP TRIGGER IF EXISTS kuro_economy_coin_notification",
      "CREATE TRIGGER kuro_economy_coin_notification AFTER INSERT ON kuro_coin_ledger WHEN NEW.amount > 0 BEGIN INSERT INTO notifications(id,recipient_id,actor_id,type,created_at,notification_details) VALUES(lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),NEW.user_id,NEW.user_id,'coin_reward',NEW.created_at,json_object('ledgerId',NEW.id,'amount',NEW.amount,'balanceAfter',NEW.balance_after,'description',NEW.description,'transactionType',NEW.transaction_type,'gameId',NEW.source_game_id,'mode',NEW.source_mode,'createdAt',NEW.created_at)); END",
      "DROP TRIGGER IF EXISTS kuro_economy_level_coin_claim",
      "CREATE TRIGGER kuro_economy_level_coin_claim AFTER INSERT ON kuro_level_coin_reward_claims BEGIN INSERT OR IGNORE INTO kuro_coin_balances(user_id,balance,updated_at) VALUES(NEW.user_id,0,NEW.created_at); UPDATE kuro_coin_balances SET balance=balance+NEW.reward_amount,updated_at=NEW.created_at WHERE user_id=NEW.user_id; INSERT OR IGNORE INTO kuro_coin_ledger(id,user_id,amount,balance_after,transaction_type,description,metadata,created_at) SELECT NEW.id,NEW.user_id,NEW.reward_amount,balance,'level_reward','レベル到達報酬：Lv.'||NEW.level,json_object('source','kuro_level_milestone','level',NEW.level,'claimId',NEW.id),NEW.created_at FROM kuro_coin_balances WHERE user_id=NEW.user_id; UPDATE kuro_level_coin_reward_claims SET balance_after=(SELECT balance FROM kuro_coin_balances WHERE user_id=NEW.user_id),coin_ledger_id=NEW.id WHERE id=NEW.id; END",
      "DROP TRIGGER IF EXISTS kuro_economy_level_insert",
      "CREATE TRIGGER kuro_economy_level_insert AFTER INSERT ON kuro_level_users WHEN NEW.current_level > 1 BEGIN INSERT OR IGNORE INTO kuro_level_coin_reward_claims(id,user_id,level,reward_amount,balance_after,coin_ledger_id,created_at) SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),NEW.user_id,r.level,r.reward_amount,0,NULL,NEW.updated_at FROM kuro_level_coin_rewards r WHERE r.enabled=1 AND r.reward_amount>0 AND r.level>1 AND r.level<=NEW.current_level ORDER BY r.level; INSERT INTO notifications(id,recipient_id,actor_id,type,created_at,notification_details) VALUES(lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),NEW.user_id,NEW.user_id,'level_up',NEW.updated_at,json_object('fromLevel',1,'toLevel',NEW.current_level,'source','kuro_level_system')); END",
      "DROP TRIGGER IF EXISTS kuro_economy_level_update",
      "CREATE TRIGGER kuro_economy_level_update AFTER UPDATE OF current_level ON kuro_level_users WHEN NEW.current_level > OLD.current_level BEGIN INSERT OR IGNORE INTO kuro_level_coin_reward_claims(id,user_id,level,reward_amount,balance_after,coin_ledger_id,created_at) SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),NEW.user_id,r.level,r.reward_amount,0,NULL,NEW.updated_at FROM kuro_level_coin_rewards r WHERE r.enabled=1 AND r.reward_amount>0 AND r.level>OLD.current_level AND r.level<=NEW.current_level ORDER BY r.level; INSERT INTO notifications(id,recipient_id,actor_id,type,created_at,notification_details) VALUES(lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),NEW.user_id,NEW.user_id,'level_up',NEW.updated_at,json_object('fromLevel',OLD.current_level,'toLevel',NEW.current_level,'source','kuro_level_system')); END",
      "DROP TRIGGER IF EXISTS kuro_economy_process_pending_event",
      "CREATE TRIGGER kuro_economy_process_pending_event AFTER INSERT ON kuro_economy_pending_events BEGIN INSERT OR IGNORE INTO kuro_economy_processed_events(event_id,process_state,processed_at) VALUES(NEW.id,0,datetime('now')); UPDATE kuro_economy_processed_events SET process_state=1,processed_at=datetime('now') WHERE event_id=NEW.id AND process_state=0; INSERT OR IGNORE INTO kuro_level_ledger(id,user_id,xp_amount,total_xp_after,source_game_id,source_mode,source_win_event_id,reason,created_by,created_at,source_submission_id) SELECT NEW.id,NEW.user_id,CASE WHEN COALESCE((SELECT enabled FROM kuro_level_system_settings WHERE singleton=1),1)<>1 THEN 0 WHEN EXISTS(SELECT 1 FROM kuro_level_game_rewards WHERE game_id=NEW.game_id) THEN COALESCE((SELECT xp_per_win FROM kuro_level_game_rewards WHERE game_id=NEW.game_id AND enabled=1),0) ELSE COALESCE((SELECT default_win_xp FROM kuro_level_system_settings WHERE singleton=1),100) END,0,NEW.game_id,NEW.mode,NULL,'ゲーム勝利報酬',NULL,NEW.created_at,NEW.submission_id WHERE NEW.event_type='xp_win' AND (SELECT process_state FROM kuro_economy_processed_events WHERE event_id=NEW.id)=1 AND CASE WHEN COALESCE((SELECT enabled FROM kuro_level_system_settings WHERE singleton=1),1)<>1 THEN 0 WHEN EXISTS(SELECT 1 FROM kuro_level_game_rewards WHERE game_id=NEW.game_id) THEN COALESCE((SELECT xp_per_win FROM kuro_level_game_rewards WHERE game_id=NEW.game_id AND enabled=1),0) ELSE COALESCE((SELECT default_win_xp FROM kuro_level_system_settings WHERE singleton=1),100) END>0 AND NOT EXISTS(SELECT 1 FROM kuro_level_ledger WHERE user_id=NEW.user_id AND source_game_id=NEW.game_id AND source_mode=NEW.mode AND source_submission_id=NEW.submission_id); INSERT OR IGNORE INTO kuro_level_users(user_id,total_xp,current_level,updated_at) SELECT NEW.user_id,0,1,NEW.created_at WHERE EXISTS(SELECT 1 FROM kuro_level_ledger WHERE id=NEW.id); UPDATE kuro_level_users SET total_xp=total_xp+(SELECT xp_amount FROM kuro_level_ledger WHERE id=NEW.id),current_level=(SELECT COALESCE(MAX(level),1) FROM kuro_level_thresholds WHERE required_xp<=total_xp+(SELECT xp_amount FROM kuro_level_ledger WHERE id=NEW.id)),updated_at=NEW.created_at WHERE user_id=NEW.user_id AND EXISTS(SELECT 1 FROM kuro_level_ledger WHERE id=NEW.id); UPDATE kuro_level_ledger SET total_xp_after=(SELECT total_xp FROM kuro_level_users WHERE user_id=NEW.user_id) WHERE id=NEW.id; INSERT OR IGNORE INTO kuro_coin_balances(user_id,balance,updated_at) SELECT NEW.user_id,0,NEW.created_at WHERE (SELECT process_state FROM kuro_economy_processed_events WHERE event_id=NEW.id)=1 AND (NEW.event_type IN ('coin_verified_game','coin_verified_win','coin_werewolf')) AND ((NEW.event_type='coin_verified_game' AND ((NEW.game_id IN ('faa155cb-2143-4361-9a96-dc759d334e46','2eb37847-1b7e-43e4-ad98-901d5b830ac4') AND NEW.mode='wins-online') OR (NEW.game_id='4ccccb72-d5db-4098-a7d4-1c28a0755e7b' AND NEW.mode='online') OR (NEW.game_id='903a4c45-37bb-4a4b-a259-a5a8245de998' AND NEW.mode IN ('werewolf_villager_wins','werewolf_wolf_wins')))) OR (NEW.event_type='coin_verified_win' AND ((NEW.game_id IN ('faa155cb-2143-4361-9a96-dc759d334e46','2eb37847-1b7e-43e4-ad98-901d5b830ac4') AND NEW.mode='wins-online') OR (NEW.game_id='4ccccb72-d5db-4098-a7d4-1c28a0755e7b' AND NEW.mode='online') OR (NEW.game_id='903a4c45-37bb-4a4b-a259-a5a8245de998' AND NEW.mode IN ('werewolf_villager_wins','werewolf_wolf_wins')))) OR (NEW.event_type='coin_werewolf' AND NEW.game_id='903a4c45-37bb-4a4b-a259-a5a8245de998' AND NEW.mode IN ('werewolf_villager_wins','werewolf_wolf_wins'))) AND upper(COALESCE(NEW.cpu_difficulty,'NONE'))='NONE' AND EXISTS(SELECT 1 FROM kuro_coin_game_rewards gr WHERE gr.game_id=NEW.game_id AND gr.mode=NEW.mode AND gr.required_cpu_difficulty='NONE' AND gr.enabled=1 AND gr.reward_type='fixed' AND gr.reward_amount BETWEEN 1 AND 1000); INSERT OR IGNORE INTO kuro_coin_ledger(id,user_id,amount,balance_after,transaction_type,source_game_id,source_mode,source_submission_id,description,metadata,created_at) SELECT NEW.id,NEW.user_id,gr.reward_amount,(SELECT balance FROM kuro_coin_balances WHERE user_id=NEW.user_id)+gr.reward_amount,'game_win_reward',NEW.game_id,NEW.mode,NEW.submission_id,gr.reward_label,json_object('cpuDifficulty','NONE','source','verified-online-win','rewardType','fixed'),NEW.created_at FROM kuro_coin_game_rewards gr WHERE (SELECT process_state FROM kuro_economy_processed_events WHERE event_id=NEW.id)=1 AND NEW.event_type IN ('coin_verified_game','coin_verified_win','coin_werewolf') AND ((NEW.event_type='coin_verified_game' AND ((NEW.game_id IN ('faa155cb-2143-4361-9a96-dc759d334e46','2eb37847-1b7e-43e4-ad98-901d5b830ac4') AND NEW.mode='wins-online') OR (NEW.game_id='4ccccb72-d5db-4098-a7d4-1c28a0755e7b' AND NEW.mode='online') OR (NEW.game_id='903a4c45-37bb-4a4b-a259-a5a8245de998' AND NEW.mode IN ('werewolf_villager_wins','werewolf_wolf_wins')))) OR (NEW.event_type='coin_verified_win' AND ((NEW.game_id IN ('faa155cb-2143-4361-9a96-dc759d334e46','2eb37847-1b7e-43e4-ad98-901d5b830ac4') AND NEW.mode='wins-online') OR (NEW.game_id='4ccccb72-d5db-4098-a7d4-1c28a0755e7b' AND NEW.mode='online') OR (NEW.game_id='903a4c45-37bb-4a4b-a259-a5a8245de998' AND NEW.mode IN ('werewolf_villager_wins','werewolf_wolf_wins')))) OR (NEW.event_type='coin_werewolf' AND NEW.game_id='903a4c45-37bb-4a4b-a259-a5a8245de998' AND NEW.mode IN ('werewolf_villager_wins','werewolf_wolf_wins'))) AND upper(COALESCE(NEW.cpu_difficulty,'NONE'))='NONE' AND gr.game_id=NEW.game_id AND gr.mode=NEW.mode AND gr.required_cpu_difficulty='NONE' AND gr.enabled=1 AND gr.reward_type='fixed' AND gr.reward_amount BETWEEN 1 AND 1000 AND NOT EXISTS(SELECT 1 FROM kuro_coin_ledger l WHERE l.user_id=NEW.user_id AND l.source_game_id=NEW.game_id AND l.source_submission_id=NEW.submission_id AND l.transaction_type='game_win_reward'); UPDATE kuro_coin_balances SET balance=(SELECT balance_after FROM kuro_coin_ledger WHERE id=NEW.id),updated_at=NEW.created_at WHERE user_id=NEW.user_id AND EXISTS(SELECT 1 FROM kuro_coin_ledger WHERE id=NEW.id AND transaction_type='game_win_reward'); UPDATE kuro_economy_processed_events SET process_state=2,processed_at=datetime('now') WHERE event_id=NEW.id AND process_state=1; END",
    ];
    await db.batch(triggerStatements.map(sql => db.prepare(sql)));
    await db.prepare(
      "INSERT INTO kuro_economy_schema_meta(id,version,updated_at) VALUES(1,1,datetime('now')) ON CONFLICT(id) DO UPDATE SET version=excluded.version,updated_at=excluded.updated_at"
    ).run();
  }
}
async function ensureStateTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS __kuro_cloudflare_sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_attempt_at TEXT,
      last_success_at TEXT,
      last_event_id TEXT,
      last_batch_size INTEGER NOT NULL DEFAULT 0,
      total_events INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    )
  `).run();
  await db.prepare(
    "INSERT OR IGNORE INTO __kuro_cloudflare_sync_state (id, last_batch_size, total_events) VALUES (1, 0, 0)"
  ).run();
}

function quoteIdentifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error("Sync event contains an invalid SQL identifier");
  }
  return '"' + value + '"';
}

function toD1Value(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Sync event contains a non-finite number");
    return value;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function makeDeleteStatement(db, tableName, key) {
  if (!key || typeof key !== "object" || Array.isArray(key)) {
    throw new Error("Sync delete event is missing its primary key");
  }
  const entries = Object.entries(key);
  if (!entries.length) throw new Error("Sync delete event has an empty primary key");
  const where = entries.map(([column]) => quoteIdentifier(column) + " = ?").join(" AND ");
  return db.prepare("DELETE FROM " + quoteIdentifier(tableName) + " WHERE " + where)
    .bind(...entries.map(([, value]) => toD1Value(value)));
}

function makeUpsertStatement(db, tableName, row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Sync upsert event is missing its row data");
  }
  const entries = Object.entries(row);
  if (!entries.length) throw new Error("Sync upsert event contains an empty row");
  const columns = entries.map(([column]) => quoteIdentifier(column)).join(", ");
  const placeholders = entries.map(() => "?").join(", ");
  const values = entries.map(([, value]) => toD1Value(value));
  return db.prepare(
    "INSERT OR REPLACE INTO " + quoteIdentifier(tableName) +
    " (" + columns + ") VALUES (" + placeholders + ")"
  ).bind(...values);
}

async function callSyncRpc(path, secret, body) {
  const response = await fetch(SUPABASE_URL + path, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_PUBLISHABLE_KEY,
      "Authorization": "Bearer " + SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({ ...body, p_secret: secret }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    // Never log the RPC body: it can contain sensitive database diagnostics.
    throw new Error("Supabase sync RPC failed with HTTP " + response.status);
  }
  return response.json();
}

async function updateSyncState(db, values) {
  await db.prepare(`
    UPDATE __kuro_cloudflare_sync_state
    SET last_attempt_at = datetime('now'),
        last_success_at = COALESCE(?, last_success_at),
        last_event_id = COALESCE(?, last_event_id),
        last_batch_size = ?,
        total_events = total_events + ?,
        last_error = ?
    WHERE id = 1
  `).bind(
    values.lastSuccessAt ?? null,
    values.lastEventId ?? null,
    values.batchSize ?? 0,
    values.totalEvents ?? 0,
    values.error ? String(values.error).slice(0, 400) : null
  ).run();
}

async function runSync(env, scheduledAt) {
  const db = env.KURO_APP_DB;
  if (!db) throw new Error("KURO_APP_DB binding is missing");
  await ensureStateTable(db);
  await ensureEconomySchema(db);

  if (!env.KURO_SYNC_SECRET || env.KURO_SYNC_SECRET.length < 40) {
    console.warn("KURO mirror sync is not activated: KURO_SYNC_SECRET is missing");
    return { skipped: true, reason: "secret_not_configured" };
  }

  try {
    const events = await callSyncRpc(PULL_RPC, env.KURO_SYNC_SECRET, {
      p_limit: BATCH_SIZE
    });
    if (!Array.isArray(events)) throw new Error("Supabase sync pull returned an invalid payload");

    if (events.length === 0) {
      await updateSyncState(db, {
        lastSuccessAt: new Date().toISOString(),
        batchSize: 0,
        totalEvents: 0,
        error: null
      });
      return { processed: 0, acknowledged: 0 };
    }

    // Validate the complete batch before touching D1. Event IDs arrive as
    // decimal strings from Postgres bigint columns.
    const ids = events.map(event => String(event?.event_id ?? ""));
    if (ids.length !== events.length || ids.some(id => !/^\d+$/.test(id))) {
      throw new Error("Sync queue contains an invalid event id");
    }

    const statements = [];
    for (const event of events) {
      if (!event || typeof event !== "object") throw new Error("Sync queue contains an invalid event");
      const tableName = String(event.table_name || "");
      const operation = String(event.operation || "").toUpperCase();
      if (RETIRED_SYNC_TABLES.has(tableName)) {
        if (operation !== "INSERT" && operation !== "UPDATE" && operation !== "DELETE") {
          throw new Error("Sync queue contains an unsupported operation");
        }
        continue;
      }
      if (!SYNC_TABLES.has(tableName)) throw new Error("Sync queue contains a table outside the allowlist");

      if (operation === "UPDATE" || operation === "DELETE") {
        statements.push(makeDeleteStatement(db, tableName, event.old_pk));
      }
      if (operation === "INSERT" || operation === "UPDATE") {
        statements.push(makeUpsertStatement(db, tableName, event.row_data));
      }
      if (operation !== "INSERT" && operation !== "UPDATE" && operation !== "DELETE") {
        throw new Error("Sync queue contains an unsupported operation");
      }
    }

    // D1 batch is transactional and executes statements in order. The queue is
    // acknowledged only after this succeeds, so a failure is safely retried.
    if (statements.length) await db.batch(statements);

    await callSyncRpc(ACK_RPC, env.KURO_SYNC_SECRET, {
      p_event_ids: ids
    });

    const lastEventId = ids[ids.length - 1];
    await updateSyncState(db, {
      lastSuccessAt: new Date().toISOString(),
      lastEventId,
      batchSize: events.length,
      totalEvents: events.length,
      error: null
    });

    console.log("KURO Cloudflare mirror sync completed", {
      processed: events.length,
      acknowledged: ids.length,
      lastEventId,
      scheduledAt: scheduledAt || null
    });
    return { processed: events.length, acknowledged: ids.length, lastEventId };
  } catch (error) {
    try {
      await updateSyncState(db, {
        batchSize: 0,
        totalEvents: 0,
        error: error?.message || "sync_failed"
      });
    } catch (_) {
      // Preserve the original sync error.
    }
    console.error("KURO Cloudflare mirror sync failed", error?.message || "unknown_error");
    throw error;
  }
}

export default {
  async scheduled(controller, env) {
    await runSync(env, controller?.scheduledTime ? new Date(controller.scheduledTime).toISOString() : null);
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && (request.method === "GET" || request.method === "HEAD")) {
      if (!env?.KURO_APP_DB) return json({ ok: false, code: "d1_binding_missing" }, 503);
      try {
        await ensureStateTable(env.KURO_APP_DB);
        await ensureEconomySchema(env.KURO_APP_DB);
        const state = await env.KURO_APP_DB.prepare(
          "SELECT last_attempt_at, last_success_at, last_event_id, last_batch_size, total_events, last_error FROM __kuro_cloudflare_sync_state WHERE id = 1"
        ).first();
        return json({ ok: true, worker: "kuro-data-sync", syncConfigured: Boolean(env.KURO_SYNC_SECRET), state });
      } catch (_) {
        return json({ ok: false, code: "sync_health_unavailable" }, 503);
      }
    }
    return json({ error: "not_found" }, 404);
  }
};
