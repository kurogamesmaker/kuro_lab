import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
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
    if (required) throw new HttpError(403, "このアカウントは一時停止中です。ストア機能は利用できません。");
    return null;
  }
  return data.user;
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
        .eq("is_active", true).order("sort_order", { ascending: true }).order("created_at", { ascending: false });
      if (itemError) throw itemError;

      let inventory: unknown[] = [];
      let equipped: unknown[] = [];
      let profile: Record<string, unknown> | null = null;
      if (user) {
        const [inventoryResult, equippedResult, profileResult] = await Promise.all([
          admin.from("kuro_store_user_inventory").select("id,item_id,source,acquired_at").eq("user_id", user.id).order("acquired_at", { ascending: false }),
          admin.from("kuro_store_equipped_items").select("slot,item_id,updated_at").eq("user_id", user.id),
          admin.from("profiles").select("username,display_name,kuro_id").eq("id", user.id).maybeSingle(),
        ]);
        if (inventoryResult.error) throw inventoryResult.error;
        if (equippedResult.error) throw equippedResult.error;
        if (profileResult.error) throw profileResult.error;
        inventory = inventoryResult.data ?? [];
        equipped = equippedResult.data ?? [];
        profile = profileResult.data ?? null;
      }
      return reply(200, { items: items ?? [], inventory, equipped, profile, isLoggedIn: !!user });
    }

    if (action === "claim_free") {
      const user = await resolveUser(req, true);
      const itemId = typeof body.itemId === "string" ? body.itemId : "";
      if (!UUID_RE.test(itemId)) throw new HttpError(400, "商品IDが正しくありません。");
      const { data, error } = await admin.rpc("kuro_store_claim_free_item", {
        p_user_id: user!.id, p_item_id: itemId,
      });
      if (error) {
        const message = error.message || "";
        if (message.includes("STORE_ITEM_NOT_AVAILABLE")) throw new HttpError(404, "このアイテムは現在取得できません。");
        if (message.includes("STORE_ITEM_NOT_FREE")) throw new HttpError(400, "このアイテムは無料取得の対象ではありません。");
        throw error;
      }
      return reply(200, { result: data });
    }

    if (action === "equip") {
      const user = await resolveUser(req, true);
      const slot = typeof body.slot === "string" ? body.slot : "";
      const itemId = body.itemId === null || body.itemId === undefined ? null : String(body.itemId);
      if (!["avatar", "frame", "background", "theme"].includes(slot)) throw new HttpError(400, "装備スロットが正しくありません。");
      if (itemId !== null && !UUID_RE.test(itemId)) throw new HttpError(400, "アイテムIDが正しくありません。");
      const { data, error } = await admin.rpc("kuro_store_set_equipped_item", {
        p_user_id: user!.id, p_slot: slot, p_item_id: itemId,
      });
      if (error) {
        if ((error.message || "").includes("STORE_ITEM_NOT_OWNED_OR_SLOT_MISMATCH")) {
          throw new HttpError(403, "このスロットに装備できる所持アイテムではありません。");
        }
        throw error;
      }
      return reply(200, { result: data });
    }

    throw new HttpError(400, "操作が正しくありません。");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error("[kurogames-store]", error);
    return reply(status, { error: error instanceof Error ? error.message : "ストア処理に失敗しました。" });
  }
});
