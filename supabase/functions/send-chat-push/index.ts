import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-requested-with, accept, accept-profile, content-profile, range",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });

const PUSH_D1_ENDPOINT = "https://kurolab.cc.cd/api/kuro-d1/push";

async function d1PushRequest(
  auth: string,
  body: Record<string, unknown>
): Promise<{ response: Response; payload: Record<string, unknown> | null }> {
  const response = await fetch(PUSH_D1_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": auth,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  return { response, payload };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");

  const missing = [
    !url && "SUPABASE_URL",
    !anon && "SUPABASE_ANON_KEY",
    !pub && "VAPID_PUBLIC_KEY",
    !priv && "VAPID_PRIVATE_KEY",
    !subject && "VAPID_SUBJECT"
  ].filter(Boolean);
  if (missing.length) return json({ error: "Push configuration missing", missing }, 503);

  try {
    const auth = req.headers.get("Authorization");
    if (!auth || !/^Bearer\\s+\\S+/i.test(auth)) return json({ error: "Missing authorization" }, 401);

    // Confirm the caller's Supabase Auth session before forwarding the same user token to D1.
    const client = createClient(url!, anon!, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: authErr } = await client.auth.getUser();
    if (authErr || !user || user.is_anonymous) return json({ error: "Unauthorized" }, 401);

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ error: "Invalid JSON body" }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (body.type === "test" && (typeof body.publicKey !== "string" || body.publicKey !== pub)) {
      return json({ error: "VAPID public key mismatch", publicKeyMatches: false }, 409);
    }

    const { response: targetResponse, payload: targetPayload } = await d1PushRequest(auth, {
      action: "targets",
      event: body
    });
    if (!targetResponse.ok || !targetPayload || targetPayload.success !== true) {
      const error = targetPayload?.error as Record<string, unknown> | undefined;
      return json({
        error: String(error?.message || "Cloudflare D1 could not resolve push targets"),
        code: String(error?.code || "D1_PUSH_TARGETS_FAILED"),
        upstreamStatus: targetResponse.status
      }, targetResponse.status >= 400 && targetResponse.status < 500 ? targetResponse.status : 502);
    }

    const subscriptions = Array.isArray(targetPayload.subscriptions)
      ? targetPayload.subscriptions.filter((row): row is Record<string, unknown> =>
          !!row && typeof row === "object" && typeof row.id === "string" &&
          !!row.subscription && typeof row.subscription === "object")
      : [];
    if (!subscriptions.length) {
      return json({
        sent: 0,
        registered: 0,
        skipped: "No push subscription for recipient",
        source: "cloudflare-d1",
        hint: "通知を利用する端末で「スマホ通知をオンにする」を実行してください。"
      }, 200);
    }

    const title = String(targetPayload.title || "KURO").slice(0, 80);
    const message = String(targetPayload.message || "新しい通知が届きました").slice(0, 160);
    const tag = String(targetPayload.tag || "kuro-notification").slice(0, 120);

    webpush.setVapidDetails(subject!, pub!, priv!);
    const results = await Promise.all(subscriptions.map(async (row) => {
      try {
        await webpush.sendNotification(
          row.subscription as webpush.PushSubscription,
          JSON.stringify({ title, body: message, url: "/sns/v2/mobile/", tag })
        );
        return { id: String(row.id), ok: true };
      } catch (error) {
        const code = (error as { statusCode?: number })?.statusCode;
        const failureMessage = String((error as Error)?.message || "push failed").slice(0, 180);
        console.warn("Web Push delivery failed", { statusCode: code, message: failureMessage });
        return {
          id: String(row.id),
          ok: false,
          statusCode: code,
          message: failureMessage,
          stale: code === 404 || code === 410
        };
      }
    }));

    const staleIds = results.filter(row => !row.ok && row.stale).map(row => row.id);
    let pruned = 0;
    if (staleIds.length) {
      try {
        const { response: pruneResponse, payload: prunePayload } = await d1PushRequest(auth, {
          action: "prune",
          event: body,
          subscriptionIds: staleIds
        });
        if (pruneResponse.ok && prunePayload?.success === true) {
          pruned = Number(prunePayload.deleted) || 0;
        } else {
          console.warn("Stale D1 push subscriptions could not be removed", {
            status: pruneResponse.status,
            code: (prunePayload?.error as Record<string, unknown> | undefined)?.code || "UNKNOWN"
          });
        }
      } catch (pruneError) {
        console.warn("Stale D1 push subscription cleanup skipped", String((pruneError as Error)?.message || pruneError));
      }
    }

    const sent = results.filter(row => row.ok).length;
    const failures = results.filter(row => !row.ok).map(row => ({
      statusCode: row.statusCode,
      message: row.message
    }));
    return json({
      sent,
      registered: results.length,
      failures,
      pruned,
      source: "cloudflare-d1",
      ok: sent > 0
    }, sent === 0 && results.length > 0 ? 502 : 200);
  } catch (error) {
    console.error("send-chat-push error", error);
    return json({
      error: "Internal push notification error",
      detail: String((error as Error)?.message || error).slice(0, 200)
    }, 500);
  }
});
