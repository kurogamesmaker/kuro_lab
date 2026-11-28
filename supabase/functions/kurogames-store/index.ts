import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Supabase server environment is not configured.");

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

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
function reply(status: number, data: Record<string, unknown>) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

async function isSuspended(userId: string) {
  const now = new Date().toISOString();
  const { data, error } = await admin.from("account_suspensions")
    .select("id").eq("user_id", userId).is("revoked_at", null)
    .lte("starts_at", now).gt("ends_at", now).limit(1).maybeSingle();
  if (error) throw new HttpError(503, "アカウントの利用状態を確認できません。時間をおいて再度お試しください。");
  return !!data;
}
async function resolveUser(req: Request, required: boolean) {
  const token = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  if (!token || token.length > 8192 || token.split(".").length !== 3) {
    if (required) throw new HttpError(401, "アイテムの取得にはKUROアカウントでのログインが必要です。");
    return null;
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) {
    if (required) throw new HttpError(401, "ログイン状態を確認できません。KUROアカウントで再ログインしてください。");
    return null;
  }
  if (await isSuspended(data.user.id)) {
    throw new HttpError(403, "このアカウントは一時停止中です。ストア機能は利用できません。");
  }
  return data.user;
}

async function requireSecurityGate(req: Request, tool: string) {
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new HttpError(401, "ログイン状態を確認できません。");
  const gateResponse = await fetch(`${SUPABASE_URL}/functions/v1/kuro-security-gate`, {
    method: "POST",
    headers: {
      "Authorization": authorization,
      "apikey": req.headers.get("apikey") || SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
      "Origin": req.headers.get("Origin") || "https://kurolab.cc.cd",
      ...(req.headers.get("User-Agent") ? { "User-Agent": req.headers.get("User-Agent")! } : {}),
      ...(req.headers.get("Sec-CH-UA-Platform") ? { "Sec-CH-UA-Platform": req.headers.get("Sec-CH-UA-Platform")! } : {}),
      ...(req.headers.get("Accept-Language") ? { "Accept-Language": req.headers.get("Accept-Language")! } : {}),
      ...(req.headers.get("X-Real-IP") ? { "X-Real-IP": req.headers.get("X-Real-IP")! } : {}),
      ...(req.headers.get("CF-Connecting-IP") ? { "CF-Connecting-IP": req.headers.get("CF-Connecting-IP")! } : {})
    },
    body: JSON.stringify({ action: "check", tool })
  });
  const gateResult = await gateResponse.json().catch(() => ({}));
  if (!gateResponse.ok || gateResult?.allowed !== true) {
    throw new HttpError(gateResponse.status >= 500 ? 503 : (gateResponse.status === 401 ? 401 : 403),
      gateResult?.message || "KURO Security Gateでアクセスが拒否されました。");
  }
}

async function callD1Store(req: Request, payload: Record<string, unknown>, studio = false) {
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new HttpError(401, "ログイン状態を確認できません。");
  const headers: Record<string, string> = {
    "Authorization": authorization,
    "Content-Type": "application/json",
    "Accept": "application/json"
  };
  if (studio) headers["X-KURO-Store-Tool"] = "shop-studio";
  let upstream: Response;
  try {
    upstream = await fetch("https://kurolab.cc.cd/api/kuro-economy/store", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000)
    });
  } catch (_) {
    throw new HttpError(503, "Cloudflareのストア処理に接続できません。少し時間をおいて再度お試しください。");
  }
  const result = await upstream.json().catch(() => ({}));
  if (!upstream.ok) throw new HttpError(upstream.status >= 500 ? 503 : upstream.status, result?.error || "Cloudflareのストア処理に失敗しました。");
  return result;
}

