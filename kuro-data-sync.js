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
  "kuro_coin_balances", "kuro_coin_game_rewards", "kuro_coin_ledger",
  "kuro_coin_verified_game_events", "kuro_game_user_stats", "kuro_game_win_events",
  "kuro_level_coin_reward_claims", "kuro_level_coin_rewards", "kuro_level_game_rewards",
  "kuro_level_ledger", "kuro_level_system_settings", "kuro_level_thresholds", "kuro_level_users",
  "kuro_store_design_drafts", "kuro_store_equipped_items", "kuro_store_items",
  "kuro_store_studio_members", "kuro_store_user_inventory",
  "kurogames_home_banners", "portal_announcements", "portal_history",
  "portal_preferences", "admin_message_reads", "admin_messages", "feature_flags",
  "user_last_activity"
]);

// Legacy favorites events are acknowledged without being copied to D1.
const RETIRED_SYNC_TABLES = new Set(["portal_favorites"]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
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
