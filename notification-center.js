/* KURO shared notification badge for KURO GAMES */
(function () {
  "use strict";

  const db = window.kuroGamesDB;
  const badge = document.getElementById("kuroNotificationBadge");
  const button = document.getElementById("kuroNotificationLink");
  if (!db || !badge || !button) return;

  let refreshSequence = 0;
  let timer = null;

  function paint(count) {
    const unread = Math.max(0, Number(count) || 0);
    badge.textContent = unread > 99 ? "99+" : String(unread);
    badge.hidden = unread === 0;
    button.classList.toggle("has-unread", unread > 0);
    button.setAttribute("aria-label", unread ? "未読通知 " + unread + " 件" : "通知");
  }

  async function getEconomyUnreadCount() {
    const sessionResult = await db.auth.getSession();
    if (sessionResult?.error) throw sessionResult.error;
    const token = sessionResult?.data?.session?.access_token;
    if (!token) throw new Error("ログイン状態を確認できません。");
    const response = await fetch("/api/kuro-economy/notifications?unread=1&limit=1", {
      headers: { "Authorization": "Bearer " + token, "Accept": "application/json" }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error || "通知を読み込めませんでした。");
    return { count: Number(result.unread_count || 0), error: null };
  }

  async function refresh() {
    const sequence = ++refreshSequence;
    try {
      const auth = await db.auth.getUser();
      const user = auth.data && auth.data.user;
      if (auth?.error || !user || user.is_anonymous) {
        paint(0);
        return;
      }

      const [messagesResult, socialResult, repliesResult, announcementsResult, preferencesResult] = await Promise.all([
        db.from("admin_messages")
          .select("id,portal_announcement_id")
          .eq("published", true)
          .or("audience.eq.all,recipient_id.eq." + user.id)
          .order("created_at", { ascending: false })
          .limit(200),
        getEconomyUnreadCount(),
        db.from("portal_request_notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .is("read_at", null),
        db.from("portal_announcements")
          .select("id")
          .eq("published", true)
          .order("created_at", { ascending: false })
          .limit(100),
        db.from("portal_preferences")
          .select("preferences")
          .eq("user_id", user.id)
          .maybeSingle()
      ]);

      if (messagesResult?.error) throw messagesResult.error;
      if (socialResult?.error) throw socialResult.error;
      if (repliesResult?.error) throw repliesResult.error;
      if (announcementsResult?.error) throw announcementsResult.error;
      if (preferencesResult?.error) throw preferencesResult.error;

      const messages = messagesResult.data || [];
      const ids = messages.map((row) => row.id).filter(Boolean);
      let unreadAdmin = ids.length;
      if (ids.length) {
        const readsResult = await db.from("admin_message_reads")
          .select("message_id")
          .eq("user_id", user.id)
          .in("message_id", ids);
        if (readsResult?.error) throw readsResult.error;
        const readIds = new Set((readsResult.data || []).map((row) => row.message_id));
        unreadAdmin = ids.filter((id) => !readIds.has(id)).length;
      }

      const mirroredAnnouncementIds = new Set(messages.map((row) => row.portal_announcement_id).filter(Boolean));
      const preferences = preferencesResult.data && preferencesResult.data.preferences || {};
      const readAnnouncements = new Set(Array.isArray(preferences.readAnnouncements) ? preferences.readAnnouncements : []);
      const unreadAnnouncements = (announcementsResult.data || []).filter((row) =>
        !mirroredAnnouncementIds.has(row.id) && !readAnnouncements.has(row.id)
      ).length;

      if (sequence !== refreshSequence) return;
      paint(unreadAdmin + unreadAnnouncements + Number(socialResult.count || 0) + Number(repliesResult.count || 0));
    } catch (error) {
      console.warn("[KURO notifications] unread count could not be refreshed:", error);
    }
  }

  db.auth.onAuthStateChange((_event, session) => {
    refreshSequence++;
    if (!session || !session.user || session.user.is_anonymous) paint(0);
    else refresh();
  });

  db.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    if (!data.session || !data.session.user || data.session.user.is_anonymous) paint(0);
    else refresh();
  }).catch((error) => {
    console.warn("[KURO notifications] session restore failed:", error);
    paint(0);
  });

  timer = window.setInterval(() => {
    if (document.visibilityState !== "hidden") refresh();
  }, 30000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
  window.addEventListener("focus", refresh);
})();
