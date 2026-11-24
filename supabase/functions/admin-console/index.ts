import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://kurolab.cc.cd",
  "https://admin.kurolab.cc.cd"
]);

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function reply(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}


function featuresForPlan(plan: "standard" | "pro") {
  if (plan === "standard") return { workspace_plus:true, pro_tools:false, customization_plus:true, early_access:false, desktop:false, theme_studio:false, developer_mode:false, analytics:"basic", ai:false, ad_free:true };
  return { workspace_plus:true, pro_tools:true, customization_plus:true, early_access:true, desktop:true, theme_studio:true, developer_mode:true, analytics:"advanced", ai:true, ad_free:true };
}

function safeError(error: unknown) {
  return String((error as { message?: string })?.message || error || "Unknown error").slice(0, 240);
}

async function kuroRemoveOwnedStorageObjects(admin: any, userId: string) {
  const { data, error } = await admin.rpc("kuro_list_storage_objects_for_owner", {
    p_user_id: userId
  });
  if (error) throw new Error("Storage ownership lookup failed: " + String((error as { message?: string })?.message || error));

  const byBucket = new Map<string, string[]>();
  for (const row of Array.isArray(data) ? data : []) {
    const bucket = typeof row?.bucket_id === "string" ? row.bucket_id : "";
    const objectName = typeof row?.object_name === "string" ? row.object_name : "";
    if (!bucket || !objectName) continue;
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket)!.push(objectName);
  }

  for (const [bucket, objectNames] of byBucket) {
    for (let offset = 0; offset < objectNames.length; offset += 100) {
      const batch = objectNames.slice(offset, offset + 100);
      const { error: removeError } = await admin.storage.from(bucket).remove(batch);
      if (removeError) {
        throw new Error("Storage cleanup failed: " + bucket + ": " + String((removeError as { message?: string })?.message || removeError));
      }
    }
  }
  return { buckets: byBucket.size, objects: Array.from(byBucket.values()).reduce((n, items) => n + items.length, 0) };
}

