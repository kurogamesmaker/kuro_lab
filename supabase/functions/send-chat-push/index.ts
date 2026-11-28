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

const CHAT_D1_ENDPOINT = "https://kurolab.cc.cd/api/kuro-d1/chat";

async function chatD1Query(auth: string, body: Record<string, unknown>) {
  const response = await fetch(CHAT_D1_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": auth,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({ ...body, operation: "select", limit: body.limit || 200 })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.error) {
    throw new Error(payload?.error?.message || "Cloudflare D1 chat lookup failed (" + response.status + ")");
  }
  return payload.data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");

  const missing = [
    !url && "SUPABASE_URL",
    !anon && "SUPABASE_ANON_KEY",
    !service && "SUPABASE_SERVICE_ROLE_KEY",
    !pub && "VAPID_PUBLIC_KEY",
    !priv && "VAPID_PRIVATE_KEY",
    !subject && "VAPID_SUBJECT"
  ].filter(Boolean);
  if (missing.length) return json({ error: "Push configuration missing", missing }, 503);

  try {
    const auth = req.headers.get("Authorization");
    if (!auth || !/^Bearer\s+\S+/i.test(auth)) return json({ error: "Missing authorization" }, 401);

    // JWT verification is performed here so OPTIONS preflight can pass the gateway.
    const client = createClient(url!, anon!, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: authErr } = await client.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

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

    const admin = createClient(url!, service!);
    let recipientIds: string[] = [], title = "KURO", message = "", tag = "kuro-notification";

    if (body.type === "test") {
      if (typeof body.publicKey !== "string" || body.publicKey !== pub) {
        return json({ error: "VAPID public key mismatch", publicKeyMatches: false }, 409);
      }
      recipientIds = [user.id];
      message = "KUROのプッシュ通知テストだよ";
      tag = "kuro-push-test-" + Date.now();
    } else if (typeof body.groupMessageId === "string" && body.groupMessageId) {
      const m = await chatD1Query(auth, {
        table: "group_chat_messages",
        columns: "id,group_id,sender_id,content",
        filters: [{ column: "id", op: "eq", value: body.groupMessageId }],
        cardinality: "maybeSingle",
        limit: 1
      });
      if (!m || m.sender_id !== user.id) return json({ error: "Group message not found or not sent by current user" }, 403);

      const members = await chatD1Query(auth, {
        table: "group_chat_members",
        columns: "user_id",
        filters: [{ column: "group_id", op: "eq", value: m.group_id }],
        limit: 200
      });
      if (!members?.some((member) => member.user_id === user.id)) {
        return json({ error: "Group membership verification failed" }, 403);
      }

      recipientIds = [...new Set((members || []).map((member) => member.user_id).filter((id) => id !== user.id))];
      if (!recipientIds.length) return json({ sent: 0, registered: 0, error: "No other group members" }, 409);

      const group = await chatD1Query(auth, {
        table: "group_conversations",
        columns: "name",
        filters: [{ column: "id", op: "eq", value: m.group_id }],
        cardinality: "maybeSingle",
        limit: 1
      });
      title = group?.name ? String(group.name).slice(0, 80) : "KURO グループチャット";
      message = String(m.content || "新しいグループメッセージが届いたよ").slice(0, 160);
      tag = "kuro-group-" + m.group_id;
    } else if (typeof body.messageId === "string" && body.messageId) {
      const m = await chatD1Query(auth, {
        table: "chat_messages",
        columns: "id,conversation_id,sender_id,content",
        filters: [{ column: "id", op: "eq", value: body.messageId }],
        cardinality: "maybeSingle",
        limit: 1
      });
      if (!m || m.sender_id !== user.id) return json({ error: "Message not found or not sent by current user" }, 403);
      const c = await chatD1Query(auth, {
        table: "chat_conversations",
        columns: "user_a,user_b",
        filters: [{ column: "id", op: "eq", value: m.conversation_id }],
        cardinality: "maybeSingle",
        limit: 1
      });
      if (!c || ![c.user_a, c.user_b].includes(user.id)) return json({ error: "Conversation access denied" }, 403);
      recipientIds = [c.user_a === user.id ? c.user_b : c.user_a];
      message = String(m.content || "新しいメッセージが届いたよ").slice(0, 160);
      tag = "kuro-message-" + m.conversation_id;
    } else {
      const target = typeof body.targetUserId === "string" ? body.targetUserId : "";
      const type = body.type === "like" ? "like" : body.type === "follow" ? "follow" : "";
      if (!target || !type || target === user.id) return json({ error: "Invalid notification" }, 400);
      if (type === "follow") {
        const { data } = await admin.from("follows").select("follower_id")
          .eq("follower_id", user.id).eq("following_id", target).maybeSingle();
        if (!data) return json({ error: "Follow action not found" }, 403);
        message = "あなたをフォローしました";
      } else {
        const postId = typeof body.postId === "string" ? body.postId : "";
        const { data: post } = await admin.from("posts").select("id,user_id").eq("id", postId).maybeSingle();
        if (!post || post.user_id !== target) return json({ error: "Post recipient mismatch" }, 403);
        const { data: like } = await admin.from("post_likes").select("post_id")
          .eq("post_id", postId).eq("user_id", user.id).maybeSingle();
        if (!like) return json({ error: "Like action not found" }, 403);
        message = "あなたの投稿にいいねしました";
      }
      recipientIds = [target];
      tag = "kuro-" + type + "-" + user.id;
    }

    const { data: subs, error: subErr } = await admin.from("push_subscriptions")
      .select("id,subscription").in("user_id", recipientIds);
    if (subErr) throw subErr;
    if (!subs?.length) return json({
      sent: 0,
      registered: 0,
      skipped: "No push subscription for recipient",
      hint: "Enable notifications from the installed home-screen app."
    }, 200);

    webpush.setVapidDetails(subject!, pub!, priv!);
    const results = await Promise.all(subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          sub.subscription as webpush.PushSubscription,
          JSON.stringify({ title, body: message, url: "/sns/v2/mobile/", tag })
        );
        return { ok: true };
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("id", sub.id);
        const failureMessage = String((e as Error)?.message || "push failed").slice(0, 180);
        console.warn("Web Push delivery failed", { statusCode: code, message: failureMessage });
        return {
          ok: false, statusCode: code,
          message: failureMessage
        };
      }
    }));

    const sent = results.filter(x => x.ok).length;
    const failures = results.filter(x => !x.ok).map(x => ({ statusCode: x.statusCode, message: x.message }));
    return json({
      sent,
      registered: results.length,
      failures,
      ok: sent > 0
    }, sent === 0 && results.length > 0 ? 502 : 200);
  } catch (e) {
    console.error("send-chat-push error", e);
    return json({
      error: "Internal push notification error",
      detail: String((e as Error)?.message || e).slice(0, 200)
    }, 500);
  }
});