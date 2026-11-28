import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://kurolab.cc.cd",
  "https://www.kurolab.cc.cd",
]);

function cors(origin: string | null) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function reply(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
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

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reply({ error: "Origin not allowed" }, 403, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) {
    return reply({ error: "アカウント削除サーバーの設定が不足しています。" }, 503, origin);
  }

  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  if (!token) return reply({ error: "ログイン状態を確認できません。再ログインしてください。" }, 401, origin);

  try {
    const body = await req.json().catch(() => ({}));
    if (body?.confirmation !== "削除する") {
      return reply({ error: "最終確認の入力が一致しません。" }, 400, origin);
    }

    const admin = createClient(url, service, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: verified, error: verifyError } = await admin.auth.getUser(token);
    const user = verified?.user;
    if (verifyError || !user || user.is_anonymous || user.app_metadata?.provider === "anonymous") {
      return reply({ error: "ログイン済みの通常アカウントで操作してください。" }, 401, origin);
    }

    const { data: adminRole, error: roleError } = await admin
      .from("admin_users")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (roleError) throw roleError;
    if (adminRole?.role === "owner") {
      return reply({ error: "このアカウントはKUROLABの唯一の所有者です。所有者権限を別のアカウントへ移してから削除してください。" }, 409, origin);
    }

    // Providers are stored in app_metadata, which is controlled by Auth and
    // cannot be changed by the user like user_metadata can.
    const providers = Array.isArray(user.app_metadata?.providers)
      ? user.app_metadata.providers.map((value: unknown) => String(value))
      : [];
    const passwordConfigured = user.app_metadata?.kuro_password_configured === true || (providers.includes("email") && user.user_metadata?.kuro_password_configured !== false);
    if (passwordConfigured) {
      const password = String(body?.password || "");
      if (!password || !user.email) {
        return reply({ error: "本人確認のため、現在のパスワードを入力してください。" }, 400, origin);
      }
      const verifier = createClient(url, anon, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      });
      const { error: passwordError } = await verifier.auth.signInWithPassword({
        email: user.email,
        password,
      });
      await verifier.auth.signOut({ scope: "local" }).catch(() => undefined);
      if (passwordError) {
        return reply({ error: "現在のパスワードが正しくありません。" }, 401, origin);
      }
    } else {
      const claims = decodeJwtPayload(token);
      const authTime = Number(claims?.auth_time || 0);
      const ageSeconds = Math.floor(Date.now() / 1000) - authTime;
      if (!authTime || ageSeconds < 0 || ageSeconds > 15 * 60) {
        return reply({ error: "安全のため、いったんログアウトして再ログインしてから削除してください。" }, 401, origin);
      }
    }

    // Remove every Storage object owned by this account, not only avatars.
    // Stop before Auth deletion if cleanup fails so the operation can be retried.
    await kuroRemoveOwnedStorageObjects(admin, user.id);

    // This is the only RESTRICT foreign key from public tables to auth.users.
    // Remove only invitations created by the deleting account before Auth deletion.
    const { error: invitationError } = await admin
      .from("pro_invitations")
      .delete()
      .eq("created_by", user.id);
    if (invitationError) throw invitationError;

    // D1 is the live source for direct/group chat data. Clean it before
    // deleting the Auth user so a failed cleanup can be retried safely.
    const chatCleanupResponse = await fetch("https://kurolab.cc.cd/api/kuro-d1/chat-account-cleanup", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(15000)
    });
    const chatCleanupPayload = await chatCleanupResponse.json().catch(() => null);
    if (!chatCleanupResponse.ok || !chatCleanupPayload?.success) {
      throw new Error(chatCleanupPayload?.error?.message || "Cloudflare D1 chat cleanup failed");
    }

    try {
      const { error: revokeError } = await admin.auth.admin.signOut(token, "global");
      if (revokeError) console.warn("account session revocation warning", revokeError.message);
    } catch (revokeError) {
      console.warn("account session revocation warning", revokeError);
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) throw deleteError;

    return reply({ success: true }, 200, origin);
  } catch (error) {
    console.error("delete-account error", error);
    return reply({
      error: "アカウント削除を完了できませんでした。時間をおいて再度お試しください。",
    }, 500, origin);
  }
});
