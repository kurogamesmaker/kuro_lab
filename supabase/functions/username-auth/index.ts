import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://kurolab.cc.cd",
  "https://www.kurolab.cc.cd",
  "https://admin.kurolab.cc.cd",
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

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}

const usernamePattern = /^[A-Za-z0-9_]{3,24}$/;
const genericLoginError = "ユーザーネームまたはパスワードが正しくありません。";

// Postgres ILIKE treats "_" and "%" as wildcards. Escape them so the
// lookup is an exact, case-insensitive username match.
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => "\\" + character);
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
    return reply({ error: "認証サーバーの設定が不足しています。" }, 503, origin);
  }

  try {
    const body = await req.json();
    const action = String(body?.action || "");
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");

    if (action === "change_username") {
      if (!usernamePattern.test(username)) return reply({ error: "ユーザーネームは半角英数字と_の3〜24文字で入力してください。" }, 400, origin);
      const token = req.headers.get("Authorization")?.replace(/^Bearer\\s+/i, "") || "";
      if (!token) return reply({ error: "ログインしてください。" }, 401, origin);
      if (!url || !service) return reply({ error: "認証サーバーの設定が不足しています。" }, 503, origin);
      const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data: verified, error: verifyError } = await admin.auth.getUser(token);
      if (verifyError || !verified.user) return reply({ error: "ログイン状態を確認できません。再ログインしてください。" }, 401, origin);
      const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const { data: attempts, error: rateError } = await admin.rpc("kuro_username_auth_rate_limit", { p_key_hash: await sha256(ip), p_limit: 8, p_window_seconds: 600 });
      if (rateError) throw rateError;
      if (Number(attempts) > 8) return reply({ error: "試行回数が多すぎます。10分ほど待ってから再度お試しください。" }, 429, origin);
      const escaped = escapeLike(username);
      const { data: existing, error: lookupError } = await admin.from("profiles").select("id").ilike("username", escaped).maybeSingle();
      if (lookupError) throw lookupError;
      if (existing && existing.id !== verified.user.id) return reply({ error: "このユーザーネームは既に使用されています。" }, 409, origin);
      const { data: updated, error: updateError } = await admin.from("profiles").update({ username }).eq("id", verified.user.id).select("id,username").maybeSingle();
      if (updateError) {
        if (/unique|duplicate/i.test(updateError.message || "")) return reply({ error: "このユーザーネームは既に使用されています。" }, 409, origin);
        throw updateError;
      }
      if (!updated) return reply({ error: "プロフィールを更新できませんでした。" }, 500, origin);
      const metaUpdate = await admin.auth.admin.updateUserById(verified.user.id, { user_metadata: { username } });
      if (metaUpdate.error) console.warn("username metadata sync failed", metaUpdate.error.message);
      return reply({ success: true, username: updated.username }, 200, origin);
    }
    if (action !== "register" && action !== "login") return reply({ error: "不正なリクエストです。" }, 400, origin);
    if (!usernamePattern.test(username)) return reply({ error: "ユーザーネームは半角英数字と_の3〜24文字で入力してください。" }, 400, origin);
    if (password.length < 8 || password.length > 72) return reply({ error: "パスワードは8〜72文字で入力してください。" }, 400, origin);

    const ip = req.headers.get("cf-connecting-ip")
      || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || "unknown";

    const admin = createClient(url, service, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: attempts, error: rateError } = await admin.rpc(
      "kuro_username_auth_rate_limit",
      { p_key_hash: await sha256(ip), p_limit: 8, p_window_seconds: 600 },
    );
    if (rateError) throw rateError;
    if (Number(attempts) > 8) {
      return reply({
        error: "試行回数が多すぎます。10分ほど待ってから再度お試しください。",
      }, 429, origin);
    }

    const normalized = username.toLowerCase();
    const escapedUsername = escapeLike(username);
    let authEmail: string;

    if (action === "register") {
      const { data: existingProfile, error: lookupError } = await admin
        .from("profiles")
        .select("id")
        .ilike("username", escapedUsername)
        .maybeSingle();

      if (lookupError) throw lookupError;
      if (existingProfile) {
        return reply({ error: "このユーザーネームは既に使用されています。" }, 409, origin);
      }

      // Username-only KURO accounts use a synthetic, private Auth email.
      // The visible identity stays in public.profiles (username + kuro_id).
      authEmail = normalized + "@username.kurolab.invalid";
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: authEmail,
        password,
        email_confirm: true,
        user_metadata: {
          username,
          handle: username,
          kuro_username_login: true,
          kuro_password_configured: true,
        },
      });

      if (createError || !created.user) {
        const detail = String(createError?.message || "");
        if (/already|registered|duplicate|unique|database error saving new user/i.test(detail)) {
          return reply({ error: "このユーザーネームは既に使用されているか、登録できない状態です。" }, 409, origin);
        }
        return reply({ error: "アカウントを作成できませんでした。入力内容を確認してください。" }, 400, origin);
      }

      // The auth.users trigger creates the shared profile. Verify it exists
      // rather than creating a parallel username registry.
      const { data: createdProfile, error: createdProfileError } = await admin
        .from("profiles")
        .select("id, username")
        .eq("id", created.user.id)
        .maybeSingle();

      if (createdProfileError) throw createdProfileError;
      if (!createdProfile || createdProfile.username.toLowerCase() !== normalized) {
        await admin.auth.admin.deleteUser(created.user.id);
        return reply({ error: "共通プロフィールを作成できませんでした。時間をおいて再度お試しください。" }, 500, origin);
      }
    } else {
      // public.profiles is the only canonical username registry. This also
      // makes all existing email and username accounts log in consistently.
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("id, username")
        .ilike("username", escapedUsername)
        .maybeSingle();

      if (profileError) throw profileError;
      if (!profile) return reply({ error: genericLoginError }, 401, origin);

      const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(profile.id);
      if (authUserError || !authUser.user?.email) {
        return reply({ error: genericLoginError }, 401, origin);
      }
      authEmail = authUser.user.email;
    }

    const client = createClient(url, anon, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.auth.signInWithPassword({
      email: authEmail,
      password,
    });

    if (error || !data.session) {
      return reply({
        error: action === "login"
          ? genericLoginError
          : "アカウントは作成されましたが、ログインできませんでした。ログイン画面から再度お試しください。",
      }, 401, origin);
    }

    return reply({ session: data.session, user: data.user }, 200, origin);
  } catch (error) {
    console.error("username-auth error", error);
    return reply({
      error: "認証処理でエラーが発生しました。時間をおいて再度お試しください。",
    }, 500, origin);
  }
});
