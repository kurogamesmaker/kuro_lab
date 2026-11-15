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

function safeError(error: unknown) {
  return String((error as { message?: string })?.message || error || "Unknown error").slice(0, 240);
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



    if (action === "get_usage_analytics") {
      const now = new Date();
      const since32 = new Date(now.getTime() - 32 * 86400000).toISOString();
      const since30 = new Date(now.getTime() - 30 * 86400000).toISOString();
      const since7 = new Date(now.getTime() - 7 * 86400000).toISOString();
      const since24 = new Date(now.getTime() - 24 * 3600000).toISOString();
      const maxRows = 20000;

      const { data: events, error: eventsError } = await admin
        .from("usage_events")
        .select("user_id,event_name,created_at,widget_key,service_key,status_code,error_code")
        .gte("created_at", since32)
        .order("created_at", { ascending: false })
        .limit(maxRows);
      if (eventsError) throw eventsError;

      const rows = events || [];
      const truncated = rows.length >= maxRows;
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
      const dauUsers = new Set(pageViews30.filter((e) => tokyoKey(e.created_at) === todayKey).map((e) => e.user_id));
      const mauUsers = new Set(pageViews30.map((e) => e.user_id));

      const dailyMap = new Map<string, Set<string>>();
      for (let i = 29; i >= 0; i--) {
        const key = tokyoKey(new Date(now.getTime() - i * 86400000));
        if (!dailyMap.has(key)) dailyMap.set(key, new Set());
      }
      pageViews30.forEach((e) => {
        const key = tokyoKey(e.created_at);
        if (dailyMap.has(key)) dailyMap.get(key)!.add(e.user_id);
      });
      const daily = Array.from(dailyMap.entries()).map(([date, users]) => ({
        date,
        active_users: users.size
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

      const pageMap = new Map<string, Set<string>>();
      pageViews30.forEach((e) => {
        const key = "portal";
        if (!pageMap.has(key)) pageMap.set(key, new Set());
        pageMap.get(key)!.add(e.user_id);
      });

      return reply({
        generated_at: now.toISOString(),
        tracking_started_at: retention.tracking_started_at,
        dau: dauUsers.size,
        mau: mauUsers.size,
        dau_mau_rate: mauUsers.size ? Math.round(dauUsers.size / mauUsers.size * 1000) / 10 : 0,
        page_views_30d: pageViews30.length,
        sessions_30d: rows30.filter((e) => e.event_name === "session_start").length,
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
      const { data: messages, error } = await admin.from("admin_messages")
        .select("id,title,body,href,audience,recipient_id,published,created_at")
        .order("created_at", { ascending: false }).limit(limit);
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
      const { data: saved, error } = await admin.from("admin_messages").insert({
        title, body: content, href: href || null, audience,
        recipient_id: recipientId, created_by: caller.id, published: true
      }).select("id,title,audience,recipient_id,created_at").single();
      if (error) throw error;
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: "admin_message.send",
        target_user_id: recipientId,
        metadata: { message_id: saved.id, title, audience }
      });
      if (auditError) throw auditError;
      return reply({ ok: true, message: saved }, 200, origin);
    }

    if (action === "unpublish_admin_message") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return reply({ error: "Message ID required" }, 400, origin);
      const { data, error } = await admin.from("admin_messages")
        .update({ published: false }).eq("id", id)
        .select("id,title").maybeSingle();
      if (error) throw error;
      if (!data) return reply({ error: "Message not found" }, 404, origin);
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
      const confirmEmail = typeof body.confirmEmail === "string" ? body.confirmEmail.trim().toLowerCase() : "";
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
      const actualEmail = (targetData.user.email || "").trim().toLowerCase();
      if (!actualEmail || !confirmEmail || confirmEmail !== actualEmail) {
        return reply({ error: "Confirmation email does not match" }, 409, origin);
      }
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id, action: "account.delete", target_user_id: targetUserId,
        metadata: { email: targetData.user.email || "", username: String(body.username || "").slice(0, 100) }
      });
      if (auditError) throw auditError;
      const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId);
      if (deleteError) throw deleteError;
      return reply({ ok: true }, 200, origin);
    }

    if (action === "list_users") {
      const page = Math.max(1, Math.min(20, Number(body.page) || 1));
      const perPage = 500;
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;

      const users = data.users || [];
      const ids = users.map((u) => u.id);
      const [profilesResult, prefsResult] = ids.length ? await Promise.all([
        admin.from("profiles").select("id,username,display_name").in("id", ids),
        admin.from("portal_preferences").select("user_id,preferences").in("user_id", ids)
      ]) : [{ data: [], error: null }, { data: [], error: null }];

      if (profilesResult.error) throw profilesResult.error;
      if (prefsResult.error) throw prefsResult.error;

      const profiles = new Map((profilesResult.data || []).map((p) => [p.id, p]));
      const prefs = new Map((prefsResult.data || []).map((p) => [p.user_id, p.preferences || {}]));
      const result = users.filter((u) => !u.is_anonymous).map((u) => {
        const profile = profiles.get(u.id);
        const pref = prefs.get(u.id) || {};
        const workspaces = pref.dashboardWorkspaces;
        const boards = Array.isArray(workspaces)
          ? workspaces.length
          : (workspaces && typeof workspaces === "object" ? Object.keys(workspaces).length : 0);
        const widgets = Array.isArray(pref.dashboardWidgets) ? pref.dashboardWidgets.length : 0;
        const plan = typeof u.app_metadata?.plan === "string" ? u.app_metadata.plan : "unlinked";
        return {
          id: u.id,
          email: u.email || "",
          username: profile?.username || "",
          display_name: profile?.display_name || "",
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at || null,
          banned_until: u.banned_until || null,
          board_count: boards,
          widget_count: widgets,
          plan
        };
      });

      return reply({ users: result, page, perPage, hasMore: users.length === perPage }, 200, origin);
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

    if (action === "send_password_reset") {
      const targetUserId = typeof body.userId === "string" ? body.userId : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
        return reply({ error: "Invalid user ID" }, 400, origin);
      }
      const { data: targetData, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
      if (targetError || !targetData?.user?.email) return reply({ error: "User email not found" }, 404, origin);

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