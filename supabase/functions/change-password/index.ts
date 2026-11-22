import { createClient } from "npm:@supabase/supabase-js@2";
const origins = new Set(["https://kurolab.cc.cd", "https://www.kurolab.cc.cd"]);
function cors(origin: string | null) {
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
  if (origin && origins.has(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
function reply(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: cors(origin) });
}
function decodeClaims(token: string): Record<string, unknown> {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
  } catch { return {}; }
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405, origin);
  if (origin && !origins.has(origin)) return reply({ error: "Origin not allowed" }, 403, origin);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply({ error: "認証サーバーの設定が不足しています。" }, 503, origin);
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
  if (!token) return reply({ error: "ログインしてください。" }, 401, origin);
  try {
    const body = await req.json();
    const next = String(body.newPassword || "");
    if (next.length < 8 || next.length > 72) return reply({ error: "新しいパスワードは8〜72文字で入力してください。" }, 400, origin);
    if (next !== String(body.confirmPassword || "")) return reply({ error: "確認用パスワードが一致しません。" }, 400, origin);
    const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await admin.auth.getUser(token);
    const user = data.user;
    if (error || !user || user.is_anonymous) return reply({ error: "ログイン状態を確認できません。" }, 401, origin);
    const providers = Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers : [];
    const passwordConfigured = providers.includes("email");
    if (passwordConfigured) {
      const current = String(body.currentPassword || "");
      if (!current || !user.email) return reply({ error: "現在のパスワードを入力してください。" }, 400, origin);
      const verifier = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
      const check = await verifier.auth.signInWithPassword({ email: user.email, password: current });
      await verifier.auth.signOut({ scope: "local" }).catch(() => undefined);
      if (check.error) return reply({ error: "現在のパスワードが正しくありません。" }, 401, origin);
    } else {
      const age = Math.floor(Date.now() / 1000) - Number(decodeClaims(token).auth_time || 0);
      if (age < 0 || age > 900) return reply({ error: "再ログインしてからお試しください。" }, 401, origin);
    }
    const metadata = { ...(user.user_metadata || {}), kuro_password_configured: true };
    const update = await fetch(url + "/auth/v1/user", {
      method: "PUT",
      headers: {
        "apikey": anon,
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ password: next, data: metadata })
    });
    const updatedBody = await update.json().catch(() => ({}));
    if (!update.ok) {
      return reply({ error: updatedBody.message || updatedBody.msg || "パスワードを変更できませんでした。" }, update.status, origin);
    }
    try { await admin.auth.admin.signOut(token, "others"); } catch (e) { console.warn("other session revocation warning", e); }
    return reply({ success: true }, 200, origin);
  } catch (e) {
    console.error("change-password error", e);
    return reply({ error: "パスワードを変更できませんでした。時間をおいて再度お試しください。" }, 500, origin);
  }
});