async function requireStudioMember(userId: string, req: Request) {
  const { data, error } = await admin.from("kuro_store_studio_members")
    .select("user_id,role,is_active").eq("user_id", userId).eq("is_active", true).maybeSingle();
  if (error) throw new HttpError(503, "Shop Studioの権限を確認できませんでした。");
  if (!data) throw new HttpError(403, "このアカウントにはShop Studioの利用権限がありません。");
  await requireSecurityGate(req, "shop-studio");
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return reply(405, { error: "POSTで呼び出してください。" });

  try {
    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "catalog") {
      const user = await resolveUser(req, false);
      const { data: items, error: itemError } = await admin.from("kuro_store_items")
        .select("id,item_key,name,description,category,icon,image_url,rarity,price_kc,is_free,sort_order")
        .is("deleted_at", null).eq("is_active", true).order("sort_order", { ascending: true }).order("created_at", { ascending: false });
      if (itemError) throw itemError;

      let inventory: unknown[] = [];
      let equipped: unknown[] = [];
      let profile: Record<string, unknown> | null = null;
      let coinBalance: number | null = null;
      if (user) {
        const [economy, profileResult] = await Promise.all([
          callD1Store(req, { action: "catalog" }),
          admin.from("profiles").select("username,display_name,kuro_id").eq("id", user.id).maybeSingle(),
        ]);
        if (profileResult.error) throw profileResult.error;
        inventory = economy.inventory ?? [];
        equipped = economy.equipped ?? [];
        profile = profileResult.data ?? null;
        coinBalance = Number(economy.coinBalance ?? 0);
      }
      return reply(200, { items: items ?? [], inventory, equipped, profile, isLoggedIn: !!user, coinBalance });
    }

    if (action === "claim_free") {
      const user = await resolveUser(req, true);
      const itemId = typeof body.itemId === "string" ? body.itemId : "";
      if (!UUID_RE.test(itemId)) throw new HttpError(400, "商品IDが正しくありません。");
      const result = await callD1Store(req, { action: "claim_free", itemId });
      return reply(200, result);
    }


    if (action === "purchase") {
      const user = await resolveUser(req, true);
      const itemId = typeof body.itemId === "string" ? body.itemId : "";
      const requestId = typeof body.requestId === "string" ? body.requestId : "";
      if (!UUID_RE.test(itemId) || !UUID_RE.test(requestId)) throw new HttpError(400, "購入リクエストが正しくありません。");
      const result = await callD1Store(req, { action: "purchase", itemId, requestId });
      return reply(200, result);
    }
    if (action === "discard_item") {
      const user = await resolveUser(req, true);
      const inventoryId = typeof body.inventoryId === "string" ? body.inventoryId : "";
      if (!UUID_RE.test(inventoryId)) throw new HttpError(400, "所持アイテムIDが正しくありません。");
      const result = await callD1Store(req, { action: "discard_item", inventoryId });
      return reply(200, result);
    }

    if (action === "equip") {
      const user = await resolveUser(req, true);
      const slot = typeof body.slot === "string" ? body.slot : "";
      const itemId = body.itemId === null || body.itemId === undefined ? null : String(body.itemId);
      if (!["avatar", "frame", "background", "theme", "nameplate", "banner"].includes(slot)) throw new HttpError(400, "装備スロットが正しくありません。");
      if (itemId !== null && !UUID_RE.test(itemId)) throw new HttpError(400, "アイテムIDが正しくありません。");
      const result = await callD1Store(req, { action: "equip", slot, itemId });
      return reply(200, result);
    }


    if (action === "studio_dashboard") {
      const user = await resolveUser(req, true);
      const studioMember = await requireStudioMember(user!.id, req);
      const canViewSales = studioMember.role === "owner";
      const [itemsResult, salesD1, membersResult] = await Promise.all([
        admin.from("kuro_store_items").select("id,item_key,name,description,category,icon,image_url,rarity,price_kc,is_free,is_active,sort_order,created_at,updated_at,deleted_at").order("sort_order", { ascending: true }).order("created_at", { ascending: false }),
        canViewSales
          ? callD1Store(req, { action: "studio_sales" }, true)
          : Promise.resolve({ summary: { purchaseCount: 0, totalKC: 0 }, recentSales: [] }),
        canViewSales
          ? admin.from("kuro_store_studio_members").select("user_id,role,is_active,created_at").order("created_at", { ascending: true })
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (itemsResult.error) throw itemsResult.error;
      if (membersResult.error) throw membersResult.error;
      const items = itemsResult.data ?? [];
      let studioMembers: Record<string, unknown>[] = [];
      if (canViewSales) {
        const memberIds = (membersResult.data ?? []).map((member: any) => member.user_id);
        const profilesResult = memberIds.length
          ? await admin.from("profiles").select("id,username,display_name,kuro_id").in("id", memberIds)
          : { data: [], error: null };
        if (profilesResult.error) throw profilesResult.error;
        const profileById = new Map((profilesResult.data ?? []).map((profile: any) => [profile.id, profile]));
        studioMembers = (membersResult.data ?? []).map((member: any) => ({
          ...member,
          profile: profileById.get(member.user_id) ?? null,
        }));
      }
      const salesSummary = salesD1.summary ?? {};
      return reply(200, {
        items,
        recentSales: canViewSales ? salesD1.recentSales ?? [] : [],
        members: studioMembers,
        canViewSales,
        member: { role: studioMember.role },
        stats: {
          totalItems: items.filter((item: any) => !item.deleted_at).length,
          activeItems: items.filter((item: any) => !item.deleted_at && item.is_active).length,
          salesCount: canViewSales ? Number(salesSummary.purchaseCount ?? 0) : null,
          salesTotalKC: canViewSales ? Number(salesSummary.totalKC ?? 0) : null,
        },
      });
    }

    if (action === "studio_list_drafts") {
      const user = await resolveUser(req, true);
      await requireStudioMember(user!.id, req);
      const { data, error } = await admin.from("kuro_store_design_drafts")
        .select("id,draft_name,category,design_data,created_at,updated_at")
        .eq("created_by", user!.id)
        .order("updated_at", { ascending: false }).limit(50);
      if (error) throw error;
      return reply(200, { drafts: data ?? [] });
    }

    if (action === "studio_save_draft") {
      const user = await resolveUser(req, true);
      await requireStudioMember(user!.id, req);
      const draftId = typeof body.draftId === "string" ? body.draftId : "";
      const category = typeof body.category === "string" ? body.category : "";
      const draftName = typeof body.draftName === "string" ? body.draftName.trim() : "";
      const designData = body.designData;
      if (draftId && !UUID_RE.test(draftId)) throw new HttpError(400, "下書きIDが正しくありません。");
      if (!["background", "frame"].includes(category)) throw new HttpError(400, "デザインの種類が正しくありません。");
      if (draftName.length < 1 || draftName.length > 60) throw new HttpError(400, "デザイン名は1〜60文字にしてください。");
      if (!designData || typeof designData !== "object" || Array.isArray(designData)) throw new HttpError(400, "デザインデータが正しくありません。");
      let serialized = "";
      try { serialized = JSON.stringify(designData); } catch { throw new HttpError(400, "デザインデータを読み取れません。"); }
      if (serialized.length > 100000) throw new HttpError(413, "デザインデータが大きすぎます。画像はファイルとしてアップロードしてください。");
      const values = {
        draft_name: draftName,
        category,
        design_data: designData,
        updated_at: new Date().toISOString(),
      };
      const query = draftId
        ? admin.from("kuro_store_design_drafts").update(values).eq("id", draftId).eq("created_by", user!.id)
        : admin.from("kuro_store_design_drafts").insert({ ...values, created_by: user!.id });
      const { data, error } = await query
        .select("id,draft_name,category,design_data,created_at,updated_at").maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(404, "下書きが見つかりません。再読み込みしてください。");
      return reply(200, { draft: data });
    }

    if (action === "studio_delete_draft") {
      const user = await resolveUser(req, true);
      await requireStudioMember(user!.id, req);
      const draftId = typeof body.draftId === "string" ? body.draftId : "";
      if (!UUID_RE.test(draftId)) throw new HttpError(400, "下書きIDが正しくありません。");
      const { data, error } = await admin.from("kuro_store_design_drafts")
        .delete().eq("id", draftId).eq("created_by", user!.id)
        .select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(404, "下書きが見つかりません。");
      return reply(200, { deleted: true });
    }

    if (action === "studio_save_item") {
      const user = await resolveUser(req, true);
      await requireStudioMember(user!.id, req);
      const itemId = typeof body.itemId === "string" ? body.itemId : "";
      if (itemId && !UUID_RE.test(itemId)) throw new HttpError(400, "商品IDが正しくありません。");
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const description = typeof body.description === "string" ? body.description.trim() : "";
      const category = typeof body.category === "string" ? body.category : "";
      const rarity = typeof body.rarity === "string" ? body.rarity : "common";
      const icon = typeof body.icon === "string" ? body.icon.trim() : "🎁";
      const imageUrl = body.imageUrl == null || body.imageUrl === "" ? null : String(body.imageUrl).trim();
      const priceKC = Number(body.priceKC);
      const sortOrder = Number(body.sortOrder ?? 100);
      if (name.length < 1 || name.length > 60) throw new HttpError(400, "商品名は1〜60文字で入力してください。");
      if (description.length > 500) throw new HttpError(400, "説明は500文字以内にしてください。");
      if (!["avatar","frame","background","theme","nameplate","banner","other"].includes(category)) throw new HttpError(400, "カテゴリーが正しくありません。");
      if (!["common","rare","epic","legendary"].includes(rarity)) throw new HttpError(400, "レアリティが正しくありません。");
      if (icon.length < 1 || icon.length > 12) throw new HttpError(400, "アイコンは1〜12文字で入力してください。");
      if (!Number.isInteger(priceKC) || priceKC < 0 || priceKC > 1000000) throw new HttpError(400, "価格は0〜1,000,000 KCの整数にしてください。");
      if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) throw new HttpError(400, "表示順は0〜9999の整数にしてください。");
      if (imageUrl && !((imageUrl.startsWith("/") && !imageUrl.startsWith("//")) || /^https:\/\//i.test(imageUrl))) throw new HttpError(400, "商品画像URLはHTTPSまたはサイト内パスを指定してください。");
      let itemKey = typeof body.itemKey === "string" ? body.itemKey.trim().toLowerCase() : "";
      if (!itemKey && itemId) {
        const current = await admin.from("kuro_store_items").select("item_key").eq("id", itemId).maybeSingle();
        if (current.error) throw current.error;
        itemKey = current.data?.item_key ?? "";
      }
      if (!itemKey) itemKey = "item-" + crypto.randomUUID().slice(0, 8);
      if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(itemKey)) throw new HttpError(400, "商品キーは半角英数字・ハイフン・アンダーバーで2〜48文字にしてください。");
      const values: Record<string, unknown> = {
        item_key: itemKey, name, description, category, icon, image_url: imageUrl, rarity,
        price_kc: priceKC, is_free: priceKC === 0, sort_order: sortOrder,
        updated_at: new Date().toISOString(),
      };
      if (!itemId) values.created_by = user!.id;
      const query = itemId
        ? admin.from("kuro_store_items").update(values).eq("id", itemId)
        : admin.from("kuro_store_items").insert(values);
      const { data, error } = await query.select("id,item_key,name,description,category,icon,image_url,rarity,price_kc,is_free,is_active,sort_order,created_at,updated_at").single();
      if (error) {
        if (error.code === "23505") throw new HttpError(409, "この商品キーはすでに使われています。");
        throw error;
      }
      return reply(200, { item: data });
    }


    if (action === "studio_set_member") {
      const user = await resolveUser(req, true);
      const actorMember = await requireStudioMember(user!.id, req);
      if (actorMember.role !== "owner") throw new HttpError(403, "メンバー管理はShop Studioのownerのみ実行できます。");
      const kuroId = typeof body.kuroId === "string" ? body.kuroId.trim().toUpperCase() : "";
      const role = typeof body.role === "string" ? body.role : "editor";
      const isActive = body.isActive !== false;
      if (!/^KURO-[A-Z0-9]{6,32}$/.test(kuroId)) throw new HttpError(400, "KURO IDを正しく入力してください。");
      if (!["owner", "editor"].includes(role)) throw new HttpError(400, "権限の種類が正しくありません。");
      const targetResult = await admin.from("profiles").select("id,username,display_name,kuro_id").eq("kuro_id", kuroId).maybeSingle();
      if (targetResult.error) throw targetResult.error;
      if (!targetResult.data) throw new HttpError(404, "指定したKURO IDのアカウントが見つかりません。");
      if (await isSuspended(targetResult.data.id)) throw new HttpError(403, "利用停止中のアカウントにはShop Studio権限を付与できません。");
      const { data, error } = await admin.rpc("kuro_store_studio_set_member", {
        p_actor_user_id: user!.id,
        p_target_user_id: targetResult.data.id,
        p_role: role,
        p_is_active: isActive,
      });
      if (error) {
        const message = error.message || "";
        if (message.includes("STUDIO_LAST_OWNER")) throw new HttpError(409, "最後のownerは停止・降格できません。先に別のownerを追加してください。");
        if (message.includes("STUDIO_OWNER_REQUIRED")) throw new HttpError(403, "Shop Studioのowner権限が必要です。");
        throw error;
      }
      return reply(200, { result: data, profile: targetResult.data });
    }
    if (action === "studio_delete_item") {
      const user = await resolveUser(req, true);
      await requireStudioMember(user!.id, req);
      const itemId = typeof body.itemId === "string" ? body.itemId : "";
      if (!UUID_RE.test(itemId)) throw new HttpError(400, "商品IDが正しくありません。");
      const { data, error } = await admin.from("kuro_store_items")
        .update({ is_active: false, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", itemId).is("deleted_at", null).select("id,name,deleted_at").maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(404, "商品が見つからないか、すでに削除されています。");
      return reply(200, { item: data });
    }
    if (action === "studio_restore_item") {
      const user = await resolveUser(req, true);
      await requireStudioMember(user!.id, req);
      const itemId = typeof body.itemId === "string" ? body.itemId : "";
      if (!UUID_RE.test(itemId)) throw new HttpError(400, "商品IDが正しくありません。");
      const { data, error } = await admin.from("kuro_store_items")
        .update({ is_active: false, deleted_at: null, updated_at: new Date().toISOString() })
        .eq("id", itemId).not("deleted_at", "is", null).select("id,name,deleted_at,is_active").maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(404, "削除済み商品が見つかりません。");
      return reply(200, { item: data });
    }
    if (action === "studio_set_status") {
      const user = await resolveUser(req, true);
      await requireStudioMember(user!.id, req);
      const itemId = typeof body.itemId === "string" ? body.itemId : "";
      const isActive = body.isActive === true;
      if (!UUID_RE.test(itemId)) throw new HttpError(400, "商品IDが正しくありません。");
      const { data, error } = await admin.from("kuro_store_items")
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq("id", itemId).is("deleted_at", null).select("id,is_active").maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(404, "商品が見つからないか、削除済みです。先に復元してください。");
      return reply(200, { item: data });
    }
    throw new HttpError(400, "操作が正しくありません。");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error("[kurogames-store]", error);
    return reply(status, { error: error instanceof Error ? error.message : "ストア処理に失敗しました。" });
  }
});
