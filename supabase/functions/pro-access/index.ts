import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const FEATURES = {
  workspace_plus: true,
  pro_tools: true,
  customization_plus: true,
  early_access: true,
  desktop: true,
  theme_studio: true,
  developer_mode: true,
  analytics: "advanced",
  ai: true,
  ad_free: true
};

function response(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin"
    }
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return response({ ok: true }, 200, origin);
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405, origin);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return response({ error: "Service is not configured" }, 500, origin);

  try {
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!token) return response({ error: "Authentication required" }, 401, origin);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user || authData.user.is_anonymous) {
      return response({ error: "Authentication required" }, 401, origin);
    }

    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "";
    if (action !== "get_status") {
      return response({
        error: "KURO Lab no longer uses membership tiers. All users have the same feature access.",
        code: "plan_tiers_retired"
      }, 410, origin);
    }

    return response({
      membership: {
        user_id: authData.user.id,
        status: "active",
        source: "unified_access",
        starts_at: authData.user.created_at || null,
        expires_at: null,
        plan: "all",
        features: FEATURES,
        approved_at: authData.user.created_at || null,
        updated_at: new Date().toISOString()
      },
      latest_application: null,
      applications: [],
      invitations: [],
      can_apply: false
    }, 200, origin);
  } catch (error) {
    console.error("unified access status failed", error);
    return response({ error: "KURO Lab access status could not be confirmed" }, 500, origin);
  }
});