async function kuroSecretHmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function kuroSecretDate(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reply({ error: "Origin not allowed" }, 403, origin);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return reply({ error: "Missing authorization" }, 401, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply({ error: "Server auth configuration is missing" }, 503, origin);

  try {
    const callerClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    const caller = callerData?.user;
    if (callerError || !caller) return reply({ error: "Unauthorized" }, 401, origin);

    const admin = createClient(url, service, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data: adminRecord, error: adminCheckError } = await admin
      .from("admin_users")
      .select("user_id,role")
      .eq("user_id", caller.id)
      .maybeSingle();

    if (adminCheckError || !adminRecord) return reply({ error: "Administrator access required" }, 403, origin);

    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "";
    const retiredPlanActions = new Set(["list_pro_management","review_pro_application","create_pro_invitation","update_pro_invitation","update_pro_membership","set_pro_user_control","set_user_plan"]);
    if (retiredPlanActions.has(action)) {
      return reply({ error: "KURO Labのプラン区分は終了しました。すべての利用者が共通機能を利用できます。" }, 410, origin);
    }



    if (action === "get_store_items") {
      const { data, error } = await admin.from("kuro_store_items")
        .select("id,item_key,name,description,category,icon,image_url,rarity,price_kc,is_free,is_active,sort_order,created_at,updated_at")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return reply({ items: data || [] }, 200, origin);
    }

    if (action === "save_store_item") {
      const itemId = typeof body.id === "string" ? body.id.trim() : "";
      const itemKey = typeof body.itemKey === "string" ? body.itemKey.trim().toLowerCase() : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const description = typeof body.description === "string" ? body.description.trim() : "";
      const category = typeof body.category === "string" ? body.category : "";
      const icon = typeof body.icon === "string" ? body.icon.trim() : "";
      const imageInput = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
      const rarity = typeof body.rarity === "string" ? body.rarity : "common";
      const sortOrder = Number(body.sortOrder ?? 100);
      const isActive = body.isActive !== false;
      const validCategories = new Set(["avatar", "frame", "background", "theme", "other"]);
      const validRarities = new Set(["common", "rare", "epic", "legendary"]);
      if (itemId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(itemId)) {
        return reply({ error: "商品IDが正しくありません。" }, 400, origin);
      }
      if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(itemKey)) return reply({ error: "商品キーは小文字英数字・_・-の2〜48文字で入力してください。" }, 400, origin);
      if (!name || name.length > 60) return reply({ error: "商品名は1〜60文字で入力してください。" }, 400, origin);
      if (description.length > 500) return reply({ error: "説明は500文字以内で入力してください。" }, 400, origin);
      if (!validCategories.has(category)) return reply({ error: "カテゴリーが正しくありません。" }, 400, origin);
      if (!icon || Array.from(icon).length > 12) return reply({ error: "アイコンは1〜12文字で入力してください。" }, 400, origin);
      if (imageInput.length > 500 || (imageInput && !(imageInput.startsWith("/") && !imageInput.startsWith("//")) && !/^https:\/\//i.test(imageInput))) {
        return reply({ error: "画像URLはサイト内パスまたはHTTPSのURLを指定してください。" }, 400, origin);
      }
      if (!validRarities.has(rarity)) return reply({ error: "レア度が正しくありません。" }, 400, origin);
      if (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) return reply({ error: "表示順は0〜9999で指定してください。" }, 400, origin);

      const values = {
        item_key: itemKey, name, description, category, icon,
        image_url: imageInput || null, rarity,
        price_kc: 0, is_free: true, is_active: isActive,
        sort_order: sortOrder, updated_at: new Date().toISOString()
      };
      let saved;
      if (itemId) {
        const { data, error } = await admin.from("kuro_store_items")
          .update(values).eq("id", itemId)
          .select("id,item_key,name,category,is_active").maybeSingle();
        if (error) {
          if (error.code === "23505") return reply({ error: "同じ商品キーがすでに登録されています。" }, 409, origin);
          throw error;
        }
        if (!data) return reply({ error: "商品が見つかりません。" }, 404, origin);
        saved = data;
      } else {
        const { data, error } = await admin.from("kuro_store_items")
          .insert({ ...values, created_by: caller.id })
          .select("id,item_key,name,category,is_active").single();
        if (error) {
          if (error.code === "23505") return reply({ error: "同じ商品キーがすでに登録されています。" }, 409, origin);
          throw error;
        }
        saved = data;
      }
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: itemId ? "kuro_store.item_update" : "kuro_store.item_create",
        metadata: saved
      });
      if (auditError) throw auditError;
      return reply({ item: saved }, 200, origin);
    }

    if (action === "deactivate_store_item") {
      const itemId = typeof body.id === "string" ? body.id.trim() : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(itemId)) {
        return reply({ error: "商品IDが正しくありません。" }, 400, origin);
      }
      const { data, error } = await admin.from("kuro_store_items")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", itemId).select("id,item_key,name,is_active").maybeSingle();
      if (error) throw error;
      if (!data) return reply({ error: "商品が見つかりません。" }, 404, origin);
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: "kuro_store.item_deactivate",
        metadata: data
      });
      if (auditError) throw auditError;
      return reply({ item: data }, 200, origin);
    }

    if (action === "get_coin_economy") {
      const [summaryResult, rewardsResult, ledgerResult, gamesResult] = await Promise.all([
        admin.rpc("kuro_coin_admin_overview"),
        admin.from("kuro_coin_game_rewards")
          .select("game_id,mode,reward_amount,enabled,required_cpu_difficulty,reward_label,reward_type,score_tiers,updated_at")
          .order("updated_at", { ascending: false }),
        admin.from("kuro_coin_ledger")
          .select("id,user_id,amount,balance_after,transaction_type,description,source_game_id,source_mode,created_at")
          .order("created_at", { ascending: false })
          .limit(60),
        admin.from("game_studio_games")
          .select("id,title,slug,icon,status")
          .order("title", { ascending: true })
      ]);
      if (summaryResult.error) throw summaryResult.error;
      if (rewardsResult.error) throw rewardsResult.error;
      if (ledgerResult.error) throw ledgerResult.error;
      if (gamesResult.error) throw gamesResult.error;

      const transactions = ledgerResult.data || [];
      const userIds = [...new Set(transactions.map((row) => row.user_id).filter(Boolean))];
      const { data: profiles, error: profileError } = userIds.length
        ? await admin.from("profiles").select("id,username,display_name,kuro_id").in("id", userIds)
        : { data: [], error: null };
      if (profileError) throw profileError;
      const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
      const gameMap = new Map((gamesResult.data || []).map((game) => [game.id, game]));
      return reply({
        summary: (Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data) || {
          total_balance: 0, total_issued: 0, total_spent: 0, funded_users: 0, transaction_count: 0
        },
        games: (gamesResult.data || []).filter((game) => [
          "2dbd6773-2684-4f00-973e-c46acbc348e7", // 〇✕ゲーム
          "faa155cb-2143-4361-9a96-dc759d334e46", // UNON online
          "79c9921a-d57a-45b1-8271-1ee7042801dc", // 素因数分解
          "bb466662-5423-48e6-bbcc-d19da50ba818", // 数字当て
          "5c1e658b-f6d3-412a-8b97-61d2c0457e95"  // 回転ずしタイピング
        ].includes(game.id)),
        rewards: (rewardsResult.data || []).map((reward) => ({
          ...reward,
          game: gameMap.get(reward.game_id) || null
        })),
        transactions: transactions.map((row) => ({
          ...row,
          profile: profileMap.get(row.user_id) || null,
          game: row.source_game_id ? (gameMap.get(row.source_game_id) || null) : null
        }))
      }, 200, origin);
    }

    if (action === "update_coin_reward") {
      const gameId = typeof body.gameId === "string" ? body.gameId : "";
      const mode = typeof body.mode === "string" ? body.mode.trim() : "";
      const rewardType = body.rewardType === "score_tier" ? "score_tier" : "fixed";
      const amount = Number(body.rewardAmount);
      const enabled = body.enabled === true;
      const difficulty = body.requiredCpuDifficulty == null || body.requiredCpuDifficulty === ""
        ? null : String(body.requiredCpuDifficulty).toUpperCase();
      const label = typeof body.rewardLabel === "string" ? body.rewardLabel.trim() : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(gameId)) {
        return reply({ error: "ゲームIDが正しくありません。" }, 400, origin);
      }
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(mode)) {
        return reply({ error: "モード指定が正しくありません。" }, 400, origin);
      }
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000) {
        return reply({ error: "固定報酬は0〜1000 Pで設定してください。" }, 400, origin);
      }
      if (difficulty !== null && !["EASY","NORMAL","HARD","EXPERT"].includes(difficulty)) {
        return reply({ error: "CPU難易度の指定が正しくありません。" }, 400, origin);
      }
      if (!label || label.length > 80) {
        return reply({ error: "報酬表示名は1〜80文字で入力してください。" }, 400, origin);
      }

      const verifiedTictactoe = gameId === "2dbd6773-2684-4f00-973e-c46acbc348e7" &&
        ["normal","vanish","gobble","reverse"].includes(mode) && difficulty === "HARD";
      const verifiedUnonOnline = gameId === "faa155cb-2143-4361-9a96-dc759d334e46" &&
        mode === "wins-online" && difficulty === null;
      const verifiedPrime = gameId === "79c9921a-d57a-45b1-8271-1ee7042801dc" &&
        ["easy","normal","hard"].includes(mode) && difficulty === null;
      const numberModes = new Set([
        "number-classic-easy","number-classic-normal","number-classic-hard",
        "number-classic-expert","number-classic-master","number-classic-legend",
        "number-time-easy","number-time-normal","number-time-hard",
        "number-time-expert","number-time-master","number-time-legend"
      ]);
      const verifiedNumber = gameId === "bb466662-5423-48e6-bbcc-d19da50ba818" &&
        numberModes.has(mode) && difficulty === null;
      const sushiModes = new Set([
        "normal_beginner","normal_intermediate","normal_advanced",
        "sudden_beginner","sudden_intermediate","sudden_advanced",
        "endless_beginner","endless_intermediate","endless_advanced"
      ]);
      const verifiedSushi = gameId === "5c1e658b-f6d3-412a-8b97-61d2c0457e95" &&
        sushiModes.has(mode) && difficulty === null;
      if (!verifiedTictactoe && !verifiedUnonOnline && !verifiedPrime && !verifiedNumber && !verifiedSushi) {
        return reply({
          error: "報酬を設定できるのはサーバー検証済みのゲーム・モードのみです。"
        }, 400, origin);
      }

      let scoreTiers: Array<{minScore:number;maxScore:number|null;rewardAmount:number;enabled:boolean}> = [];
      if (rewardType === "score_tier") {
        // Currently only the prime-factor and sushi typing servers compute authoritative scores.
        if (!(verifiedPrime || verifiedSushi)) {
          return reply({ error: "スコア別報酬は素因数分解・回転ずしタイピングのみ対応しています。" }, 400, origin);
        }
        if (difficulty !== null || !Array.isArray(body.scoreTiers) ||
            body.scoreTiers.length < 1 || body.scoreTiers.length > 20) {
          return reply({ error: "スコア条件を1〜20段階で設定してください。" }, 400, origin);
        }
        scoreTiers = body.scoreTiers.map((tier:any) => ({
          minScore: Number(tier?.minScore),
          maxScore: tier?.maxScore === null || tier?.maxScore === undefined || tier?.maxScore === ""
            ? null : Number(tier.maxScore),
          rewardAmount: Number(tier?.rewardAmount),
          enabled: tier?.enabled !== false,
        }));
        for (const tier of scoreTiers) {
          if (!Number.isSafeInteger(tier.minScore) || tier.minScore < 0 ||
              (tier.maxScore !== null && (!Number.isSafeInteger(tier.maxScore) || tier.maxScore < tier.minScore)) ||
              !Number.isSafeInteger(tier.rewardAmount) || tier.rewardAmount < 0 || tier.rewardAmount > 1000) {
            return reply({ error: "各条件のスコア範囲・ポイント数を確認してください。" }, 400, origin);
          }
        }
        scoreTiers.sort((a,b)=>a.minScore-b.minScore);
        for (let i=1;i<scoreTiers.length;i++) {
          const previous=scoreTiers[i-1],current=scoreTiers[i];
          if (previous.maxScore === null || previous.maxScore >= current.minScore) {
            return reply({ error: "スコア範囲が重複しています。前の条件の上限と次の条件の下限を確認してください。" }, 400, origin);
          }
        }
        if (scoreTiers.some((tier,i)=>tier.maxScore===null && i!==scoreTiers.length-1)) {
          return reply({ error: "上限なしの条件は最後の段階にしてください。" }, 400, origin);
        }
      }

      const { data: game, error: gameError } = await admin.from("game_studio_games")
        .select("id,title,status").eq("id", gameId).maybeSingle();
      if (gameError) throw gameError;
      if (!game || game.status !== "published") {
        return reply({ error: "公開中のゲームだけ報酬設定を変更できます。" }, 400, origin);
      }
      const { error } = await admin.from("kuro_coin_game_rewards").upsert({
        game_id: gameId,
        mode,
        reward_amount: amount,
        enabled,
        required_cpu_difficulty: difficulty,
        reward_label: label,
        reward_type: rewardType,
        score_tiers: rewardType === "score_tier" ? scoreTiers : [],
        updated_by_user_id: caller.id,
        updated_at: new Date().toISOString()
      }, { onConflict: "game_id,mode" });
      if (error) throw error;
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: "kuro_coin_reward_update",
        metadata: {
          gameId, gameTitle: game.title, mode, rewardType,
          rewardAmount: rewardType === "fixed" ? amount : null,
          scoreTiers: rewardType === "score_tier" ? scoreTiers : [],
          enabled, requiredCpuDifficulty: difficulty, rewardLabel: label
        }
      });
      if (auditError) console.warn("[admin-console] KURO COIN reward audit insert failed", auditError);
      return reply({ ok: true }, 200, origin);
    }

    if (action === "adjust_coin_balance") {
      const userId = typeof body.userId === "string" ? body.userId.trim() : "";
      const amount = Number(body.amount);
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
        return reply({ error: "ユーザーIDが正しくありません。" }, 400, origin);
      }
      if (!Number.isSafeInteger(amount) || amount === 0 || amount < -100000 || amount > 100000) {
        return reply({ error: "補正枚数は-100000〜100000 KCの整数（0以外）で入力してください。" }, 400, origin);
      }
      if (reason.length < 3 || reason.length > 200) {
        return reply({ error: "補正理由は3〜200文字で入力してください。" }, 400, origin);
      }
      const { data: targetUser, error: targetError } = await admin.auth.admin.getUserById(userId);
      if (targetError || !targetUser?.user) {
        return reply({ error: "対象のKUROアカウントが見つかりません。" }, 404, origin);
      }
      const { data: balance, error } = await admin.rpc("kuro_coin_admin_adjust", {
        p_user_id: userId,
        p_amount: amount,
        p_reason: reason,
        p_actor_user_id: caller.id
      });
      if (error) {
        if (String(error.message || "").includes("COIN_BALANCE_INSUFFICIENT")) {
          return reply({ error: "残高が不足するため減算できません。" }, 400, origin);
        }
        throw error;
      }
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: "kuro_coin_balance_adjust",
        target_user_id: userId,
        metadata: { amount, reason, balanceAfter: Number(balance) || 0 }
      });
      if (auditError) console.warn("[admin-console] KURO COIN adjustment audit insert failed", auditError);
      return reply({ ok: true, balance: Number(balance) || 0 }, 200, origin);
    }

    if (action === "get_realtime_monitor") {
      const now = new Date();
      const since15 = new Date(now.getTime() - 15 * 60000).toISOString();
      const since5 = new Date(now.getTime() - 5 * 60000).toISOString();
      const since1 = new Date(now.getTime() - 60000).toISOString();
      const { data: events, error } = await admin.from("usage_events")
        .select("user_id,visitor_id,session_id,event_name,service_key,status_code,error_code,page_key,created_at")
        .gte("created_at", since15).order("created_at", { ascending: false }).limit(5000);
      if (error) throw error;
      const rows = events || [];
      const active = rows.filter((e) => e.created_at >= since5);
      const activeUsers = new Set(active.map((e) => e.user_id).filter(Boolean));
      const activeVisitors = new Set(active.map((e) => e.visitor_id || e.user_id).filter(Boolean));
      const activeGuests = new Set(active.filter((e) => !e.user_id).map((e) => e.visitor_id).filter(Boolean));
      const activeSessions = new Set(active.map((e) => e.session_id).filter(Boolean));
      const minutes = Array.from({ length: 15 }, (_, i) => {
        const start = new Date(now.getTime() - (14 - i) * 60000);
        const end = new Date(start.getTime() + 60000);
        return { label: start.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }),
          events: rows.filter((e) => { const t = new Date(e.created_at).getTime(); return t >= start.getTime() && t < end.getTime(); }).length };
      });
      const serviceMap = new Map<string, { service_key: string; requests: number; errors: number; last_seen: string | null }>();
      for (const e of rows) {
        if (!e.service_key || (e.event_name !== "api_success" && e.event_name !== "api_error")) continue;
        if (!serviceMap.has(e.service_key)) serviceMap.set(e.service_key, { service_key: e.service_key, requests: 0, errors: 0, last_seen: e.created_at });
        const item = serviceMap.get(e.service_key)!;
        item.requests++;
        if (e.event_name === "api_error") item.errors++;
        if (!item.last_seen || e.created_at > item.last_seen) item.last_seen = e.created_at;
      }
      const services = Array.from(serviceMap.values()).map((x) => ({ ...x,
        error_rate: x.requests ? Math.round(x.errors / x.requests * 1000) / 10 : 0
      })).sort((a, b) => b.errors - a.errors || a.service_key.localeCompare(b.service_key));
      return reply({
        generated_at: now.toISOString(), active_users_5m: activeUsers.size,
        active_visitors_5m: activeVisitors.size, active_guests_5m: activeGuests.size,
        active_sessions_5m: activeSessions.size,
        events_1m: rows.filter((e) => e.created_at >= since1).length,
        errors_5m: active.filter((e) => e.event_name === "api_error" || e.event_name === "client_error").length,
        minutes, services,
        recent_events: rows.slice(0, 35).map((e) => ({ event_name: e.event_name, service_key: e.service_key, status_code: e.status_code, error_code: e.error_code, created_at: e.created_at }))
      }, 200, origin);
    }

    if (action === "get_admin_overview") {
      const now = new Date();
      const since30 = new Date(now.getTime() - 30 * 86400000).toISOString();
      const since7 = new Date(now.getTime() - 7 * 86400000).toISOString();
      const since24 = new Date(now.getTime() - 24 * 3600000).toISOString();
      const chatStatsSince = new Date(now.getTime() - 31 * 86400000).toISOString().slice(0, 10);
      // Page through all rows instead of silently stopping at Supabase's 10k row ceiling.
      const fetchAllRows = async (queryForRange: (from: number, to: number) => any) => {
        const all: any[] = [];
        const pageSize = 1000;
        for (let offset = 0; ; offset += pageSize) {
          const result = await queryForRange(offset, offset + pageSize - 1);
          if (result.error) throw result.error;
          const page = result.data || [];
          all.push(...page);
          if (page.length < pageSize) break;
        }
        return { data: all, error: null };
      };
      const [profileCount, postCount, eventResult, postRows, replyRows, chatRows, chatStatsRows, dmRows, groupChatRows] = await Promise.all([
        admin.from("profiles").select("id", { count: "exact", head: true }),
        admin.from("posts").select("id", { count: "exact", head: true }),
        fetchAllRows((from, to) => admin.from("usage_events").select("user_id,visitor_id,event_name,created_at,widget_key,service_key,status_code,error_code").gte("created_at", since30).order("created_at", { ascending: false }).range(from, to)),
        fetchAllRows((from, to) => admin.from("posts").select("created_at").gte("created_at", since30).order("created_at", { ascending: true }).range(from, to)),
        fetchAllRows((from, to) => admin.from("post_replies").select("created_at").gte("created_at", since30).order("created_at", { ascending: true }).range(from, to)),
        fetchAllRows((from, to) => admin.from("public_chat_messages").select("created_at").gte("created_at", since30).order("created_at", { ascending: true }).range(from, to)),
        fetchAllRows((from, to) => admin.from("public_chat_daily_stats").select("chat_date,message_count").gte("chat_date", chatStatsSince).order("chat_date", { ascending: true }).range(from, to)),
        fetchAllRows((from, to) => admin.from("chat_messages").select("created_at").gte("created_at", since30).order("created_at", { ascending: true }).range(from, to)),
        fetchAllRows((from, to) => admin.from("group_chat_messages").select("created_at").gte("created_at", since30).order("created_at", { ascending: true }).range(from, to))
      ]);
      for (const result of [profileCount, postCount, eventResult, postRows, replyRows, chatRows, chatStatsRows, dmRows, groupChatRows]) {
        if (result.error) throw result.error;
      }
      const tokyoKey = (value: string | Date) => {
        const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
        const part = (type: string) => parts.find((p) => p.type === type)?.value || "";
        return part("year") + "-" + part("month") + "-" + part("day");
      };
      const dailyMap = new Map<string, { date: string; active_users: Set<string>; active_visitors: Set<string>; guest_users: Set<string>; posts: number; replies: number; chat: number; public_chat: number; dm: number; group_chat: number }>();
      for (let i = 29; i >= 0; i--) {
        const key = tokyoKey(new Date(now.getTime() - i * 86400000));
        dailyMap.set(key, { date: key, active_users: new Set(), active_visitors: new Set(), guest_users: new Set(), posts: 0, replies: 0, chat: 0, public_chat: 0, dm: 0, group_chat: 0 });
      }
      const events = eventResult.data || [];
      for (const event of events) {
        const point = dailyMap.get(tokyoKey(event.created_at));
        if (point && event.event_name === "page_view") {
          if (event.user_id) point.active_users.add(event.user_id);
          if (event.visitor_id || event.user_id) point.active_visitors.add(event.visitor_id || event.user_id);
          if (!event.user_id && event.visitor_id) point.guest_users.add(event.visitor_id);
        }
      }
      for (const row of postRows.data || []) { const point = dailyMap.get(tokyoKey(row.created_at)); if (point) point.posts++; }
      for (const row of replyRows.data || []) { const point = dailyMap.get(tokyoKey(row.created_at)); if (point) point.replies++; }
      for (const row of chatStatsRows.data || []) {
        const point = dailyMap.get(row.chat_date);
        if (point) { const count = Number(row.message_count) || 0; point.chat += count; point.public_chat += count; }
      }
      // Public lobby: combine archived daily totals with rows still in the live table.
      for (const row of chatRows.data || []) { const point = dailyMap.get(tokyoKey(row.created_at)); if (point) { point.chat++; point.public_chat++; } }
      // Separate individual and group messages for charting.
      for (const row of dmRows.data || []) { const point = dailyMap.get(tokyoKey(row.created_at)); if (point) { point.chat++; point.dm++; } }
      for (const row of groupChatRows.data || []) { const point = dailyMap.get(tokyoKey(row.created_at)); if (point) { point.chat++; point.group_chat++; } }
      const rows7 = events.filter((e) => e.created_at >= since7);
      const rows24 = events.filter((e) => e.created_at >= since24);
      const pageViews = events.filter((e) => e.event_name === "page_view");
      const dauUsers = new Set(pageViews.filter((e) => tokyoKey(e.created_at) === tokyoKey(now)).map((e) => e.user_id).filter(Boolean));
      const mauUsers = new Set(pageViews.map((e) => e.user_id).filter(Boolean));
      const dauVisitors = new Set(pageViews.filter((e) => tokyoKey(e.created_at) === tokyoKey(now)).map((e) => e.visitor_id || e.user_id).filter(Boolean));
      const mauVisitors = new Set(pageViews.map((e) => e.visitor_id || e.user_id).filter(Boolean));
      const dauGuests = new Set(pageViews.filter((e) => tokyoKey(e.created_at) === tokyoKey(now) && !e.user_id).map((e) => e.visitor_id).filter(Boolean));
      const mauGuests = new Set(pageViews.filter((e) => !e.user_id).map((e) => e.visitor_id).filter(Boolean));
      const widgetMap = new Map<string, { widget_key: string; views: number; adds: number; removes: number }>();
      for (const event of events) {
        if (!event.widget_key) continue;
        if (!widgetMap.has(event.widget_key)) widgetMap.set(event.widget_key, { widget_key: event.widget_key, views: 0, adds: 0, removes: 0 });
        const item = widgetMap.get(event.widget_key)!;
        if (event.event_name === "widget_view") item.views++;
        if (event.event_name === "widget_added") item.adds++;
        if (event.event_name === "widget_removed") item.removes++;
      }
      const apiMap = new Map<string, { service_key: string; requests: number; successes: number; errors: number; error_rate: number; status_codes: Record<string, number> }>();
      for (const event of rows7) {
        if (event.event_name !== "api_success" && event.event_name !== "api_error") continue;
        const service = event.service_key || "other_api";
        if (!apiMap.has(service)) apiMap.set(service, { service_key: service, requests: 0, successes: 0, errors: 0, error_rate: 0, status_codes: {} });
        const item = apiMap.get(service)!;
        item.requests++;
        if (event.event_name === "api_success") item.successes++;
        else { item.errors++; const code = String(event.status_code || event.error_code || "unknown"); item.status_codes[code] = (item.status_codes[code] || 0) + 1; }
      }
      return reply({
        generated_at: now.toISOString(), profile_count: profileCount.count || 0, post_count: postCount.count || 0,
        dau: dauUsers.size, mau: mauUsers.size, dau_visitors: dauVisitors.size, mau_visitors: mauVisitors.size,
        dau_guests: dauGuests.size, mau_guests: mauGuests.size, page_views_30d: pageViews.length,
        api_errors_24h: rows24.filter((e) => e.event_name === "api_error").length,
        daily: Array.from(dailyMap.values()).map((p) => ({
          date: p.date, active_users: p.active_users.size, active_visitors: p.active_visitors.size,
          guest_users: p.guest_users.size, posts: p.posts, replies: p.replies, chat: p.chat, public_chat: p.public_chat, dm: p.dm, group_chat: p.group_chat
        })),
        widgets: Array.from(widgetMap.values()).sort((a, b) => b.views - a.views || b.adds - a.adds).slice(0, 20),
        apis: Array.from(apiMap.values()).map((item) => ({ ...item, error_rate: item.requests ? Math.round(item.errors / item.requests * 1000) / 10 : 0 })).sort((a, b) => b.errors - a.errors || b.requests - a.requests),
        truncated: false
      }, 200, origin);
    }

    if (action === "get_usage_analytics") {
      const now = new Date();
      const since32 = new Date(now.getTime() - 32 * 86400000).toISOString();
      const since30 = new Date(now.getTime() - 30 * 86400000).toISOString();
      const since7 = new Date(now.getTime() - 7 * 86400000).toISOString();
      const since24 = new Date(now.getTime() - 24 * 3600000).toISOString();
      const maxRows = 100000;
      const pageSize = 1000;
      const rows: Array<{ user_id: string | null; visitor_id: string | null; event_name: string; created_at: string; session_id?: string | null; widget_key: string | null; service_key: string | null; status_code: number | null; error_code: string | null }> = [];
      let eventTotal: number | null = null;
      let truncated = false;
      for (let offset = 0; offset < maxRows; offset += pageSize) {
        const selectOptions = offset === 0 ? { count: "exact" as const } : {};
        const { data: eventPage, error: eventsError, count } = await admin
          .from("usage_events")
          .select("user_id,visitor_id,session_id,event_name,created_at,widget_key,service_key,status_code,error_code", selectOptions)
          .gte("created_at", since32)
          .order("created_at", { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (eventsError) throw eventsError;
        if (offset === 0 && Number.isFinite(count)) eventTotal = count;
        const batch = eventPage || [];
        rows.push(...batch);
        if (batch.length < pageSize) break;
        if (offset + pageSize >= maxRows) truncated = eventTotal === null || eventTotal > rows.length;
      }
      const rows30 = rows.filter((e) => e.created_at >= since30);
      const rows7 = rows.filter((e) => e.created_at >= since7);
      const rows24 = rows.filter((e) => e.created_at >= since24);
      const pageViews30 = rows30.filter((e) => e.event_name === "page_view");
      const pageViewsAll = rows.filter((e) => e.event_name === "page_view");

      const tokyoKey = (value: string | Date) => new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date(value));

      const todayKey = tokyoKey(now);
      const dauRows = pageViews30.filter((e) => tokyoKey(e.created_at) === todayKey);
      const dauUsers = new Set(dauRows.map((e) => e.user_id).filter(Boolean));
      const mauUsers = new Set(pageViews30.map((e) => e.user_id).filter(Boolean));
      const dauVisitors = new Set(dauRows.map((e) => e.visitor_id || e.user_id).filter(Boolean));
      const mauVisitors = new Set(pageViews30.map((e) => e.visitor_id || e.user_id).filter(Boolean));
      const dauGuests = new Set(dauRows.filter((e) => !e.user_id).map((e) => e.visitor_id).filter(Boolean));
      const mauGuests = new Set(pageViews30.filter((e) => !e.user_id).map((e) => e.visitor_id).filter(Boolean));

      const dailyMap = new Map<string, { visitors: Set<string>; users: Set<string>; guests: Set<string> }>();
      for (let i = 29; i >= 0; i--) {
        const key = tokyoKey(new Date(now.getTime() - i * 86400000));
        if (!dailyMap.has(key)) dailyMap.set(key, { visitors: new Set(), users: new Set(), guests: new Set() });
      }
      pageViews30.forEach((e) => {
        const key = tokyoKey(e.created_at);
        const point = dailyMap.get(key);
        if (!point) return;
        if (e.user_id) point.users.add(e.user_id);
        if (e.visitor_id || e.user_id) point.visitors.add(e.visitor_id || e.user_id);
        if (!e.user_id && e.visitor_id) point.guests.add(e.visitor_id);
      });
      const daily = Array.from(dailyMap.entries()).map(([date, point]) => ({
        date, active_users: point.users.size, active_visitors: point.visitors.size, guest_users: point.guests.size
      }));

      const widgetMap = new Map<string, { widget_key: string; views: number; adds: number; removes: number }>();
      rows30.forEach((e) => {
        if (!e.widget_key) return;
        if (!widgetMap.has(e.widget_key)) {
          widgetMap.set(e.widget_key, { widget_key: e.widget_key, views: 0, adds: 0, removes: 0 });
        }
        const item = widgetMap.get(e.widget_key)!;
        if (e.event_name === "widget_view") item.views++;
        if (e.event_name === "widget_added") item.adds++;
        if (e.event_name === "widget_removed") item.removes++;
      });
      const widgets = Array.from(widgetMap.values())
        .sort((a, b) => b.views - a.views || b.adds - a.adds)
        .slice(0, 20);

      const apiMap = new Map<string, { service_key: string; requests: number; successes: number; errors: number; error_rate: number; status_codes: Record<string, number> }>();
      rows7.forEach((e) => {
        if (e.event_name !== "api_success" && e.event_name !== "api_error") return;
        const service = e.service_key || "other_api";
        if (!apiMap.has(service)) {
          apiMap.set(service, { service_key: service, requests: 0, successes: 0, errors: 0, error_rate: 0, status_codes: {} });
        }
        const item = apiMap.get(service)!;
        item.requests++;
        if (e.event_name === "api_success") item.successes++;
        else {
          item.errors++;
          const code = String(e.status_code || e.error_code || "unknown");
          item.status_codes[code] = (item.status_codes[code] || 0) + 1;
        }
      });
      const apis = Array.from(apiMap.values()).map((item) => ({
        ...item,
        error_rate: item.requests ? Math.round(item.errors / item.requests * 1000) / 10 : 0
      })).sort((a, b) => b.errors - a.errors || b.requests - a.requests);

      const { data: firstTrackedPage, error: firstTrackedError } = await admin
        .from("usage_events")
        .select("created_at")
        .eq("event_name", "page_view")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (firstTrackedError) throw firstTrackedError;
      const trackingStartedAt = firstTrackedPage && firstTrackedPage.created_at
        ? new Date(firstTrackedPage.created_at).getTime()
        : now.getTime();

      const users: Array<{ id: string; created_at: string }> = [];
      let userListTruncated = false;
      for (let page = 1; page <= 20; page++) {
        const { data: userData, error: userError } = await admin.auth.admin.listUsers({ page, perPage: 500 });
        if (userError) throw userError;
        const pageUsers = (userData.users || []).filter((u) => !u.is_anonymous);
        pageUsers.forEach((u) => users.push({ id: u.id, created_at: u.created_at }));
        if ((userData.users || []).length < 500) break;
        if (page === 20) userListTruncated = true;
      }

      const activityByUser = new Map<string, number[]>();
      pageViewsAll.forEach((e) => {
        if (!e.user_id) return;
        const t = new Date(e.created_at).getTime();
        if (!Number.isFinite(t)) return;
        if (!activityByUser.has(e.user_id)) activityByUser.set(e.user_id, []);
        activityByUser.get(e.user_id)!.push(t);
      });

      const retentionFor = (day: number) => {
        const startOffset = day * 86400000;
        const eligibleOffset = (day + 1) * 86400000;
        const eligibleUsers = users.filter((u) => {
          const created = new Date(u.created_at).getTime();
          return Number.isFinite(created) && created >= trackingStartedAt && now.getTime() - created >= eligibleOffset;
        });
        let retained = 0;
        eligibleUsers.forEach((u) => {
          const created = new Date(u.created_at).getTime();
          const times = activityByUser.get(u.id) || [];
          if (times.some((t) => t >= created + startOffset && t < created + eligibleOffset)) retained++;
        });
        return {
          eligible: eligibleUsers.length,
          retained,
          rate: eligibleUsers.length ? Math.round(retained / eligibleUsers.length * 1000) / 10 : null
        };
      };

      const retention = {
        day1: retentionFor(1),
        day7: retentionFor(7),
        day30: retentionFor(30),
        tracking_started_at: firstTrackedPage && firstTrackedPage.created_at ? firstTrackedPage.created_at : null
      };

      return reply({
        generated_at: now.toISOString(),
        tracking_started_at: retention.tracking_started_at,
        dau: dauUsers.size,
        mau: mauUsers.size,
        dau_logged_in: dauUsers.size,
        mau_logged_in: mauUsers.size,
        dau_visitors: dauVisitors.size,
        mau_visitors: mauVisitors.size,
        dau_guests: dauGuests.size,
        mau_guests: mauGuests.size,
        dau_mau_rate: mauVisitors.size ? Math.round(dauVisitors.size / mauVisitors.size * 1000) / 10 : 0,
        page_views_30d: pageViews30.length,
        page_views_logged_in_30d: pageViews30.filter((e) => !!e.user_id).length,
        page_views_guest_30d: pageViews30.filter((e) => !e.user_id && !!e.visitor_id).length,
        sessions_30d: rows30.filter((e) => e.event_name === "session_start").length,
        sessions_logged_in_30d: rows30.filter((e) => e.event_name === "session_start" && !!e.user_id).length,
        sessions_guest_30d: rows30.filter((e) => e.event_name === "session_start" && !e.user_id && !!e.visitor_id).length,
        events_30d: rows30.length,
        api_errors_24h: rows24.filter((e) => e.event_name === "api_error").length,
        client_errors_24h: rows24.filter((e) => e.event_name === "client_error").length,
        client_errors_7d: rows7.filter((e) => e.event_name === "client_error").length,
        daily,
        widgets,
        apis,
        retention,
        truncated,
        user_list_truncated: userListTruncated
      }, 200, origin);
    }

    if (action === "get_user_error_log") {
      const targetUserId = typeof body.userId === "string" ? body.userId : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
        return reply({ error: "Invalid user ID" }, 400, origin);
      }
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data, error } = await admin.from("usage_events")
        .select("created_at,event_name,page_key,widget_key,service_key,status_code,error_code")
        .eq("user_id", targetUserId)
        .in("event_name", ["api_error", "client_error"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return reply({ logs: data || [] }, 200, origin);
    }

    if (action === "list_audit") {
      const limit = Math.max(1, Math.min(300, Number(body.limit) || 100));
      const { data, error } = await admin
        .from("admin_audit_logs")
        .select("id,actor_user_id,action,target_user_id,metadata,created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return reply({ logs: data || [] }, 200, origin);
    }

    if (action === "list_admin_messages") {
      const limit = Math.max(1, Math.min(300, Number(body.limit) || 100));
      let query = admin.from("admin_messages")
        .select("id,title,body,href,audience,recipient_id,published,created_at,service_scope,portal_announcement_id")
        .order("created_at", { ascending: false }).limit(limit);
      const requestedScope = typeof body.serviceScope === "string" ? body.serviceScope : "";
      if (requestedScope === "sns") query = query.in("service_scope", ["sns", "both"]);
      else if (requestedScope === "lab") query = query.in("service_scope", ["lab", "both"]);
      else if (requestedScope === "both") query = query.eq("service_scope", "both");
      const { data: messages, error } = await query;
      if (error) throw error;
      const rows = messages || [];
      const ids = rows.map((m) => m.id);
      const recipientIds = [...new Set(rows.map((m) => m.recipient_id).filter(Boolean))];
      const [readsResult, profilesResult] = ids.length ? await Promise.all([
        admin.from("admin_message_reads").select("message_id,user_id,read_at").in("message_id", ids),
        recipientIds.length ? admin.from("profiles").select("id,username,display_name").in("id", recipientIds) : Promise.resolve({ data: [], error: null })
      ]) : [{ data: [], error: null }, { data: [], error: null }];
      if (readsResult.error) throw readsResult.error;
      if (profilesResult.error) throw profilesResult.error;
      const reads = new Map();
      (readsResult.data || []).forEach((r) => reads.set(r.message_id, (reads.get(r.message_id) || 0) + 1));
      const profiles = new Map((profilesResult.data || []).map((p) => [p.id, p]));
      return reply({ messages: rows.map((m) => ({
        ...m,
        read_count: reads.get(m.id) || 0,
        recipient: m.recipient_id ? (profiles.get(m.recipient_id) || null) : null
      })) }, 200, origin);
    }

    if (action === "send_admin_message") {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const content = typeof body.content === "string" ? body.content.trim() : "";
      const href = typeof body.href === "string" ? body.href.trim() : "";
      const audience = body.audience === "user" ? "user" : "all";
      const serviceScope = ["all","lab","sns","both","games"].includes(body.serviceScope) ? body.serviceScope : "all";
      const targetUserId = typeof body.userId === "string" ? body.userId : "";
      if (!title || title.length > 120) return reply({ error: "Title must be 1-120 characters" }, 400, origin);
      if (!content || content.length > 8000) return reply({ error: "Body must be 1-8000 characters" }, 400, origin);
      if (href) {
        try {
          const parsedUrl = new URL(href);
          if (parsedUrl.protocol !== "https:") return reply({ error: "Message links must use HTTPS" }, 400, origin);
        } catch {
          return reply({ error: "Invalid message URL" }, 400, origin);
        }
      }
      let recipientId: string | null = null;
      if (audience === "user") {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
          return reply({ error: "A valid target user is required" }, 400, origin);
        }
        const { data: target, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
        if (targetError || !target?.user || target.user.is_anonymous) return reply({ error: "User not found" }, 404, origin);
        recipientId = targetUserId;
      }
      let portalAnnouncementId: string | null = null;
      if ((serviceScope === "all" || serviceScope === "lab" || serviceScope === "both") && audience === "all") {
        const { data: portalAnnouncement, error: portalError } = await admin.from("portal_announcements").insert({
          title, body: content, href: href || null, published: true,
          starts_at: new Date().toISOString(), ends_at: null
        }).select("id").single();
        if (portalError) throw portalError;
        portalAnnouncementId = portalAnnouncement.id;
      }
      const { data: saved, error } = await admin.from("admin_messages").insert({
        title, body: content, href: href || null, audience, service_scope: serviceScope,
        portal_announcement_id: portalAnnouncementId,
        recipient_id: recipientId, created_by: caller.id, published: true
      }).select("id,title,audience,recipient_id,created_at,service_scope,portal_announcement_id").single();
      if (error) {
        if (portalAnnouncementId) await admin.from("portal_announcements").delete().eq("id", portalAnnouncementId);
        throw error;
      }
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: "admin_message.send",
        target_user_id: recipientId,
        metadata: { message_id: saved.id, title, audience, service_scope: serviceScope }
      });
      if (auditError) throw auditError;
      return reply({ ok: true, message: saved }, 200, origin);
    }

    if (action === "unpublish_admin_message") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return reply({ error: "Message ID required" }, 400, origin);
      const { data, error } = await admin.from("admin_messages")
        .update({ published: false }).eq("id", id)
        .select("id,title,portal_announcement_id").maybeSingle();
      if (error) throw error;
      if (!data) return reply({ error: "Message not found" }, 404, origin);
      if (data.portal_announcement_id) {
        const { error: portalError } = await admin.from("portal_announcements")
          .update({ published: false, ends_at: new Date().toISOString() })
          .eq("id", data.portal_announcement_id);
        if (portalError) throw portalError;
      }
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: "admin_message.unpublish",
        metadata: { message_id: data.id, title: data.title }
      });
      if (auditError) throw auditError;
      return reply({ ok: true }, 200, origin);
    }

    if (action === "list_announcements") {
      const { data, error } = await admin
        .from("portal_announcements")
        .select("id,title,body,href,published,created_at,starts_at,ends_at")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return reply({ announcements: data || [] }, 200, origin);
    }

    if (action === "save_announcement") {
      const id = typeof body.id === "string" ? body.id : "";
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const content = typeof body.content === "string" ? body.content.trim() : "";
      const href = typeof body.href === "string" ? body.href.trim() : "";
      const published = body.published === true;
      const startsAt = body.starts_at ? new Date(body.starts_at) : new Date();
      const endsAt = body.ends_at ? new Date(body.ends_at) : null;
      if (!title || title.length > 120) return reply({ error: "Title must be 1-120 characters" }, 400, origin);
      if (!content || content.length > 8000) return reply({ error: "Body must be 1-8000 characters" }, 400, origin);
      if (href) {
        try {
          const parsedUrl = new URL(href);
          if (parsedUrl.protocol !== "https:") return reply({ error: "Announcement links must use HTTPS" }, 400, origin);
        } catch {
          return reply({ error: "Invalid announcement URL" }, 400, origin);
        }
      }
      if (Number.isNaN(startsAt.getTime()) || (endsAt && Number.isNaN(endsAt.getTime()))) {
        return reply({ error: "Invalid announcement date" }, 400, origin);
      }
      if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
        return reply({ error: "End date must be after start date" }, 400, origin);
      }
      const record = {
        title,
        body: content,
        href: href || null,
        published,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt ? endsAt.toISOString() : null
      };
      let saved;
      if (id) {
        const { data, error } = await admin.from("portal_announcements").update(record).eq("id", id).select("id,title,published").maybeSingle();
        if (error) throw error;
        if (!data) return reply({ error: "Announcement not found" }, 404, origin);
        saved = data;
      } else {
        const { data, error } = await admin.from("portal_announcements").insert(record).select("id,title,published").single();
        if (error) throw error;
        saved = data;
      }
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: id ? "announcement.update" : "announcement.create",
        metadata: { announcement_id: saved.id, title: saved.title, published: saved.published }
      });
      if (auditError) throw auditError;
      return reply({ announcement: saved }, 200, origin);
    }

    if (action === "unpublish_announcement") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return reply({ error: "Announcement ID required" }, 400, origin);
      const { data, error } = await admin.from("portal_announcements")
        .update({ published: false, ends_at: new Date().toISOString() })
        .eq("id", id).select("id,title").maybeSingle();
      if (error) throw error;
      if (!data) return reply({ error: "Announcement not found" }, 404, origin);
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: "announcement.unpublish",
        metadata: { announcement_id: data.id, title: data.title }
      });
      if (auditError) throw auditError;
      return reply({ ok: true }, 200, origin);
    }


    if (action === "list_game_banners") {
      const { data, error } = await admin.from("kurogames_home_banners")
        .select("id,name,message,href,enabled,sort_order,text_color,background_color,font_size,speed,icon,is_bold,starts_at,ends_at,created_at,updated_at")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return reply({ banners: data || [] }, 200, origin);
    }

    if (action === "save_game_banner") {
      const id = typeof body.id === "string" ? body.id.trim() : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const message = typeof body.message === "string" ? body.message.trim() : "";
      const href = typeof body.href === "string" ? body.href.trim() : "";
      const sortOrder = Number(body.sort_order ?? 100);
      const fontSize = Number(body.font_size ?? 14);
      const speed = body.speed === "slow" || body.speed === "fast" ? body.speed : body.speed === "normal" ? "normal" : "";
      const textColor = typeof body.text_color === "string" ? body.text_color.trim() : "#ffffff";
      const backgroundColor = typeof body.background_color === "string" ? body.background_color.trim() : "#2563eb";
      const icon = typeof body.icon === "string" ? body.icon.trim() : "";
      const startsAt = kuroSecretDate(body.starts_at);
      const endsAt = kuroSecretDate(body.ends_at);
      if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        return reply({ error: "バナーIDが正しくありません。" }, 400, origin);
      }
      if (!name || name.length > 80 || !message || message.length > 500) {
        return reply({ error: "バナー名は1〜80文字、表示文章は1〜500文字で入力してください。" }, 400, origin);
      }
      if (href) {
        if (href.startsWith("/") && !href.startsWith("//")) {
          // Safe same-site relative path.
        } else {
          try {
            if (new URL(href).protocol !== "https:") return reply({ error: "リンクはHTTPSまたはサイト内パスにしてください。" }, 400, origin);
          } catch {
            return reply({ error: "リンク先URLが正しくありません。" }, 400, origin);
          }
        }
      }
      if (!Number.isInteger(sortOrder) || sortOrder < -10000 || sortOrder > 10000) {
        return reply({ error: "表示順は-10000〜10000の整数にしてください。" }, 400, origin);
      }
      if (!Number.isInteger(fontSize) || fontSize < 11 || fontSize > 22) {
        return reply({ error: "文字サイズは11〜22にしてください。" }, 400, origin);
      }
      if (!["slow", "normal", "fast"].includes(speed)) {
        return reply({ error: "流れる速度を選択してください。" }, 400, origin);
      }
      if (!/^#[0-9a-f]{6}$/i.test(textColor) || !/^#[0-9a-f]{6}$/i.test(backgroundColor)) {
        return reply({ error: "文字色・背景色の指定が正しくありません。" }, 400, origin);
      }
      if (icon.length > 16) return reply({ error: "アイコンは16文字以内にしてください。" }, 400, origin);
      if (startsAt === undefined || endsAt === undefined) {
        return reply({ error: "表示期間の日付を確認してください。" }, 400, origin);
      }
      const startDate = startsAt || new Date().toISOString();
      if (endsAt && new Date(endsAt).getTime() <= new Date(startDate).getTime()) {
        return reply({ error: "終了日時は開始日時より後にしてください。" }, 400, origin);
      }
      const record = {
        name,
        message,
        href: href || null,
        enabled: body.enabled === true,
        sort_order: sortOrder,
        text_color: textColor,
        background_color: backgroundColor,
        font_size: fontSize,
        speed,
        icon: icon || null,
        is_bold: body.is_bold === true,
        starts_at: startDate,
        ends_at: endsAt,
        updated_at: new Date().toISOString()
      };
      let saved;
      if (id) {
        const { data, error } = await admin.from("kurogames_home_banners")
          .update(record).eq("id", id)
          .select("id,name,message,enabled,sort_order").maybeSingle();
        if (error) throw error;
        if (!data) return reply({ error: "バナーが見つかりません。" }, 404, origin);
        saved = data;
      } else {
        const { data, error } = await admin.from("kurogames_home_banners")
          .insert({ ...record, created_by: caller.id })
          .select("id,name,message,enabled,sort_order").single();
        if (error) throw error;
        saved = data;
      }
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: id ? "kurogames.home_banner.update" : "kurogames.home_banner.create",
        metadata: saved
      });
      if (auditError) throw auditError;
      return reply({ banner: saved }, 200, origin);
    }

    if (action === "delete_game_banner") {
      const id = typeof body.id === "string" ? body.id.trim() : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        return reply({ error: "バナーIDが正しくありません。" }, 400, origin);
      }
      const { data, error } = await admin.from("kurogames_home_banners")
        .delete().eq("id", id).select("id,name").maybeSingle();
      if (error) throw error;
      if (!data) return reply({ error: "バナーが見つかりません。" }, 404, origin);
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: "kurogames.home_banner.delete",
        metadata: data
      });
      if (auditError) throw auditError;
      return reply({ ok: true }, 200, origin);
    }

    if (action === "list_pro_management") {
      const [appsResult, membersResult, invitesResult, controlsResult] = await Promise.all([
        admin.from("pro_applications").select("id,user_id,reason,requested_plan,status,admin_note,reviewed_by,reviewed_at,created_at").order("created_at",{ascending:false}).limit(300),
        admin.from("pro_memberships").select("user_id,status,source,starts_at,expires_at,plan,features,approved_by,approved_at,updated_at").order("updated_at",{ascending:false}).limit(500),
        admin.from("pro_invitations").select("id,invited_user_id,status,plan,expires_at,membership_expires_at,created_at,accepted_at,created_by").order("created_at",{ascending:false}).limit(300),
        admin.from("pro_user_controls").select("user_id,reapply_allowed,reapply_after,admin_note,updated_at").limit(500)
      ]);
      for (const r of [appsResult,membersResult,invitesResult,controlsResult]) if(r.error) throw r.error;
      const ids=[...new Set([...(appsResult.data||[]).map(x=>x.user_id),...(membersResult.data||[]).map(x=>x.user_id),...(invitesResult.data||[]).map(x=>x.invited_user_id),...(controlsResult.data||[]).map(x=>x.user_id)])];
      const profileResult=ids.length?await admin.from("profiles").select("id,username,display_name").in("id",ids):{data:[],error:null};
      if(profileResult.error) throw profileResult.error;
      const profileMap=new Map((profileResult.data||[]).map(x=>[x.id,x]));
      const emails=new Map<string,string>();
      for(const id of ids){
        const u=await admin.auth.admin.getUserById(id);
        if(u.data?.user?.email) emails.set(id,u.data.user.email);
      }
      const decorate=(x:any,id:string)=>({...x,email:emails.get(id)||"",profile:profileMap.get(id)||null});
      return reply({
        applications:(appsResult.data||[]).map(x=>decorate(x,x.user_id)),
        memberships:(membersResult.data||[]).map(x=>decorate(x,x.user_id)),
        invitations:(invitesResult.data||[]).map(x=>decorate(x,x.invited_user_id)),
        controls:(controlsResult.data||[]).map(x=>decorate(x,x.user_id))
      },200,origin);
    }

    if (action === "review_pro_application") {
      const applicationId=typeof body.applicationId==="string"?body.applicationId:"";
      const approve=body.approve===true;
      const adminNote=typeof body.adminNote==="string"?body.adminNote.trim().slice(0,1000):"";
      const expiresAt=body.expiresAt?new Date(body.expiresAt):null;
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId)) return reply({error:"Invalid application ID"},400,origin);
      if(body.expiresAt && (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime()<=Date.now())) return reply({error:"有効期限は未来の日時にしてください。"},400,origin);
      const {data:application,error:appError}=await admin.from("pro_applications").select("id,user_id,status,requested_plan").eq("id",applicationId).maybeSingle();
      if(appError) throw appError;
      if(!application) return reply({error:"Application not found"},404,origin);
      if(application.status!=="pending") return reply({error:"この申請はすでに審査済みです。"},409,origin);
      const requestedPlan=application.requested_plan==="standard"?"standard":"pro";
      const grantedPlan=body.plan==="standard"||body.plan==="pro"?body.plan:requestedPlan;
      if(body.plan!==undefined && body.plan!=="standard" && body.plan!=="pro") return reply({error:"プラン指定が正しくありません。"},400,origin);
      if(approve){
        const {data:existingMembership,error:existingMembershipError}=await admin.from("pro_memberships").select("status").eq("user_id",application.user_id).maybeSingle();
        if(existingMembershipError) throw existingMembershipError;
        if(existingMembership?.status==="suspended") return reply({error:"Proが停止中の利用者は、停止解除後に審査してください。"},409,origin);
      }
      const {data:protectedAdmin,error:protectedError}=await admin.from("admin_users").select("user_id").eq("user_id",application.user_id).maybeSingle();
      if(protectedError) throw protectedError;
      if(protectedAdmin) return reply({error:"Administrator accounts are not eligible for Pro membership"},409,origin);
      const now=new Date().toISOString();
      if(approve){
        const {error:memberError}=await admin.from("pro_memberships").upsert({
          user_id:application.user_id,status:"active",source:"application",starts_at:now,
          expires_at:expiresAt?expiresAt.toISOString():null,
          plan:grantedPlan,features:featuresForPlan(grantedPlan),
          approved_by:caller.id,approved_at:now,updated_at:now
        },{onConflict:"user_id"});
        if(memberError) throw memberError;
      }
      const {data:updated,error:updateError}=await admin.from("pro_applications").update({
        status:approve?"approved":"rejected",admin_note:adminNote||null,reviewed_by:caller.id,reviewed_at:now,updated_at:now
      }).eq("id",applicationId).eq("status","pending").select("id,user_id,status").maybeSingle();
      if(updateError) throw updateError;
      if(!updated) return reply({error:"申請状態が更新されました。再読み込みしてください。"},409,origin);
      const allow=body.reapplyAllowed!==false;
      const reapplyAfter=body.reapplyAfter?new Date(body.reapplyAfter):null;
      if(!approve && body.reapplyAfter && (!reapplyAfter || Number.isNaN(reapplyAfter.getTime()))) return reply({error:"Invalid reapply date"},400,origin);
      if(!approve){
        const {error:controlError}=await admin.from("pro_user_controls").upsert({
          user_id:application.user_id,reapply_allowed:allow,reapply_after:reapplyAfter?reapplyAfter.toISOString():null,
          admin_note:adminNote||null,updated_by:caller.id,updated_at:now
        },{onConflict:"user_id"});
        if(controlError) throw controlError;
      }
      const {error:auditError}=await admin.from("admin_audit_logs").insert({
        actor_user_id:caller.id,action:approve?"pro.application.approve":"pro.application.reject",
        target_user_id:application.user_id,metadata:{application_id:applicationId,requested_plan:requestedPlan,granted_plan:approve?grantedPlan:null,expires_at:approve?(expiresAt?expiresAt.toISOString():null):null,reapply_allowed:approve?null:body.reapplyAllowed!==false}
      });
      if(auditError) throw auditError;
      const {error:notifyError}=await admin.from("admin_messages").insert({
        title:approve?("KUROLAB "+(grantedPlan==="standard"?"スタンダード":"Pro")+"が承認されました"):"KUROLAB プラン申請について",
        body:approve?((grantedPlan==="standard"?"スタンダード":"Pro")+"プランが有効になりました。プラン管理ページで利用状況を確認できます。"):(adminNote||"今回のプラン申請は承認されませんでした。再申請が許可されている場合は、内容を見直して再度申請できます。"),
        href:"https://kurolab.cc.cd/pro/",audience:"user",recipient_id:application.user_id,created_by:caller.id,published:true,service_scope:"lab"
      });
      if(notifyError) console.warn("Pro review notification failed",notifyError.message);
      return reply({ok:true,application:updated},200,origin);
    }

    if (action === "create_pro_invitation") {
      const targetUserId=typeof body.userId==="string"?body.userId:"";
      const invitePlan=body.plan==="standard"||body.plan==="pro"?body.plan:"";
      if(!invitePlan) return reply({error:"招待するプランを選択してください。"},400,origin);
      const inviteExpiry=body.inviteExpiresAt?new Date(body.inviteExpiresAt):null;
      const membershipExpiry=body.membershipExpiresAt?new Date(body.membershipExpiresAt):null;
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) return reply({error:"Invalid user ID"},400,origin);
      if(!inviteExpiry||Number.isNaN(inviteExpiry.getTime())||inviteExpiry.getTime()<=Date.now()) return reply({error:"招待の有効期限を未来に設定してください。"},400,origin);
      if(body.membershipExpiresAt && (!membershipExpiry||Number.isNaN(membershipExpiry.getTime())||membershipExpiry.getTime()<=Date.now())) return reply({error:"Pro利用期限を未来に設定してください。"},400,origin);
      if(targetUserId===caller.id) return reply({error:"管理者自身への招待はできません。"},409,origin);
      const {data:target,error:targetError}=await admin.auth.admin.getUserById(targetUserId);
      if(targetError||!target?.user||target.user.is_anonymous) return reply({error:"User not found"},404,origin);
      const {data:protectedAdmin,error:protectedError}=await admin.from("admin_users").select("user_id").eq("user_id",targetUserId).maybeSingle();
      if(protectedError) throw protectedError;
      if(protectedAdmin) return reply({error:"Administrator accounts are not eligible for Pro membership"},409,origin);
      const {data:existing,error:existingError}=await admin.from("pro_memberships").select("status,expires_at,features,plan").eq("user_id",targetUserId).maybeSingle();
      if(existingError) throw existingError;
      const existingActive=existing?.status==="active" && (!existing.expires_at||new Date(existing.expires_at).getTime()>Date.now());
      if(existingActive && ((existing.plan||"pro")==="pro" || invitePlan!=="pro")) return reply({error:"この利用者はすでに有効なプランを利用しています。"},409,origin);
      if(existing?.status==="suspended") return reply({error:"Proが停止中の利用者には招待を発行できません。"},409,origin);
      const {data:invite,error}=await admin.from("pro_invitations").insert({
        invited_user_id:targetUserId,status:"pending",plan:invitePlan,expires_at:inviteExpiry.toISOString(),
        membership_expires_at:membershipExpiry?membershipExpiry.toISOString():null,created_by:caller.id
      }).select("id,invited_user_id,status,plan,expires_at,membership_expires_at,created_at").single();
      if(error) throw error;
      const {error:auditError}=await admin.from("admin_audit_logs").insert({
        actor_user_id:caller.id,action:"pro.invitation.create",target_user_id:targetUserId,
        metadata:{invitation_id:invite.id,invite_expires_at:invite.expires_at,membership_expires_at:invite.membership_expires_at}
      });
      if(auditError) throw auditError;
      const {error:notifyError}=await admin.from("admin_messages").insert({
        title:"KUROLAB "+(invitePlan==="standard"?"スタンダード":"Pro")+"への招待が届きました",
        body:"管理者からKUROLAB "+(invitePlan==="standard"?"スタンダード":"Pro")+"への招待が届きました。プラン管理ページを開き、招待内容を確認して承諾してください。",
        href:"https://kurolab.cc.cd/pro/",audience:"user",recipient_id:targetUserId,created_by:caller.id,published:true,service_scope:"lab"
      });
      if(notifyError) console.warn("Pro invitation notification failed",notifyError.message);
      return reply({ok:true,invitation:invite},200,origin);
    }

    if (action === "update_pro_invitation") {
      const invitationId=typeof body.invitationId==="string"?body.invitationId:"";
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invitationId)) return reply({error:"Invalid invitation ID"},400,origin);
      const {data,error}=await admin.from("pro_invitations").update({status:"revoked"}).eq("id",invitationId).eq("status","pending").select("id,invited_user_id").maybeSingle();
      if(error) throw error;
      if(!data) return reply({error:"招待が見つからないか、すでに処理済みです。"},409,origin);
      const {error:auditError}=await admin.from("admin_audit_logs").insert({actor_user_id:caller.id,action:"pro.invitation.revoke",target_user_id:data.invited_user_id,metadata:{invitation_id:invitationId}});
      if(auditError) throw auditError;
      return reply({ok:true},200,origin);
    }

    if (action === "update_pro_membership") {
      const targetUserId=typeof body.userId==="string"?body.userId:"";
      const operation=String(body.operation||"");
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) return reply({error:"Invalid user ID"},400,origin);
      if(targetUserId===caller.id) return reply({error:"自分自身の管理者Pro権限は変更できません。"},409,origin);
      const {data:protectedAdmin,error:protectedError}=await admin.from("admin_users").select("user_id").eq("user_id",targetUserId).maybeSingle();
      if(protectedError) throw protectedError;
      if(protectedAdmin) return reply({error:"Administrator accounts are protected"},409,origin);
      const {data:current,error:currentError}=await admin.from("pro_memberships").select("status,expires_at,plan,features").eq("user_id",targetUserId).maybeSingle();
      if(currentError) throw currentError;
      if(!current) return reply({error:"Pro membership not found"},404,origin);
      const now=new Date().toISOString();
      let patch:any={updated_at:now};
      if(operation==="suspend") patch.status="suspended";
      else if(operation==="resume") {
        if(current.expires_at&&new Date(current.expires_at).getTime()<=Date.now()) return reply({error:"期限切れのProは期限を更新してから再開してください。"},409,origin);
        patch.status="active";
      } else if(operation==="revoke") patch.status="revoked";
      else if(operation==="set_plan") {
        const nextPlan=body.plan==="standard"||body.plan==="pro"?body.plan:"";
        if(!nextPlan) return reply({error:"プラン指定が正しくありません。"},400,origin);
        patch.plan=nextPlan;
        patch.status="active";
        patch.features=featuresForPlan(nextPlan);
      } else if(operation==="set_features") {
        const incoming=body.features&&typeof body.features==="object"?body.features:{};
        const defaults=featuresForPlan(current.plan==="standard"?"standard":"pro");
        const booleanKeys=["workspace_plus","pro_tools","customization_plus","early_access","desktop","theme_studio","developer_mode","ai","ad_free"];
        patch.features={...defaults,...(current.features||{})};
        for(const key of booleanKeys) if(typeof incoming[key]==="boolean") patch.features[key]=incoming[key];
        if(incoming.analytics==="basic"||incoming.analytics==="advanced") patch.features.analytics=incoming.analytics;
      } else if(operation==="set_expiry") {
        const expiry=body.expiresAt?new Date(body.expiresAt):null;
        if(body.expiresAt && (!expiry||Number.isNaN(expiry.getTime())||expiry.getTime()<=Date.now())) return reply({error:"期限は未来の日時にしてください。"},400,origin);
        patch.expires_at=expiry?expiry.toISOString():null;
        if(current.status==="expired" && !expiry) patch.status="active";
        else if(current.status==="expired" && expiry) patch.status="active";
      } else return reply({error:"Invalid membership operation"},400,origin);
      const {data:updated,error:updateError}=await admin.from("pro_memberships").update(patch).eq("user_id",targetUserId).select("user_id,status,source,plan,expires_at,features,updated_at").single();
      if(updateError) throw updateError;
      const {error:auditError}=await admin.from("admin_audit_logs").insert({actor_user_id:caller.id,action:"pro.membership."+operation,target_user_id:targetUserId,metadata:patch});
      if(auditError) throw auditError;
      const message=operation==="suspend"?"KUROLABのプラン利用が一時停止されました。":operation==="revoke"?"KUROLABの有料プラン権限が解除され、普通プランに戻りました。":operation==="resume"?"KUROLABのプラン利用が再開されました。":operation==="set_plan"?"KUROLABのプランが"+(patch.plan==="standard"?"スタンダード":"Pro")+"に変更されました。":"KUROLABのプラン有効期限が更新されました。";
      const {error:notifyError}=await admin.from("admin_messages").insert({title:"KUROLABのプラン状態が更新されました",body:message,href:"https://kurolab.cc.cd/pro/",audience:"user",recipient_id:targetUserId,created_by:caller.id,published:true,service_scope:"lab"});
      if(notifyError) console.warn("Pro membership notification failed",notifyError.message);
      return reply({ok:true,membership:updated},200,origin);
    }

    if (action === "set_pro_user_control") {
      const targetUserId=typeof body.userId==="string"?body.userId:"";
      const allowed=body.reapplyAllowed!==false;
      const reapplyAfter=body.reapplyAfter?new Date(body.reapplyAfter):null;
      const note=typeof body.adminNote==="string"?body.adminNote.trim().slice(0,1000):"";
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) return reply({error:"Invalid user ID"},400,origin);
      if(body.reapplyAfter && (!reapplyAfter||Number.isNaN(reapplyAfter.getTime()))) return reply({error:"Invalid reapply date"},400,origin);
      const {error}=await admin.from("pro_user_controls").upsert({user_id:targetUserId,reapply_allowed:allowed,reapply_after:reapplyAfter?reapplyAfter.toISOString():null,admin_note:note||null,updated_by:caller.id,updated_at:new Date().toISOString()},{onConflict:"user_id"});
      if(error) throw error;
      const {error:auditError}=await admin.from("admin_audit_logs").insert({actor_user_id:caller.id,action:"pro.reapply_control",target_user_id:targetUserId,metadata:{reapply_allowed:allowed,reapply_after:reapplyAfter?reapplyAfter.toISOString():null}});
      if(auditError) throw auditError;
      return reply({ok:true},200,origin);
    }

    if (action === "list_user_reports") {
      const status = typeof body.status === "string" ? body.status : "open";
      const limit = Math.max(1, Math.min(300, Number(body.limit) || 250));
      let query = admin.from("sns_user_reports")
        .select("id,reporter_id,target_user_id,target_username,reason,details,status,admin_note,reviewed_by,reviewed_at,created_at")
        .order("created_at", { ascending: false }).limit(limit);
      if (status !== "all") query = query.eq("status", status);
      const { data: reports, error } = await query;
      if (error) throw error;
      const rows = reports || [];
      const profileIds = [...new Set(rows.flatMap((r) => [r.reporter_id, r.target_user_id]).filter(Boolean))];
      const { data: profiles, error: profilesError } = profileIds.length
        ? await admin.from("profiles").select("id,username,display_name").in("id", profileIds)
        : { data: [], error: null };
      if (profilesError) throw profilesError;
      const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
      return reply({ reports: rows.map((r) => ({
        ...r,
        reporter: r.reporter_id ? (profileMap.get(r.reporter_id) || null) : null,
        target: r.target_user_id ? (profileMap.get(r.target_user_id) || null) : null
      })) }, 200, origin);
    }

    if (action === "update_user_report") {
      const reportId = typeof body.reportId === "string" ? body.reportId : "";
      const status = typeof body.status === "string" ? body.status : "";
      const adminNote = typeof body.adminNote === "string" ? body.adminNote.trim().slice(0, 1000) : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reportId)) {
        return reply({ error: "Invalid report ID" }, 400, origin);
      }
      if (!["open", "reviewing", "resolved", "dismissed"].includes(status)) {
        return reply({ error: "Invalid report status" }, 400, origin);
      }
      const { data, error } = await admin.from("sns_user_reports").update({
        status, admin_note: adminNote, reviewed_by: caller.id, reviewed_at: new Date().toISOString()
      }).eq("id", reportId).select("id,status").maybeSingle();
      if (error) throw error;
      if (!data) return reply({ error: "Report not found" }, 404, origin);
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id, action: "sns_report.update",
        target_user_id: null,
        metadata: { report_id: reportId, status }
      });
      if (auditError) throw auditError;
      return reply({ ok: true, report: data }, 200, origin);
    }

    if (action === "delete_user") {
      const targetUserId = typeof body.userId === "string" ? body.userId : "";
      const confirmUsername = typeof body.confirmUsername === "string" ? body.confirmUsername.trim() : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
        return reply({ error: "Invalid user ID" }, 400, origin);
      }
      if (targetUserId === caller.id) return reply({ error: "You cannot delete your own administrator account" }, 409, origin);
      const { data: targetAdmin, error: targetAdminError } = await admin.from("admin_users")
        .select("user_id").eq("user_id", targetUserId).maybeSingle();
      if (targetAdminError) throw targetAdminError;
      if (targetAdmin) return reply({ error: "Administrator accounts are protected from deletion" }, 409, origin);

      const { data: targetData, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
      if (targetError || !targetData?.user) return reply({ error: "User not found" }, 404, origin);
      const { data: targetProfile, error: profileError } = await admin
        .from("profiles").select("username").eq("id", targetUserId).maybeSingle();
      if (profileError) throw profileError;
      const expectedConfirmation = String(targetProfile?.username || targetUserId).trim();
      if (!confirmUsername || confirmUsername !== expectedConfirmation) {
        return reply({ error: "Confirmation username or user ID does not match" }, 409, origin);
      }

      // Storage ownership is separate from auth.users foreign keys; remove all
      // owned objects first and abort safely if any removal fails.
      const storageCleanup = await kuroRemoveOwnedStorageObjects(admin, targetUserId);

      // pro_invitations.created_by is RESTRICT; remove only invitations authored
      // by this account. Other user-owned rows cascade through auth.users FKs.
      const { error: invitationError } = await admin.from("pro_invitations")
        .delete().eq("created_by", targetUserId);
      if (invitationError) throw invitationError;

      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id, action: "account.delete", target_user_id: targetUserId,
        metadata: {
          email: targetData.user.email || "",
          username: expectedConfirmation,
          storage_objects_removed: storageCleanup.objects
        }
      });
      if (auditError) throw auditError;

      // auth.users deletion cascades profiles, game records, rankings, saves and
      // refresh sessions. Restrictive RLS also rejects this user's still-live JWT.
      const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId);
      if (deleteError) throw deleteError;
      return reply({ ok: true, storage_objects_removed: storageCleanup.objects }, 200, origin);
    }

    if (action === "update_user_email") {
      const targetUserId = typeof body.userId === "string" ? body.userId : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) return reply({ error: "Invalid user ID" }, 400, origin);
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || email.length > 254) return reply({ error: "Invalid email address" }, 400, origin);
      if (targetUserId === caller.id) return reply({ error: "Change your own administrator email through account settings" }, 409, origin);
      const { data: protectedAdmin, error: protectedError } = await admin.from("admin_users").select("user_id").eq("user_id", targetUserId).maybeSingle();
      if (protectedError) throw protectedError;
      if (protectedAdmin) return reply({ error: "Administrator email changes are protected" }, 409, origin);
      const { data: targetData, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
      if (targetError || !targetData?.user) return reply({ error: "User not found" }, 404, origin);
      const previousEmail = targetData.user.email || "";
      const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(targetUserId, { email });
      if (updateError) throw updateError;
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id, action: "account.email_update", target_user_id: targetUserId,
        metadata: { previous_email: previousEmail, new_email: email }
      });
      if (auditError) throw auditError;
      return reply({ ok: true, email: updated.user?.email || email }, 200, origin);
    }

    if (action === "set_user_plan") {
      const targetUserId = typeof body.userId === "string" ? body.userId : "";
      const plan = ["free","standard","pro"].includes(body.plan) ? body.plan : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) return reply({ error: "Invalid user ID" }, 400, origin);
      if (!plan) return reply({ error: "Plan must be pro or free" }, 400, origin);
      if (targetUserId === caller.id) return reply({ error: "You cannot change your own administrator plan" }, 409, origin);
      const { data: protectedAdmin, error: protectedError } = await admin.from("admin_users").select("user_id").eq("user_id", targetUserId).maybeSingle();
      if (protectedError) throw protectedError;
      if (protectedAdmin) return reply({ error: "Administrator plans are protected" }, 409, origin);
      const { data: targetData, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
      if (targetError || !targetData?.user) return reply({ error: "User not found" }, 404, origin);
      const currentMetadata = targetData.user.app_metadata || {};
      const { data: previousMembership, error: previousMembershipError } = await admin.from("pro_memberships")
        .select("plan,status").eq("user_id", targetUserId).maybeSingle();
      if (previousMembershipError) throw previousMembershipError;
      const previousPlan = previousMembership?.status === "active" ? (previousMembership.plan || "pro") : "free";
      const nextMetadata = { ...currentMetadata };
      if (plan === "free") delete nextMetadata.plan;
      else nextMetadata.plan = plan;
      const { error: updateError } = await admin.auth.admin.updateUserById(targetUserId, { app_metadata: nextMetadata });
      if (updateError) throw updateError;
      if (plan === "free") {
        const { error: membershipError } = await admin.from("pro_memberships").delete().eq("user_id", targetUserId);
        if (membershipError) throw membershipError;
      } else {
        const now = new Date().toISOString();
        const { error: membershipError } = await admin.from("pro_memberships").upsert({
          user_id: targetUserId, status: "active", source: "manual", starts_at: now, expires_at: null,
          plan, features: featuresForPlan(plan), approved_by: caller.id, approved_at: now, updated_at: now
        }, { onConflict: "user_id" });
        if (membershipError) throw membershipError;
      }
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id, action: "account.plan_update", target_user_id: targetUserId,
        metadata: { previous_plan: previousPlan, new_plan: plan, manual_override: true }
      });
      if (auditError) throw auditError;
      const planLabel = plan === "free" ? "普通" : plan === "standard" ? "スタンダード" : "Pro";
      const { error: notifyError } = await admin.from("admin_messages").insert({
        title: "KUROLABのプランが更新されました",
        body: "管理者により「" + planLabel + "」プランへ変更されました。",
        href: "https://kurolab.cc.cd/pro/", audience: "user", recipient_id: targetUserId,
        created_by: caller.id, published: true, service_scope: "lab"
      });
      if (notifyError) console.warn("Plan change notification failed", notifyError.message);
      return reply({ ok: true, plan }, 200, origin);
    }

    if (action === "list_users") {
      const page = Math.max(1, Math.min(200, Number(body.page) || 1));
      const perPage = 500;
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;

      const users = data.users || [];
      const ids = users.map((u) => u.id);
      const nowIso = new Date().toISOString();
      const [profilesResult, prefsResult, suspensionsResult] = ids.length ? await Promise.all([
        admin.from("profiles").select("id,username,display_name").in("id", ids),
        admin.from("portal_preferences").select("user_id,preferences").in("user_id", ids),
        admin.from("account_suspensions").select("id,user_id,starts_at,ends_at,reason")
          .in("user_id", ids).is("revoked_at", null)
          .gt("ends_at", nowIso).order("starts_at", { ascending: false })
      ]) : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null }
      ];

      if (profilesResult.error) throw profilesResult.error;
      if (prefsResult.error) throw prefsResult.error;
      if (suspensionsResult.error) throw suspensionsResult.error;

      const profiles = new Map((profilesResult.data || []).map((p) => [p.id, p]));
      const prefs = new Map((prefsResult.data || []).map((p) => [p.user_id, p.preferences || {}]));
      const suspensions = new Map();
      for (const suspension of suspensionsResult.data || []) {
        if (!suspensions.has(suspension.user_id)) suspensions.set(suspension.user_id, suspension);
      }
      const result = users.filter((u) => !u.is_anonymous).map((u) => {
        const profile = profiles.get(u.id);
        const pref = prefs.get(u.id) || {};
        const workspaces = pref.dashboardWorkspaces;
        const boards = Array.isArray(workspaces)
          ? workspaces.length
          : (workspaces && typeof workspaces === "object" ? Object.keys(workspaces).length : 0);
        const widgets = Array.isArray(pref.dashboardWidgets) ? pref.dashboardWidgets.length : 0;
        return {
          id: u.id,
          email: u.email || "",
          username: profile?.username || "",
          display_name: profile?.display_name || "",
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at || null,
          banned_until: u.banned_until || null,
          temporary_suspension: suspensions.get(u.id) || null,
          board_count: boards,
          widget_count: widgets
        };
      });

      return reply({ users: result, page, perPage, total: Number(data.total) || null, hasMore: users.length === perPage }, 200, origin);
    }

    if (action === "set_ban") {
      const targetUserId = typeof body.userId === "string" ? body.userId : "";
      const enabled = body.enabled === true;
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
        return reply({ error: "Invalid user ID" }, 400, origin);
      }
      if (targetUserId === caller.id) return reply({ error: "You cannot suspend your own administrator account" }, 409, origin);

      const { data: targetAdmin, error: targetAdminError } = await admin
        .from("admin_users").select("user_id,role").eq("user_id", targetUserId).maybeSingle();
      if (targetAdminError) throw targetAdminError;
      if (targetAdmin) return reply({ error: "Administrator accounts are protected from suspension" }, 409, origin);

      const { data: targetData, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
      if (targetError || !targetData?.user) return reply({ error: "User not found" }, 404, origin);

      const { error: updateError } = await admin.auth.admin.updateUserById(
        targetUserId,
        { ban_duration: enabled ? "876000h" : "none" }
      );
      if (updateError) throw updateError;

      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: enabled ? "account.ban" : "account.unban",
        target_user_id: targetUserId,
        metadata: { email: targetData.user.email || "", reason }
      });
      if (auditError) throw auditError;

      return reply({ ok: true, banned: enabled }, 200, origin);
    }

    if (action === "set_account_suspension") {
      const targetUserId = typeof body.userId === "string" ? body.userId : "";
      const startsAt = kuroSecretDate(body.startsAt);
      const endsAt = kuroSecretDate(body.endsAt);
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
      const now = Date.now();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
        return reply({ error: "ユーザーIDが正しくありません。" }, 400, origin);
      }
      if (!startsAt || !endsAt || new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
        return reply({ error: "開始日時と終了日時を正しく指定してください。" }, 400, origin);
      }
      if (new Date(endsAt).getTime() <= now || new Date(startsAt).getTime() > now + 365 * 86400000 ||
          new Date(endsAt).getTime() - new Date(startsAt).getTime() > 365 * 86400000) {
        return reply({ error: "一時停止期間は未来の終了日時を指定し、最長365日以内にしてください。" }, 400, origin);
      }
      if (targetUserId === caller.id) return reply({ error: "管理者自身のアカウントは変更できません。" }, 409, origin);

      const { data: targetAdmin, error: targetAdminError } = await admin
        .from("admin_users").select("user_id").eq("user_id", targetUserId).maybeSingle();
      if (targetAdminError) throw targetAdminError;
      if (targetAdmin) return reply({ error: "管理者アカウントは一時停止できません。" }, 409, origin);

      const { data: targetData, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
      if (targetError || !targetData?.user || targetData.user.is_anonymous) {
        return reply({ error: "対象アカウントが見つかりません。" }, 404, origin);
      }

      const { error: revokeError } = await admin.from("account_suspensions")
        .update({ revoked_at: new Date().toISOString(), revoked_by: caller.id })
        .eq("user_id", targetUserId).is("revoked_at", null);
      if (revokeError) throw revokeError;

      const { data: suspension, error: insertError } = await admin.from("account_suspensions")
        .insert({
          user_id: targetUserId,
          starts_at: startsAt,
          ends_at: endsAt,
          reason,
          created_by: caller.id
        })
        .select("id,user_id,starts_at,ends_at,reason")
        .single();
      if (insertError) throw insertError;

      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: "account.temporary_suspend",
        target_user_id: targetUserId,
        metadata: { starts_at: startsAt, ends_at: endsAt, reason }
      });
      if (auditError) throw auditError;

      const { error: notifyError } = await admin.from("admin_messages").insert({
        title: "アカウントの一時停止について",
        body: reason
          ? "アカウントが一時停止されました。理由：" + reason + "。解除予定：" + endsAt
          : "アカウントが一時停止されました。解除予定：" + endsAt,
        href: "https://kurolab.cc.cd/account/suspension/",
        audience: "user",
        recipient_id: targetUserId,
        created_by: caller.id,
        published: true,
        service_scope: "both"
      });
      if (notifyError) throw notifyError;

      return reply({ ok: true, suspension }, 200, origin);
    }

    if (action === "revoke_account_suspension") {
      const suspensionId = typeof body.suspensionId === "string" ? body.suspensionId : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suspensionId)) {
        return reply({ error: "一時停止IDが正しくありません。" }, 400, origin);
      }
      const { data: suspension, error: suspensionError } = await admin.from("account_suspensions")
        .select("id,user_id,ends_at").eq("id", suspensionId).is("revoked_at", null).maybeSingle();
      if (suspensionError) throw suspensionError;
      if (!suspension) return reply({ error: "有効な一時停止が見つかりません。" }, 404, origin);

      const { error: updateError } = await admin.from("account_suspensions")
        .update({ revoked_at: new Date().toISOString(), revoked_by: caller.id })
        .eq("id", suspensionId).is("revoked_at", null);
      if (updateError) throw updateError;

      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: "account.temporary_unsuspend",
        target_user_id: suspension.user_id,
        metadata: { suspension_id: suspensionId }
      });
      if (auditError) throw auditError;

      const { error: notifyError } = await admin.from("admin_messages").insert({
        title: "アカウントの一時停止が解除されました",
        body: "管理者により一時停止が解除されました。すべてのサービスを通常どおり利用できます。",
        href: "https://kurolab.cc.cd/",
        audience: "user",
        recipient_id: suspension.user_id,
        created_by: caller.id,
        published: true,
        service_scope: "both"
      });
      if (notifyError) throw notifyError;

      return reply({ ok: true, revoked: true, userId: suspension.user_id }, 200, origin);
    }

    if (action === "list_suspension_appeals") {
      const { data: appeals, error: appealsError } = await admin.from("account_suspension_appeals")
        .select("id,user_id,suspension_id,subject,status,created_at,updated_at")
        .order("updated_at", { ascending: false }).limit(250);
      if (appealsError) throw appealsError;
      const appealIds = (appeals || []).map((x) => x.id);
      const userIds = Array.from(new Set((appeals || []).map((x) => x.user_id)));
      if (!appealIds.length) return reply({ appeals: [] }, 200, origin);

      const [profilesResult, suspensionsResult, messagesResult] = await Promise.all([
        admin.from("profiles").select("id,username,display_name").in("id", userIds),
        admin.from("account_suspensions").select("id,starts_at,ends_at,reason,revoked_at").in("id", (appeals || []).map((x) => x.suspension_id)),
        admin.from("account_suspension_appeal_messages")
          .select("id,appeal_id,sender_id,sender_role,message,created_at")
          .in("appeal_id", appealIds).order("created_at", { ascending: true })
      ]);
      if (profilesResult.error) throw profilesResult.error;
      if (suspensionsResult.error) throw suspensionsResult.error;
      if (messagesResult.error) throw messagesResult.error;
      const profiles = new Map((profilesResult.data || []).map((x) => [x.id, x]));
      const suspensions = new Map((suspensionsResult.data || []).map((x) => [x.id, x]));
      const messages = new Map();
      for (const message of messagesResult.data || []) {
        if (!messages.has(message.appeal_id)) messages.set(message.appeal_id, []);
        messages.get(message.appeal_id).push(message);
      }
      return reply({
        appeals: (appeals || []).map((item) => ({
          ...item,
          profile: profiles.get(item.user_id) || null,
          suspension: suspensions.get(item.suspension_id) || null,
          messages: messages.get(item.id) || []
        }))
      }, 200, origin);
    }

    if (action === "reply_suspension_appeal") {
      const appealId = typeof body.appealId === "string" ? body.appealId : "";
      const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(appealId) || !message) {
        return reply({ error: "問い合わせと返信内容を確認してください。" }, 400, origin);
      }
      const { data: appeal, error: appealError } = await admin.from("account_suspension_appeals")
        .select("id,user_id,status").eq("id", appealId).maybeSingle();
      if (appealError) throw appealError;
      if (!appeal) return reply({ error: "問い合わせが見つかりません。" }, 404, origin);
      if (appeal.status === "closed") return reply({ error: "対応完了済みの問い合わせです。" }, 409, origin);

      const { error: messageError } = await admin.from("account_suspension_appeal_messages").insert({
        appeal_id: appealId,
        sender_id: caller.id,
        sender_role: "admin",
        message
      });
      if (messageError) throw messageError;
      const { error: updateError } = await admin.from("account_suspension_appeals")
        .update({ status: "answered", updated_at: new Date().toISOString() }).eq("id", appealId);
      if (updateError) throw updateError;

      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: "account.suspension_appeal.reply",
        target_user_id: appeal.user_id,
        metadata: { appeal_id: appealId }
      });
      if (auditError) throw auditError;
      const { error: notifyError } = await admin.from("admin_messages").insert({
        title: "一時停止について管理者から返信が届きました",
        body: "問い合わせBOXを開いて管理者からの返信を確認してください。",
        href: "https://kurolab.cc.cd/account/suspension/",
        audience: "user",
        recipient_id: appeal.user_id,
        created_by: caller.id,
        published: true,
        service_scope: "both"
      });
      if (notifyError) throw notifyError;

      return reply({ ok: true }, 200, origin);
    }

    if (action === "set_suspension_appeal_status") {
      const appealId = typeof body.appealId === "string" ? body.appealId : "";
      const status = body.status === "open" || body.status === "answered" || body.status === "closed" ? body.status : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(appealId) || !status) {
        return reply({ error: "問い合わせ状態が正しくありません。" }, 400, origin);
      }
      const { error: updateError } = await admin.from("account_suspension_appeals")
        .update({ status, updated_at: new Date().toISOString() }).eq("id", appealId);
      if (updateError) throw updateError;
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: "account.suspension_appeal.status",
        metadata: { appeal_id: appealId, status }
      });
      if (auditError) throw auditError;
      return reply({ ok: true, status }, 200, origin);
    }

    if (action === "send_password_reset") {
      const targetUserId = typeof body.userId === "string" ? body.userId : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
        return reply({ error: "Invalid user ID" }, 400, origin);
      }
      const { data: targetData, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
      if (targetError || !targetData?.user?.email) return reply({ error: "User email not found" }, 404, origin);
      if (targetData.user.email.toLowerCase().endsWith("@username.kurolab.invalid")) {
        return reply({ error: "このアカウントはメール未登録のため、再設定メールを送信できません。" }, 409, origin);
      }

      const { error: resetError } = await admin.auth.resetPasswordForEmail(targetData.user.email);
      if (resetError) throw resetError;

      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: "account.password_reset_email",
        target_user_id: targetUserId,
        metadata: { email: targetData.user.email }
      });
      if (auditError) throw auditError;

      return reply({ ok: true, message: "Password reset email requested" }, 200, origin);
    }


    if (action === "list_secret_codes") {
      const { data, error } = await admin.from("kuro_secret_codes")
        .select("id,label,description,room_key,room_title,enabled,starts_at,expires_at,max_uses,use_count,created_at,updated_at")
        .order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      return reply({ codes: data || [] }, 200, origin);
    }

    if (action === "save_secret_code") {
      const id = typeof body.id === "string" ? body.id.trim() : "";
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const label = typeof body.label === "string" ? body.label.trim() : "";
      const description = typeof body.description === "string" ? body.description.trim() : "";
      const roomKey = "secret-hub";
      const roomTitle = "KURO // CLASSIFIED TERMINAL";
      const startsAt = kuroSecretDate(body.starts_at);
      const expiresAt = kuroSecretDate(body.expires_at);
      const maxUses = body.max_uses === null || body.max_uses === undefined || body.max_uses === ""
        ? null : Number(body.max_uses);
      if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        return reply({ error: "Invalid secret code ID" }, 400, origin);
      }
      if (!label || label.length > 80 || description.length > 500) return reply({ error: "コード名または説明が長すぎます。" }, 400, origin);
      
      
      if (code && !/^\d{4,12}$/.test(code)) return reply({ error: "秘密コードは4〜12桁の数字にしてください。" }, 400, origin);
      if (!id && !code) return reply({ error: "新しいコードを入力してください。" }, 400, origin);
      if (startsAt === undefined || expiresAt === undefined || (startsAt && expiresAt && new Date(expiresAt) <= new Date(startsAt))) {
        return reply({ error: "有効期間を確認してください。" }, 400, origin);
      }
      if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000000)) {
        return reply({ error: "利用上限は1〜1,000,000回、または空欄（無制限）にしてください。" }, 400, origin);
      }
      const row: Record<string, unknown> = {
        label, description, room_key: roomKey, room_title: roomTitle,
        enabled: body.enabled === true, starts_at: startsAt, expires_at: expiresAt,
        max_uses: maxUses, updated_at: new Date().toISOString()
      };
      if (code) row.code_hash = await kuroSecretHmacHex(service, "kuro-secret-code:v1:" + code);
      let saved;
      if (id) {
        const { data, error } = await admin.from("kuro_secret_codes").update(row).eq("id", id)
          .select("id,label,room_key,room_title,enabled,starts_at,expires_at,max_uses,use_count").maybeSingle();
        if (error) throw error;
        if (!data) return reply({ error: "秘密コードが見つかりません。" }, 404, origin);
        saved = data;
      } else {
        row.created_by = caller.id;
        const { data, error } = await admin.from("kuro_secret_codes").insert(row)
          .select("id,label,room_key,room_title,enabled,starts_at,expires_at,max_uses,use_count").single();
        if (error) throw error;
        saved = data;
      }
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: id ? "kurogames_secret.code.update" : "kurogames_secret.code.create",
        metadata: saved
      });
      if (auditError) throw auditError;
      return reply({ code: saved }, 200, origin);
    }

    if (action === "delete_secret_code") {
      const id = typeof body.id === "string" ? body.id.trim() : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        return reply({ error: "Invalid secret code ID" }, 400, origin);
      }
      const { data, error } = await admin.from("kuro_secret_codes").delete().eq("id", id)
        .select("id,label,room_key").maybeSingle();
      if (error) throw error;
      if (!data) return reply({ error: "秘密コードが見つかりません。" }, 404, origin);
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id, action: "kurogames_secret.code.delete", metadata: data
      });
      if (auditError) throw auditError;
      return reply({ ok: true }, 200, origin);
    }

    if (action === "list_secret_content") {
      const { data, error } = await admin.from("kuro_secret_content")
        .select("id,room_key,content_type,title,body,href,icon,reward,sort_order,published,starts_at,ends_at,created_at,updated_at")
        .order("room_key", { ascending: true }).order("sort_order", { ascending: true })
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return reply({ items: data || [] }, 200, origin);
    }

    if (action === "save_secret_content") {
      const id = typeof body.id === "string" ? body.id.trim() : "";
      const roomKey = "secret-hub";
      const contentType = typeof body.content_type === "string" ? body.content_type : "";
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const content = typeof body.body === "string" ? body.body.trim() : "";
      const href = typeof body.href === "string" ? body.href.trim() : "";
      const icon = typeof body.icon === "string" ? body.icon.trim() : "";
      const reward = typeof body.reward === "string" ? body.reward.trim() : "";
      const startsAt = kuroSecretDate(body.starts_at);
      const endsAt = kuroSecretDate(body.ends_at);
      const sortOrder = Number(body.sort_order ?? 100);
      if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        return reply({ error: "Invalid content ID" }, 400, origin);
      }
      
      if (!["game", "diary", "mission", "news"].includes(contentType)) return reply({ error: "コンテンツ種類が正しくありません。" }, 400, origin);
      if (!title || title.length > 120 || content.length > 12000 || icon.length > 24 || reward.length > 120) {
        return reply({ error: "タイトル・本文・アイコン・報酬の文字数を確認してください。" }, 400, origin);
      }
      if (!Number.isInteger(sortOrder) || sortOrder < -10000 || sortOrder > 10000) return reply({ error: "表示順は整数で入力してください。" }, 400, origin);
      if (startsAt === undefined || endsAt === undefined || (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt))) {
        return reply({ error: "公開期間を確認してください。" }, 400, origin);
      }
      if (contentType === "game" && !href) return reply({ error: "隠しゲームにはゲームURLが必要です。" }, 400, origin);
      if (href) {
        if (href.startsWith("/") && !href.startsWith("//")) {
          // Same-site relative path is allowed.
        } else {
          try {
            const parsed = new URL(href);
            if (parsed.protocol !== "https:" || parsed.hostname !== "kurolab.cc.cd") {
              return reply({ error: "リンクはKURO Lab内の相対URL、またはhttps://kurolab.cc.cd のURLにしてください。" }, 400, origin);
            }
          } catch {
            return reply({ error: "リンクURLが正しくありません。" }, 400, origin);
          }
        }
      }
      const row: Record<string, unknown> = {
        room_key: roomKey, content_type: contentType, title, body: content, href, icon, reward,
        sort_order: sortOrder, published: body.published === true,
        starts_at: startsAt, ends_at: endsAt, updated_at: new Date().toISOString()
      };
      let saved;
      if (id) {
        const { data, error } = await admin.from("kuro_secret_content").update(row).eq("id", id)
          .select("id,room_key,content_type,title,published").maybeSingle();
        if (error) throw error;
        if (!data) return reply({ error: "秘密コンテンツが見つかりません。" }, 404, origin);
        saved = data;
      } else {
        row.created_by = caller.id;
        const { data, error } = await admin.from("kuro_secret_content").insert(row)
          .select("id,room_key,content_type,title,published").single();
        if (error) throw error;
        saved = data;
      }
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: id ? "kurogames_secret.content.update" : "kurogames_secret.content.create",
        metadata: saved
      });
      if (auditError) throw auditError;
      return reply({ item: saved }, 200, origin);
    }

    if (action === "delete_secret_content") {
      const id = typeof body.id === "string" ? body.id.trim() : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        return reply({ error: "Invalid content ID" }, 400, origin);
      }
      const { data, error } = await admin.from("kuro_secret_content").delete().eq("id", id)
        .select("id,room_key,content_type,title").maybeSingle();
      if (error) throw error;
      if (!data) return reply({ error: "秘密コンテンツが見つかりません。" }, 404, origin);
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id, action: "kurogames_secret.content.delete", metadata: data
      });
      if (auditError) throw auditError;
      return reply({ ok: true }, 200, origin);
    }

    if (action === "list_feature_flags") {
      const { data, error } = await admin.from("feature_flags")
        .select("key,label,description,enabled,rollout_percentage,allowed_user_ids,created_at,updated_at,updated_by")
        .order("key", { ascending: true });
      if (error) throw error;
      return reply({ flags: data || [] }, 200, origin);
    }

    if (action === "save_feature_flag") {
      const key = typeof body.key === "string" ? body.key.trim().toLowerCase() : "";
      const label = typeof body.label === "string" ? body.label.trim() : "";
      const description = typeof body.description === "string" ? body.description.trim() : "";
      const percentage = Number(body.rollout_percentage ?? 100);
      if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(key)) return reply({ error: "Invalid flag key" }, 400, origin);
      if (!label || label.length > 80) return reply({ error: "Label must be 1-80 characters" }, 400, origin);
      if (description.length > 500) return reply({ error: "Description is too long" }, 400, origin);
      if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) return reply({ error: "Rollout must be 0-100" }, 400, origin);
      const { data, error } = await admin.from("feature_flags").upsert({
        key, label, description,
        enabled: body.enabled === true,
        rollout_percentage: percentage,
        updated_at: new Date().toISOString(),
        updated_by: caller.id
      }, { onConflict: "key" }).select("key,label,enabled,rollout_percentage").single();
      if (error) throw error;
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: "feature_flag.save",
        metadata: data
      });
      if (auditError) throw auditError;
      return reply({ flag: data }, 200, origin);
    }

    if (action === "delete_feature_flag") {
      const key = typeof body.key === "string" ? body.key.trim().toLowerCase() : "";
      if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(key)) return reply({ error: "Invalid flag key" }, 400, origin);
      const { data, error } = await admin.from("feature_flags").delete().eq("key", key).select("key,label").maybeSingle();
      if (error) throw error;
      if (!data) return reply({ error: "Feature flag not found" }, 404, origin);
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: "feature_flag.delete",
        metadata: data
      });
      if (auditError) throw auditError;
      return reply({ ok: true }, 200, origin);
    }

    return reply({ error: "Unsupported action" }, 400, origin);
  } catch (error) {
    console.error("admin-console error", error);
    return reply({ error: safeError(error) }, 500, origin);
  }
});