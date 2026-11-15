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
      const maxRows = 100000;
      const pageSize = 1000;
      const rows: Array<{ user_id: string; event_name: string; created_at: string; widget_key: string | null; service_key: string | null; status_code: number | null; error_code: string | null }> = [];
      let eventTotal: number | null = null;
      let truncated = false;
      for (let offset = 0; offset < maxRows; offset += pageSize) {
        const selectOptions = offset === 0 ? { count: "exact" as const } : {};
        const { data: eventPage, error: eventsError, count } = await admin
          .from("usage_events")
          .select("user_id,event_name,created_at,widget_key,service_key,status_code,error_code", selectOptions)
          .gte("created_at", since32)
          .order("created_at", { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (eventsError) throw eventsError;
        if (offset === 0 && Number.isFinite(count)) eventTotal = count;
        const batch = eventPage || [];
        rows.push(...batch);
        if (batch.length < pageSize) break;
        if (offset + pageSize >= maxRows) truncated = eventTotal === null || eventTotal > rows.length;
      }
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
      let query = admin.from("admin_messages")
        .select("id,title,body,href,audience,recipient_id,published,created_at,service_scope,portal_announcement_id")
        .order("created_at", { ascending: false }).limit(limit);
      const requestedScope = typeof body.serviceScope === "string" ? body.serviceScope : "";
      if (requestedScope === "sns") query = query.in("service_scope", ["sns", "both"]);
      else if (requestedScope === "lab") query = query.in("service_scope", ["lab", "both"]);
      else if (requestedScope === "both") query = query.eq("service_scope", "both");
      const { data: messages, error } = await query;
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
      const serviceScope = ["lab","sns","both"].includes(body.serviceScope) ? body.serviceScope : "both";
      if (body.audience === "user" && serviceScope !== "sns") return reply({ error: "Individual recipients are currently supported for KURO SNS only" }, 400, origin);
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
      let portalAnnouncementId: string | null = null;
      if ((serviceScope === "lab" || serviceScope === "both") && audience === "all") {
        const { data: portalAnnouncement, error: portalError } = await admin.from("portal_announcements").insert({
          title, body: content, href: href || null, published: true,
          starts_at: new Date().toISOString(), ends_at: null
        }).select("id").single();
        if (portalError) throw portalError;
        portalAnnouncementId = portalAnnouncement.id;
      }
      const { data: saved, error } = await admin.from("admin_messages").insert({
        title, body: content, href: href || null, audience, service_scope: serviceScope,
        portal_announcement_id: portalAnnouncementId,
        recipient_id: recipientId, created_by: caller.id, published: true
      }).select("id,title,audience,recipient_id,created_at,service_scope,portal_announcement_id").single();
      if (error) {
        if (portalAnnouncementId) await admin.from("portal_announcements").delete().eq("id", portalAnnouncementId);
        throw error;
      }
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id,
        action: "admin_message.send",
        target_user_id: recipientId,
        metadata: { message_id: saved.id, title, audience, service_scope: serviceScope }
      });
      if (auditError) throw auditError;
      return reply({ ok: true, message: saved }, 200, origin);
    }

    if (action === "unpublish_admin_message") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return reply({ error: "Message ID required" }, 400, origin);
      const { data, error } = await admin.from("admin_messages")
        .update({ published: false }).eq("id", id)
        .select("id,title,portal_announcement_id").maybeSingle();
      if (error) throw error;
      if (!data) return reply({ error: "Message not found" }, 404, origin);
      if (data.portal_announcement_id) {
        const { error: portalError } = await admin.from("portal_announcements")
          .update({ published: false, ends_at: new Date().toISOString() })
          .eq("id", data.portal_announcement_id);
        if (portalError) throw portalError;
      }
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


    if (action === "list_pro_management") {
      const [appsResult, membersResult, invitesResult, controlsResult] = await Promise.all([
        admin.from("pro_applications").select("id,user_id,reason,status,admin_note,reviewed_by,reviewed_at,created_at").order("created_at",{ascending:false}).limit(300),
        admin.from("pro_memberships").select("user_id,status,source,starts_at,expires_at,features,approved_by,approved_at,updated_at").order("updated_at",{ascending:false}).limit(500),
        admin.from("pro_invitations").select("id,invited_user_id,status,expires_at,membership_expires_at,created_at,accepted_at,created_by").order("created_at",{ascending:false}).limit(300),
        admin.from("pro_user_controls").select("user_id,reapply_allowed,reapply_after,admin_note,updated_at").limit(500)
      ]);
      for (const r of [appsResult,membersResult,invitesResult,controlsResult]) if(r.error) throw r.error;
      const ids=[...new Set([...(appsResult.data||[]).map(x=>x.user_id),...(membersResult.data||[]).map(x=>x.user_id),...(invitesResult.data||[]).map(x=>x.invited_user_id),...(controlsResult.data||[]).map(x=>x.user_id)])];
      const profileResult=ids.length?await admin.from("profiles").select("id,username,display_name").in("id",ids):{data:[],error:null};
      if(profileResult.error) throw profileResult.error;
      const profileMap=new Map((profileResult.data||[]).map(x=>[x.id,x]));
      const emails=new Map<string,string>();
      for(const id of ids){
        const u=await admin.auth.admin.getUserById(id);
        if(u.data?.user?.email) emails.set(id,u.data.user.email);
      }
      const decorate=(x:any,id:string)=>({...x,email:emails.get(id)||"",profile:profileMap.get(id)||null});
      return reply({
        applications:(appsResult.data||[]).map(x=>decorate(x,x.user_id)),
        memberships:(membersResult.data||[]).map(x=>decorate(x,x.user_id)),
        invitations:(invitesResult.data||[]).map(x=>decorate(x,x.invited_user_id)),
        controls:(controlsResult.data||[]).map(x=>decorate(x,x.user_id))
      },200,origin);
    }

    if (action === "review_pro_application") {
      const applicationId=typeof body.applicationId==="string"?body.applicationId:"";
      const approve=body.approve===true;
      const adminNote=typeof body.adminNote==="string"?body.adminNote.trim().slice(0,1000):"";
      const expiresAt=body.expiresAt?new Date(body.expiresAt):null;
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId)) return reply({error:"Invalid application ID"},400,origin);
      if(body.expiresAt && (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime()<=Date.now())) return reply({error:"有効期限は未来の日時にしてください。"},400,origin);
      const {data:application,error:appError}=await admin.from("pro_applications").select("id,user_id,status").eq("id",applicationId).maybeSingle();
      if(appError) throw appError;
      if(!application) return reply({error:"Application not found"},404,origin);
      if(application.status!=="pending") return reply({error:"この申請はすでに審査済みです。"},409,origin);
      const {data:protectedAdmin,error:protectedError}=await admin.from("admin_users").select("user_id").eq("user_id",application.user_id).maybeSingle();
      if(protectedError) throw protectedError;
      if(protectedAdmin) return reply({error:"Administrator accounts are not eligible for Pro membership"},409,origin);
      const now=new Date().toISOString();
      if(approve){
        const {error:memberError}=await admin.from("pro_memberships").upsert({
          user_id:application.user_id,status:"active",source:"application",starts_at:now,
          expires_at:expiresAt?expiresAt.toISOString():null,
          features:{workspace_plus:true,pro_tools:true,customization_plus:true,early_access:true},
          approved_by:caller.id,approved_at:now,updated_at:now
        },{onConflict:"user_id"});
        if(memberError) throw memberError;
      }
      const {data:updated,error:updateError}=await admin.from("pro_applications").update({
        status:approve?"approved":"rejected",admin_note:adminNote||null,reviewed_by:caller.id,reviewed_at:now,updated_at:now
      }).eq("id",applicationId).eq("status","pending").select("id,user_id,status").maybeSingle();
      if(updateError) throw updateError;
      if(!updated) return reply({error:"申請状態が更新されました。再読み込みしてください。"},409,origin);
      const allow=body.reapplyAllowed!==false;
      const reapplyAfter=body.reapplyAfter?new Date(body.reapplyAfter):null;
      if(!approve && body.reapplyAfter && (!reapplyAfter || Number.isNaN(reapplyAfter.getTime()))) return reply({error:"Invalid reapply date"},400,origin);
      if(!approve){
        const {error:controlError}=await admin.from("pro_user_controls").upsert({
          user_id:application.user_id,reapply_allowed:allow,reapply_after:reapplyAfter?reapplyAfter.toISOString():null,
          admin_note:adminNote||null,updated_by:caller.id,updated_at:now
        },{onConflict:"user_id"});
        if(controlError) throw controlError;
      }
      const {error:auditError}=await admin.from("admin_audit_logs").insert({
        actor_user_id:caller.id,action:approve?"pro.application.approve":"pro.application.reject",
        target_user_id:application.user_id,metadata:{application_id:applicationId,expires_at:approve?(expiresAt?expiresAt.toISOString():null):null,reapply_allowed:approve?null:body.reapplyAllowed!==false}
      });
      if(auditError) throw auditError;
      return reply({ok:true,application:updated},200,origin);
    }

    if (action === "create_pro_invitation") {
      const targetUserId=typeof body.userId==="string"?body.userId:"";
      const inviteExpiry=body.inviteExpiresAt?new Date(body.inviteExpiresAt):null;
      const membershipExpiry=body.membershipExpiresAt?new Date(body.membershipExpiresAt):null;
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) return reply({error:"Invalid user ID"},400,origin);
      if(!inviteExpiry||Number.isNaN(inviteExpiry.getTime())||inviteExpiry.getTime()<=Date.now()) return reply({error:"招待の有効期限を未来に設定してください。"},400,origin);
      if(body.membershipExpiresAt && (!membershipExpiry||Number.isNaN(membershipExpiry.getTime())||membershipExpiry.getTime()<=Date.now())) return reply({error:"Pro利用期限を未来に設定してください。"},400,origin);
      if(targetUserId===caller.id) return reply({error:"管理者自身への招待はできません。"},409,origin);
      const {data:target,error:targetError}=await admin.auth.admin.getUserById(targetUserId);
      if(targetError||!target?.user||target.user.is_anonymous) return reply({error:"User not found"},404,origin);
      const {data:protectedAdmin,error:protectedError}=await admin.from("admin_users").select("user_id").eq("user_id",targetUserId).maybeSingle();
      if(protectedError) throw protectedError;
      if(protectedAdmin) return reply({error:"Administrator accounts are not eligible for Pro membership"},409,origin);
      const {data:existing,error:existingError}=await admin.from("pro_memberships").select("status,expires_at").eq("user_id",targetUserId).maybeSingle();
      if(existingError) throw existingError;
      if(existing?.status==="active" && (!existing.expires_at||new Date(existing.expires_at).getTime()>Date.now())) return reply({error:"この利用者はすでにProです。"},409,origin);
      const {data:invite,error}=await admin.from("pro_invitations").insert({
        invited_user_id:targetUserId,status:"pending",expires_at:inviteExpiry.toISOString(),
        membership_expires_at:membershipExpiry?membershipExpiry.toISOString():null,created_by:caller.id
      }).select("id,invited_user_id,status,expires_at,membership_expires_at,created_at").single();
      if(error) throw error;
      const {error:auditError}=await admin.from("admin_audit_logs").insert({
        actor_user_id:caller.id,action:"pro.invitation.create",target_user_id:targetUserId,
        metadata:{invitation_id:invite.id,invite_expires_at:invite.expires_at,membership_expires_at:invite.membership_expires_at}
      });
      if(auditError) throw auditError;
      return reply({ok:true,invitation:invite},200,origin);
    }

    if (action === "update_pro_invitation") {
      const invitationId=typeof body.invitationId==="string"?body.invitationId:"";
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invitationId)) return reply({error:"Invalid invitation ID"},400,origin);
      const {data,error}=await admin.from("pro_invitations").update({status:"revoked"}).eq("id",invitationId).eq("status","pending").select("id,invited_user_id").maybeSingle();
      if(error) throw error;
      if(!data) return reply({error:"招待が見つからないか、すでに処理済みです。"},409,origin);
      const {error:auditError}=await admin.from("admin_audit_logs").insert({actor_user_id:caller.id,action:"pro.invitation.revoke",target_user_id:data.invited_user_id,metadata:{invitation_id:invitationId}});
      if(auditError) throw auditError;
      return reply({ok:true},200,origin);
    }

    if (action === "update_pro_membership") {
      const targetUserId=typeof body.userId==="string"?body.userId:"";
      const operation=String(body.operation||"");
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) return reply({error:"Invalid user ID"},400,origin);
      if(targetUserId===caller.id) return reply({error:"自分自身の管理者Pro権限は変更できません。"},409,origin);
      const {data:protectedAdmin,error:protectedError}=await admin.from("admin_users").select("user_id").eq("user_id",targetUserId).maybeSingle();
      if(protectedError) throw protectedError;
      if(protectedAdmin) return reply({error:"Administrator accounts are protected"},409,origin);
      const {data:current,error:currentError}=await admin.from("pro_memberships").select("status,expires_at").eq("user_id",targetUserId).maybeSingle();
      if(currentError) throw currentError;
      if(!current) return reply({error:"Pro membership not found"},404,origin);
      const now=new Date().toISOString();
      let patch:any={updated_at:now};
      if(operation==="suspend") patch.status="suspended";
      else if(operation==="resume") {
        if(current.expires_at&&new Date(current.expires_at).getTime()<=Date.now()) return reply({error:"期限切れのProは期限を更新してから再開してください。"},409,origin);
        patch.status="active";
      } else if(operation==="revoke") patch.status="revoked";
      else if(operation==="set_expiry") {
        const expiry=body.expiresAt?new Date(body.expiresAt):null;
        if(body.expiresAt && (!expiry||Number.isNaN(expiry.getTime())||expiry.getTime()<=Date.now())) return reply({error:"期限は未来の日時にしてください。"},400,origin);
        patch.expires_at=expiry?expiry.toISOString():null;
        if(current.status==="expired" && !expiry) patch.status="active";
        else if(current.status==="expired" && expiry) patch.status="active";
      } else return reply({error:"Invalid membership operation"},400,origin);
      const {data:updated,error:updateError}=await admin.from("pro_memberships").update(patch).eq("user_id",targetUserId).select("user_id,status,source,expires_at,features,updated_at").single();
      if(updateError) throw updateError;
      const {error:auditError}=await admin.from("admin_audit_logs").insert({actor_user_id:caller.id,action:"pro.membership."+operation,target_user_id:targetUserId,metadata:patch});
      if(auditError) throw auditError;
      return reply({ok:true,membership:updated},200,origin);
    }

    if (action === "set_pro_user_control") {
      const targetUserId=typeof body.userId==="string"?body.userId:"";
      const allowed=body.reapplyAllowed!==false;
      const reapplyAfter=body.reapplyAfter?new Date(body.reapplyAfter):null;
      const note=typeof body.adminNote==="string"?body.adminNote.trim().slice(0,1000):"";
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) return reply({error:"Invalid user ID"},400,origin);
      if(body.reapplyAfter && (!reapplyAfter||Number.isNaN(reapplyAfter.getTime()))) return reply({error:"Invalid reapply date"},400,origin);
      const {error}=await admin.from("pro_user_controls").upsert({user_id:targetUserId,reapply_allowed:allowed,reapply_after:reapplyAfter?reapplyAfter.toISOString():null,admin_note:note||null,updated_by:caller.id,updated_at:new Date().toISOString()},{onConflict:"user_id"});
      if(error) throw error;
      const {error:auditError}=await admin.from("admin_audit_logs").insert({actor_user_id:caller.id,action:"pro.reapply_control",target_user_id:targetUserId,metadata:{reapply_allowed:allowed,reapply_after:reapplyAfter?reapplyAfter.toISOString():null}});
      if(auditError) throw auditError;
      return reply({ok:true},200,origin);
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

    if (action === "update_user_email") {
      const targetUserId = typeof body.userId === "string" ? body.userId : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) return reply({ error: "Invalid user ID" }, 400, origin);
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || email.length > 254) return reply({ error: "Invalid email address" }, 400, origin);
      if (targetUserId === caller.id) return reply({ error: "Change your own administrator email through account settings" }, 409, origin);
      const { data: protectedAdmin, error: protectedError } = await admin.from("admin_users").select("user_id").eq("user_id", targetUserId).maybeSingle();
      if (protectedError) throw protectedError;
      if (protectedAdmin) return reply({ error: "Administrator email changes are protected" }, 409, origin);
      const { data: targetData, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
      if (targetError || !targetData?.user) return reply({ error: "User not found" }, 404, origin);
      const previousEmail = targetData.user.email || "";
      const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(targetUserId, { email });
      if (updateError) throw updateError;
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id, action: "account.email_update", target_user_id: targetUserId,
        metadata: { previous_email: previousEmail, new_email: email }
      });
      if (auditError) throw auditError;
      return reply({ ok: true, email: updated.user?.email || email }, 200, origin);
    }

    if (action === "set_user_plan") {
      const targetUserId = typeof body.userId === "string" ? body.userId : "";
      const plan = body.plan === "pro" ? "pro" : body.plan === "free" ? "free" : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) return reply({ error: "Invalid user ID" }, 400, origin);
      if (!plan) return reply({ error: "Plan must be pro or free" }, 400, origin);
      if (targetUserId === caller.id) return reply({ error: "You cannot change your own administrator plan" }, 409, origin);
      const { data: protectedAdmin, error: protectedError } = await admin.from("admin_users").select("user_id").eq("user_id", targetUserId).maybeSingle();
      if (protectedError) throw protectedError;
      if (protectedAdmin) return reply({ error: "Administrator plans are protected" }, 409, origin);
      const { data: targetData, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
      if (targetError || !targetData?.user) return reply({ error: "User not found" }, 404, origin);
      const currentMetadata = targetData.user.app_metadata || {};
      const nextMetadata = { ...currentMetadata };
      if (plan === "pro") nextMetadata.plan = "pro";
      else delete nextMetadata.plan;
      const { error: updateError } = await admin.auth.admin.updateUserById(targetUserId, { app_metadata: nextMetadata });
      if (updateError) throw updateError;
      const { error: auditError } = await admin.from("admin_audit_logs").insert({
        actor_user_id: caller.id, action: "account.plan_update", target_user_id: targetUserId,
        metadata: { previous_plan: currentMetadata.plan || "free", new_plan: plan, manual_override: true }
      });
      if (auditError) throw auditError;
      return reply({ ok: true, plan }, 200, origin);
    }

    if (action === "list_users") {
      const page = Math.max(1, Math.min(200, Number(body.page) || 1));
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

      return reply({ users: result, page, perPage, total: Number(data.total) || null, hasMore: users.length === perPage }, 200, origin);
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