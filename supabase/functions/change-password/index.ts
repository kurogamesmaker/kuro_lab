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
    return reply({ error: "パスワード変更サーバーの設定が不足しています。" }, 503, origin);
  }

  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  if (!token) return reply({ error: "ログイン状態を確認できません。再ログインしてください。" }, 401, origin);

  try {
    const body = await req.json().catch(() => ({}));
    const newPassword = String(body?.newPassword || "");
    const confirmPassword = String(body?.confirmPassword || "");
    if (newPassword.length < 8 || newPassword.length > 72) {
      return reply({ error: "新しいパスワードは8〜72文字で入力してください。" }, 400, origin);
    }
    if (newPassword !== confirmPassword) {
      return reply({ error: "確認用パスワードが一致しません。" }, 400, origin);
    }

    const admin = createClient(url, service, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: verified, error: verifyError } = await admin.auth.getUser(token);
    const user = verified?.user;
    if (verifyError || !user || user.is_anonymous || user.app_metadata?.provider === "anonymous") {
      return reply({ error: "ログイン済みの通常アカウントで操作してください。" }, 401, origin);
    }

    // app_metadata.providers is managed by Supabase Auth. Do not use
    // user_metadata for deciding whether a password check can be skipped.
    const providers = Array.isArray(user.app_metadata?.providers)
      ? user.app_metadata.providers.map((value: unknown) => String(value))
      : [];
    if (providers.includes("email")) {
      const currentPassword = String(body?.currentPassword || "");
      if (!currentPassword || !user.email) {
        return reply({ error: "現在のパスワードを入力してください。" }, 400, origin);
      }
      const verifier = createClient(url, anon, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      });
      const { error: passwordError } = await verifier.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
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
        return reply({ error: "安全のため、いったんログアウトして再ログインしてからパスワードを設定してください。" }, 401, origin);
      }
    }

    const nextMetadata = { ...(user.user_metadata || {}), kuro_password_configured: true };
    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
      password: newPassword,
      user_metadata: nextMetadata,
    });
    if (updateError) throw updateError;

    try {
      const { error: revokeError } = await admin.auth.admin.signOut(token, "global");
      if (revokeError) console.warn("password update session revocation warning", revokeError.message);
    } catch (revokeError) {
      console.warn("password update session revocation warning", revokeError);
    }

    return reply({ success: true, reauthenticate: true }, 200, origin);
  } catch (error) {
    console.error("change-password error", error);
    return reply({
      error: "パスワードを変更できませんでした。時間をおいて再度お試しください。",
    }, 500, origin);
  }
});
