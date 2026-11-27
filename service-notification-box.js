/* KURO unified in-service notification box.
   Uses the existing Supabase notification tables; no schema or delivery changes. */
(function () {
  "use strict";
  if (window.KuroNotificationBox && window.KuroNotificationBox.__ready) return;

  const STYLE_ID = "kuro-service-notification-box-style";
  const PANEL_ID = "kuro-service-notification-box";
  const REFRESH_MS = 30000;
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);

  function currentService() {
    const path = location.pathname || "/";
    if (path.startsWith("/games")) return "games";
    if (path.startsWith("/sns")) return "sns";
    return "lab";
  }

  function getDb() {
    return window.kuroGamesDB || window.kuroSNSDB || window.kuroPortalDB || null;
  }

  let db = getDb();
  let user = null;
  let items = [];
  let prefs = {};
  let filter = "all";
  let busy = false;
  let refreshSequence = 0;
  let refreshTimer = null;
  let root = null;
  let panel = null;
  let list = null;
  let status = null;
  let count = null;
  let markAllButton = null;
  const service = currentService();

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .kuro-notification-box-trigger{position:relative}
      .kuro-notification-box-badge{position:absolute!important;top:-6px!important;right:-7px!important;min-width:18px!important;height:18px!important;padding:0 5px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;border:2px solid #fff!important;border-radius:99px!important;background:#e5484d!important;color:#fff!important;font-size:10px!important;font-weight:900!important;line-height:1!important;font-variant-numeric:tabular-nums}
      .kuro-notification-box-badge[hidden]{display:none!important}
      #kuro-service-notification-box{position:fixed;inset:0;z-index:10050}
      #kuro-service-notification-box[hidden]{display:none!important}
      #kuro-service-notification-box .kuro-nb-backdrop{position:absolute;inset:0;background:transparent}
      #kuro-service-notification-box .kuro-nb-panel{position:absolute;top:76px;right:18px;width:min(440px,calc(100vw - 28px));max-height:min(680px,calc(100vh - 96px));display:flex;flex-direction:column;overflow:hidden;border:1px solid #dce4ef;border-radius:18px;background:#fff;color:#1b2a41;box-shadow:0 22px 70px rgba(20,35,60,.22);font-family:Inter,"Noto Sans JP",system-ui,sans-serif}
      #kuro-service-notification-box .kuro-nb-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 17px;border-bottom:1px solid #e8edf4;background:linear-gradient(120deg,#fff,#f7faff)}
      #kuro-service-notification-box .kuro-nb-title{margin:0;font-size:17px;font-weight:950;letter-spacing:-.3px}
      #kuro-service-notification-box .kuro-nb-subtitle{margin:4px 0 0;color:#7b889c;font-size:10px}
      #kuro-service-notification-box .kuro-nb-head-actions{display:flex;align-items:center;gap:7px}
      #kuro-service-notification-box button{font:inherit;cursor:pointer}
      #kuro-service-notification-box .kuro-nb-read-all,#kuro-service-notification-box .kuro-nb-close{border:1px solid #dce5f0;border-radius:9px;background:#fff;color:#51627a;font-size:10px;font-weight:850;padding:8px 10px}
      #kuro-service-notification-box .kuro-nb-close{width:33px;height:33px;padding:0;font-size:19px;line-height:1}
      #kuro-service-notification-box .kuro-nb-read-all:disabled{opacity:.4;cursor:default}
      #kuro-service-notification-box .kuro-nb-toolbar{display:flex;align-items:center;gap:6px;overflow-x:auto;padding:11px 14px;border-bottom:1px solid #edf0f5;scrollbar-width:none}
      #kuro-service-notification-box .kuro-nb-toolbar::-webkit-scrollbar{display:none}
      #kuro-service-notification-box .kuro-nb-filter{flex:0 0 auto;padding:7px 10px;border:1px solid #e1e7f0;border-radius:99px;background:#fff;color:#718097;font-size:10px;font-weight:850}
      #kuro-service-notification-box .kuro-nb-filter.is-active{border-color:#bfd6f6;background:#edf5ff;color:#2468bd}
      #kuro-service-notification-box .kuro-nb-status{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 16px 7px;color:#8290a4;font-size:10px}
      #kuro-service-notification-box .kuro-nb-status strong{color:#364a66;font-variant-numeric:tabular-nums}
      #kuro-service-notification-box .kuro-nb-list{padding:0 12px 14px;overflow:auto;overscroll-behavior:contain;display:grid;gap:8px}
      #kuro-service-notification-box .kuro-nb-item{display:grid;grid-template-columns:36px minmax(0,1fr);gap:10px;padding:12px;border:1px solid #e5eaf1;border-radius:13px;background:#fff;min-width:0}
      #kuro-service-notification-box .kuro-nb-item.is-unread{border-color:#cbdcf3;background:linear-gradient(110deg,#fff,#f7fbff)}
      #kuro-service-notification-box .kuro-nb-item[data-open-notification]{cursor:pointer;transition:border-color .15s ease,background .15s ease,transform .15s ease}
      #kuro-service-notification-box .kuro-nb-item[data-open-notification]:hover{border-color:#9bbbe7;background:#f7faff}
      #kuro-service-notification-box .kuro-nb-item[data-open-notification]:focus-visible{outline:3px solid #82b4f2;outline-offset:2px}
      #kuro-service-notification-box .kuro-nb-icon{width:36px;height:36px;display:grid;place-items:center;border-radius:11px;background:#eef4ff;font-size:17px}
      #kuro-service-notification-box .kuro-nb-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:#8793a6;font-size:9px}
      #kuro-service-notification-box .kuro-nb-source{padding:3px 6px;border-radius:99px;background:#f0f3f8;color:#5e6f87;font-weight:900}
      #kuro-service-notification-box .kuro-nb-source.admin{background:#eef4ff;color:#286dc7}
      #kuro-service-notification-box .kuro-nb-source.sns{background:#f4efff;color:#7754b7}
      #kuro-service-notification-box .kuro-nb-source.reply{background:#eaf8f0;color:#278052}\n      #kuro-service-notification-box .kuro-nb-source.points{background:#fff7df;color:#956500}\n      #kuro-service-notification-box .kuro-nb-source.level{background:#f1edff;color:#6b4bb0}
      #kuro-service-notification-box .kuro-nb-meta time{margin-left:auto;white-space:nowrap}
      #kuro-service-notification-box .kuro-nb-item h3{margin:6px 0 4px;font-size:12px;line-height:1.55;overflow-wrap:anywhere}
      #kuro-service-notification-box .kuro-nb-item p{margin:0;color:#65748b;font-size:10px;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere}
      #kuro-service-notification-box .kuro-nb-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}
      #kuro-service-notification-box .kuro-nb-action{padding:6px 8px;border:1px solid #dfe6ef;border-radius:8px;background:#fff;color:#596b83;font-size:9px;font-weight:850}
      #kuro-service-notification-box .kuro-nb-action:disabled{opacity:.45;cursor:default}
      #kuro-service-notification-box .kuro-nb-state{padding:28px 14px;border:1px dashed #d8e1ed;border-radius:13px;background:#fff;color:#8290a4;text-align:center;font-size:11px;line-height:1.8}
      #kuro-service-notification-box .kuro-nb-state strong{display:block;margin-bottom:5px;color:#34465f;font-size:13px}
      #kuro-service-notification-box .kuro-nb-error{padding:12px;border:1px solid #f0cccc;border-radius:11px;background:#fff5f5;color:#a13c45;font-size:10px;line-height:1.8}
      #kuro-service-notification-box .kuro-nb-footer{padding:9px 14px;border-top:1px solid #edf0f5;background:#fbfcfe;color:#8b97a8;font-size:9px;line-height:1.6}
      @media(max-width:600px){
        #kuro-service-notification-box .kuro-nb-backdrop{background:rgba(10,18,32,.42);backdrop-filter:blur(2px)}
        #kuro-service-notification-box .kuro-nb-panel{top:auto;right:0;bottom:0;left:0;width:100%;max-height:86dvh;border-radius:20px 20px 0 0;border-bottom:0;padding-bottom:env(safe-area-inset-bottom)}
        #kuro-service-notification-box .kuro-nb-head{padding:14px 15px}
        #kuro-service-notification-box .kuro-nb-toolbar{padding:10px 12px}
        #kuro-service-notification-box .kuro-nb-list{padding:0 10px 12px}
      }
      @media(prefers-reduced-motion:reduce){#kuro-service-notification-box *{scroll-behavior:auto!important;transition:none!important}}
    `;
    document.head.appendChild(style);
  }

  function findTriggers() {
    const selectors = ["#kuroNotificationLink", "#portalNotificationBoxTrigger", "#kuroTopNotifications", '[onclick*="openNotifications"]'];
    return Array.from(new Set(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))));
  }

  function attachBadge(trigger) {
    if (!trigger || trigger.dataset.kuroNbBound === "1") return;
    trigger.dataset.kuroNbBound = "1";
    trigger.classList.add("kuro-notification-box-trigger");
    let badge = trigger.querySelector(".kuro-notification-box-badge") || trigger.querySelector("#kuroNotificationBadge");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "kuro-notification-box-badge";
      badge.hidden = true;
      badge.textContent = "0";
      badge.setAttribute("aria-hidden", "true");
      trigger.appendChild(badge);
    }
    badge.classList.add("kuro-notification-box-badge");
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-controls", PANEL_ID);
    trigger.setAttribute("aria-expanded", "false");
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      open();
    }, true);
  }

  function ensurePanel() {
    if (root) return;
    ensureStyles();
    root = document.createElement("div");
    root.id = PANEL_ID;
    root.hidden = true;
    root.innerHTML = `
      <div class="kuro-nb-backdrop" data-nb-close></div>
      <section class="kuro-nb-panel" role="dialog" aria-modal="true" aria-labelledby="kuro-nb-title">
        <header class="kuro-nb-head">
          <div><h2 class="kuro-nb-title" id="kuro-nb-title">通知BOX</h2><p class="kuro-nb-subtitle">KUROの共通通知をこのサービス内で確認できます</p></div>
          <div class="kuro-nb-head-actions"><button class="kuro-nb-read-all" type="button" data-nb-read-all disabled>すべて既読</button><button class="kuro-nb-close" type="button" data-nb-close aria-label="閉じる">×</button></div>
        </header>
        <nav class="kuro-nb-toolbar" aria-label="通知の絞り込み">
          <button class="kuro-nb-filter is-active" data-filter="all" type="button">すべて</button>
          <button class="kuro-nb-filter" data-filter="unread" type="button">未読</button>
          <button class="kuro-nb-filter" data-filter="admin" type="button">運営</button>
          <button class="kuro-nb-filter" data-filter="social" type="button">SNS・チャット</button>
          <button class="kuro-nb-filter" data-filter="reply" type="button">返信</button>\n          <button class="kuro-nb-filter" data-filter="points" type="button">ポイント</button>\n          <button class="kuro-nb-filter" data-filter="level" type="button">レベルアップ</button>
          <button class="kuro-nb-filter" data-filter="announcement" type="button">お知らせ</button>
        </nav>
        <div class="kuro-nb-status"><span data-nb-status>通知を読み込んでいます…</span><strong data-nb-count>未読 0 件</strong></div>
        <div class="kuro-nb-list" data-nb-list aria-live="polite"><div class="kuro-nb-state">通知を読み込んでいます…</div></div>
        <footer class="kuro-nb-footer">通知を押すと、該当する投稿・プロフィール・チャットなどを直接開きます。閲覧・既読状態はKURO共通アカウントに保存されます。</footer>
      </section>`;
    document.body.appendChild(root);
    panel = root.querySelector(".kuro-nb-panel");
    list = root.querySelector("[data-nb-list]");
    status = root.querySelector("[data-nb-status]");
    count = root.querySelector("[data-nb-count]");
    markAllButton = root.querySelector("[data-nb-read-all]");
    root.addEventListener("click", (event) => {
      const close = event.target.closest("[data-nb-close]");
      const filterButton = event.target.closest("[data-filter]");
      const read = event.target.closest("[data-read]");
      const dismiss = event.target.closest("[data-dismiss]");
      const login = event.target.closest("[data-nb-login]");
      if (close) { closeBox(); return; }
      if (filterButton) {
        filter = filterButton.dataset.filter || "all";
        root.querySelectorAll("[data-filter]").forEach((button) => button.classList.toggle("is-active", button === filterButton));
        render();
        return;
      }
      if (read) {
        const item = items.find((entry) => entry.key === read.dataset.read);
        markRead(item).catch(showError);
        return;
      }
      if (dismiss) {
        const item = items.find((entry) => entry.key === dismiss.dataset.dismiss);
        dismissItem(item).catch(showError);
        return;
      }
      if (login) {
        closeBox();
        const selector = service === "games" ? "#kuroAccountOpen" : "#portal-account-button";
        const button = document.querySelector(selector);
        if (button) button.click();
        else if (typeof window.openAuthModal === "function") window.openAuthModal("signin");
        return;
      }
      const openCard = event.target.closest("[data-open-notification]");
      if (openCard) {
        const item = items.find((entry) => entry.key === openCard.dataset.openNotification);
        if (item) openNotification(item).catch(showError);
      }
    });
    root.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const card = event.target.closest("[data-open-notification]");
      if (!card || event.target !== card) return;
      event.preventDefault();
      const item = items.find((entry) => entry.key === card.dataset.openNotification);
      if (item) openNotification(item).catch(showError);
    });
    markAllButton.addEventListener("click", markAllRead);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !root.hidden) closeBox();
    });
  }

  function open() {
    ensurePanel();
    root.hidden = false;
    findTriggers().forEach((trigger) => trigger.setAttribute("aria-expanded", "true"));
    load();
    const closeButton = root.querySelector(".kuro-nb-close");
    if (closeButton) closeButton.focus({ preventScroll: true });
  }

  function closeBox() {
    if (!root) return;
    root.hidden = true;
    findTriggers().forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
  }

  function serviceLabel(scope) {
    return ({ all: "全サービス", both: "KURO Lab・SNS", lab: "KURO Lab", sns: "KURO SNS", games: "KURO GAMES" })[scope] || "運営";
  }

  function iconFor(item) {
    return ({ admin: "📢", social: item.type === "message" || item.type === "mention" ? "💬" : "👤", reply: "✉️", points: "🪙", level: "🏆", announcement: "🔔" })[item.kind] || "🔔";
  }

  function visibleItems() {
    return items.filter((item) => {
      if (filter === "unread") return !item.read;
      if (filter === "all") return true;
      return item.kind === filter || (filter === "announcement" && item.kind === "admin" && item.portal_announcement_id);
    });
  }

  function formatDate(value) {
    try {
      return new Date(value).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (_) { return ""; }
  }

  function render() {
    if (!root) return;
    const shown = visibleItems();
    const unread = items.filter((item) => !item.read).length;
    count.textContent = "未読 " + unread + " 件";
    status.textContent = user ? items.length + " 件の通知" : "ログインすると通知が表示されます";
    markAllButton.disabled = !unread || !user;
    if (!user) {
      list.innerHTML = '<div class="kuro-nb-state"><strong>ログインが必要です</strong>ログインすると、KUROの共通通知をこの画面で確認できます。<div class="kuro-nb-actions" style="justify-content:center"><button class="kuro-nb-action" data-nb-login type="button">ログインする</button></div></div>';
      return;
    }
    if (!shown.length) {
      list.innerHTML = '<div class="kuro-nb-state"><strong>' + (filter === "all" ? "通知はまだありません" : "この条件の通知はありません") + '</strong>新しい通知が届くとここに表示されます。</div>';
      return;
    }
    list.innerHTML = shown.map((item) => {
      const source = item.kind === "level" ? "レベルアップ" : item.kind === "points" ? "ポイント獲得" : item.kind === "admin" ? "運営のお知らせ" : item.kind === "social" ? "KURO SNS・チャット" : item.kind === "reply" ? "リクエストBOXへの返信" : "サービスのお知らせ";
      const sourceClass = item.kind === "level" ? "level" : item.kind === "points" ? "points" : item.kind === "admin" || item.kind === "announcement" ? "admin" : item.kind === "social" ? "sns" : "reply";
      const destination = notificationUrl(item);
      const openAttributes = destination
        ? ' data-open-notification="' + esc(item.key) + '" role="link" tabindex="0" aria-label="通知を開く: ' + esc(item.title) + '"'
        : "";
      return '<article class="kuro-nb-item ' + (item.read ? "" : "is-unread") + '"' + openAttributes + '><div class="kuro-nb-icon">' + iconFor(item) + '</div><div><div class="kuro-nb-meta"><span class="kuro-nb-source ' + sourceClass + '">' + source + '</span><span>' + esc(item.serviceLabel || "") + '</span><time>' + esc(formatDate(item.created_at)) + '</time></div><h3>' + esc(item.title) + '</h3><p>' + esc(item.body || "") + '</p><div class="kuro-nb-actions">' + (!item.read ? '<button class="kuro-nb-action" type="button" data-read="' + esc(item.key) + '">既読にする</button>' : '<span class="kuro-nb-meta">既読</span>') + '<button class="kuro-nb-action" type="button" data-dismiss="' + esc(item.key) + '">非表示</button></div></div></article>';
    }).join("");
  }

  function paintBadges(unread) {
    const label = unread > 99 ? "99+" : String(unread);
    findTriggers().forEach((trigger) => {
      let badge = trigger.querySelector(".kuro-notification-box-badge");
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "kuro-notification-box-badge";
        trigger.appendChild(badge);
      }
      badge.textContent = label;
      badge.hidden = unread === 0;
      trigger.classList.toggle("has-unread", unread > 0);
      trigger.setAttribute("aria-label", unread ? "未読通知 " + unread + " 件" : "通知BOX");
    });
    window.dispatchEvent(new Event("kuro:portal-notifications-updated"));
  }

  function activeDb() {
    db = getDb();
    return db;
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
  }

  function findNotificationPostId(details) {
    const keys = ["post_id", "postId", "target_post_id", "targetPostId", "postID", "targetPost", "post"];
    const queue = [details];
    const seen = new Set();
    while (queue.length) {
      const value = queue.shift();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      for (const key of keys) {
        const candidate = value[key];
        if (typeof candidate === "string" && isUuid(candidate)) return candidate;
        if (candidate && typeof candidate === "object") queue.push(candidate);
      }
      ["target", "data", "details", "payload", "reply", "comment"].forEach((key) => {
        if (value[key] && typeof value[key] === "object") queue.push(value[key]);
      });
    }
    return "";
  }

  function notificationUrl(item) {
    if (!item) return "";
    if (item.kind === "social") {
      const actorId = isUuid(item.actor_id) ? item.actor_id : "";
      if (item.type === "follow" || item.type === "follow_back") {
        return actorId ? "/sns/v2/?profile=" + encodeURIComponent(actorId) : "";
      }
      if (item.type === "message") {
        return actorId ? "/sns/v2/?chat=" + encodeURIComponent(actorId) : "";
      }
      if (item.type === "mention") {
        if (!isUuid(item.group_id)) return actorId ? "/sns/v2/?profile=" + encodeURIComponent(actorId) : "";
        const params = new URLSearchParams({ group: item.group_id });
        if (isUuid(item.message_id)) params.set("message", item.message_id);
        if (isUuid(item.id)) params.set("notification", item.id);
        return "/sns/v2/?" + params.toString();
      }
      if (item.type === "like" || item.type === "reply") {
        // Resolve through the notification row so older posts outside the latest feed
        // can still be fetched and a reply can be highlighted precisely.
        return isUuid(item.id) ? "/sns/v2/?notice=" + encodeURIComponent(item.id) : "";
      }
      return actorId ? "/sns/v2/?profile=" + encodeURIComponent(actorId) : "";
    }
    if (!item.href) return "";
    try {
      const target = new URL(String(item.href), window.location.origin);
      if ((target.protocol !== "https:" && target.protocol !== "http:") || target.username || target.password) return "";
      return target.href;
    } catch (_) {
      return "";
    }
  }

  async function openNotification(item) {
    const destination = notificationUrl(item);
    if (!destination) return;
    try {
      await markRead(item);
    } catch (error) {
      showError(error);
    }
    closeBox();
    window.location.assign(destination);
  }

  async function load() {
    const client = activeDb();
    if (!client) {
      if (status) status.textContent = "通知データベースに接続できません";
      if (list) list.innerHTML = '<div class="kuro-nb-error">通知データベースを初期化できませんでした。ページを再読み込みしてください。</div>';
      return;
    }
    if (busy) return;
    busy = true;
    const sequence = ++refreshSequence;
    try {
      const auth = await client.auth.getUser();
      if (auth?.error) throw auth.error;
      if (!auth?.data) throw new Error("認証情報の応答がありません。");
      user = auth.data && auth.data.user && !auth.data.user.is_anonymous ? auth.data.user : null;
      if (!user) {
        items = [];
        prefs = {};
        paintBadges(0);
        render();
        return;
      }
      const [messagesResult, socialResult, repliesResult, announcementsResult, preferencesResult] = await Promise.all([
        client.from("admin_messages").select("id,title,body,href,audience,recipient_id,created_at,service_scope,portal_announcement_id").eq("published", true).or("audience.eq.all,recipient_id.eq." + user.id).order("created_at", { ascending: false }).limit(200),
        client.from("notifications").select("id,type,actor_id,created_at,read_at,group_id,message_id,notification_details").eq("recipient_id", user.id).order("created_at", { ascending: false }).limit(100),
        client.from("portal_request_notifications").select("id,request_id,created_at,read_at,request:portal_requests(message,admin_reply,replied_at)").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
        client.from("portal_announcements").select("id,title,body,href,created_at").eq("published", true).order("created_at", { ascending: false }).limit(100),
        client.from("portal_preferences").select("preferences").eq("user_id", user.id).maybeSingle()
      ]);
      for (const result of [messagesResult, socialResult, repliesResult, announcementsResult, preferencesResult]) { if (result?.error) throw result.error; if (!result) throw new Error("通知データの応答がありません。"); }
      prefs = preferencesResult.data && preferencesResult.data.preferences && typeof preferencesResult.data.preferences === "object" ? preferencesResult.data.preferences : {};
      const messages = messagesResult.data || [];
      const messageIds = messages.map((row) => row.id);
      const readsResult = messageIds.length
        ? await client.from("admin_message_reads").select("message_id,read_at").eq("user_id", user.id).in("message_id", messageIds)
        : { data: [], error: null };
      if (readsResult.error) throw readsResult.error;
      const readMessageIds = new Set((readsResult.data || []).map((row) => row.message_id));
      const social = socialResult.data || [];
      const actorIds = Array.from(new Set(social.map((row) => row.actor_id).filter(Boolean)));
      const actorResult = actorIds.length
        ? await client.from("profiles").select("id,username,display_name").in("id", actorIds)
        : { data: [], error: null };
      if (actorResult.error) throw actorResult.error;
      const actors = new Map((actorResult.data || []).map((row) => [row.id, row]));
      const mirrored = new Set(messages.map((row) => row.portal_announcement_id).filter(Boolean));
      const next = [];
      social.filter((row) => row.type === "coin_reward").forEach((row) => { const d = row.notification_details || {}; const amount = Number(d.amount || 0); const title = d.adminAdjustment ? "管理者によるポイント補正 " + (amount > 0 ? "+" : "") + amount + " P" : "ポイントを獲得しました！ +" + amount + " P"; next.push({ key: "points:" + row.id, kind: "points", id: row.id, type: row.type, title, body: (d.description || "報酬を獲得しました。") + (d.balanceAfter != null ? "\n補正後の残高: " + d.balanceAfter + " P" : ""), created_at: row.created_at, read: !!row.read_at, serviceLabel: "KURO GAMES", href: "/games/store/" }); });
      messages.forEach((row) => next.push({
        key: "admin:" + row.id, kind: "admin", id: row.id, title: row.title, body: row.body, href: row.href,
        created_at: row.created_at, read: readMessageIds.has(row.id), serviceLabel: serviceLabel(row.service_scope),
        portal_announcement_id: row.portal_announcement_id
      }));
      social.filter((row) => row.type === "level_up").forEach((row) => {
        const details = row.notification_details || {};
        const fromLevel = Math.max(1, Math.floor(Number(details.fromLevel) || 1));
        const toLevel = Math.max(fromLevel + 1, Math.floor(Number(details.toLevel) || (fromLevel + 1)));
        next.push({
          key: "level:" + row.id, kind: "level", id: row.id, type: row.type,
          title: "🎉 レベルアップ！",
          body: "おめでとうございます！レベルが Lv." + fromLevel.toLocaleString("ja-JP") + " から Lv." + toLevel.toLocaleString("ja-JP") + " に上がりました。",
          created_at: row.created_at, read: !!row.read_at, serviceLabel: "KURO GAMES", href: "/games/"
        });
      });
      social.filter((row) => row.type !== "coin_reward" && row.type !== "level_up").forEach((row) => {
        const actor = actors.get(row.actor_id) || {};
        const name = actor.display_name || actor.username || "ユーザー";
        const typeText = { follow: "フォローされました", follow_back: "フォローバックされました", like: "投稿にいいねされました", reply: "投稿に返信がありました", message: "メッセージが届きました", mention: "グループチャットでメンションされました" };
        const details = row.notification_details && typeof row.notification_details === "object" ? row.notification_details : {};
        next.push({
          key: "social:" + row.id, kind: "social", id: row.id, type: row.type, title: name + " さんからの通知",
          body: typeText[row.type] || "新しい通知があります。", created_at: row.created_at, read: !!row.read_at, serviceLabel: "KURO SNS",
          actor_id: row.actor_id, group_id: row.group_id, message_id: row.message_id, notification_details: details
        });
      });
      (repliesResult.data || []).forEach((row) => {
        const request = row.request || {};
        next.push({
          key: "reply:" + row.id, kind: "reply", id: row.id, title: "リクエストBOXに返信が届きました",
          body: request.admin_reply || "運営から返信がありました。", created_at: row.created_at, read: !!row.read_at,
          serviceLabel: "KURO Lab", extra: request.message || ""
        });
      });
      const readAnnouncements = new Set(Array.isArray(prefs.readAnnouncements) ? prefs.readAnnouncements : []);
      (announcementsResult.data || []).filter((row) => !mirrored.has(row.id)).forEach((row) => next.push({
        key: "announcement:" + row.id, kind: "announcement", id: row.id, title: row.title, body: row.body, href: row.href,
        created_at: row.created_at, read: readAnnouncements.has(row.id), serviceLabel: "KURO Lab"
      }));
      const dismissed = new Set(Array.isArray(prefs.dismissedNotifications) ? prefs.dismissedNotifications : []);
      items = next.filter((row) => !dismissed.has(row.key)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      if (sequence !== refreshSequence) return;
      paintBadges(items.filter((row) => !row.read).length);
      render();
    } catch (error) {
      console.error("[KURO notification box] load failed:", error);
      if (status) status.textContent = "読み込みエラー";
      if (list) list.innerHTML = '<div class="kuro-nb-error">通知を読み込めませんでした。通信状態を確認して再度お試しください。<br>' + esc(error && error.message || "不明なエラー") + '</div>';
    } finally {
      busy = false;
    }
  }

  async function markRead(item) {
    if (!item || item.read || !user) return;
    const client = activeDb();
    const now = new Date().toISOString();
    let result = { error: null };
    if (item.kind === "admin") {
      result = await client.from("admin_message_reads").upsert({ message_id: item.id, user_id: user.id, read_at: now }, { onConflict: "message_id,user_id" });
    } else if (item.kind === "social" || item.kind === "points" || item.kind === "level") {
      result = await client.from("notifications").update({ read_at: now }).eq("id", item.id).eq("recipient_id", user.id);
    } else if (item.kind === "reply") {
      result = await client.from("portal_request_notifications").update({ read_at: now }).eq("id", item.id).eq("user_id", user.id);
    } else if (item.kind === "announcement") {
      const ids = Array.isArray(prefs.readAnnouncements) ? prefs.readAnnouncements.slice() : [];
      if (!ids.includes(item.id)) ids.push(item.id);
      prefs = Object.assign({}, prefs, { readAnnouncements: ids.slice(-300) });
      result = await client.from("portal_preferences").upsert({ user_id: user.id, preferences: prefs, updated_at: now }, { onConflict: "user_id" });
    }
    if (result.error) throw result.error;
    item.read = true;
    paintBadges(items.filter((row) => !row.read).length);
    render();
  }

  async function dismissItem(item) {
    if (!item || !user) return;
    const client = activeDb();
    const ids = Array.isArray(prefs.dismissedNotifications) ? prefs.dismissedNotifications.slice() : [];
    if (!ids.includes(item.key)) ids.push(item.key);
    prefs = Object.assign({}, prefs, { dismissedNotifications: ids.slice(-500) });
    const result = await client.from("portal_preferences").upsert({ user_id: user.id, preferences: prefs, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (result.error) throw result.error;
    items = items.filter((row) => row.key !== item.key);
    paintBadges(items.filter((row) => !row.read).length);
    render();
  }

  async function markAllRead() {
    if (!user || !items.length) return;
    markAllButton.disabled = true;
    try {
      const client = activeDb();
      const now = new Date().toISOString();
      const admin = items.filter((row) => row.kind === "admin" && !row.read);
      const social = items.filter((row) => (row.kind === "social" || row.kind === "points" || row.kind === "level") && !row.read);
      const replies = items.filter((row) => row.kind === "reply" && !row.read);
      const announcements = items.filter((row) => row.kind === "announcement" && !row.read);
      const operations = [];
      if (admin.length) operations.push(client.from("admin_message_reads").upsert(admin.map((row) => ({ message_id: row.id, user_id: user.id, read_at: now })), { onConflict: "message_id,user_id" }));
      if (social.length) operations.push(client.from("notifications").update({ read_at: now }).eq("recipient_id", user.id).in("id", social.map((row) => row.id)));
      if (replies.length) operations.push(client.from("portal_request_notifications").update({ read_at: now }).eq("user_id", user.id).in("id", replies.map((row) => row.id)));
      if (announcements.length) {
        const ids = Array.isArray(prefs.readAnnouncements) ? prefs.readAnnouncements.slice() : [];
        announcements.forEach((row) => { if (!ids.includes(row.id)) ids.push(row.id); });
        prefs = Object.assign({}, prefs, { readAnnouncements: ids.slice(-300) });
        operations.push(client.from("portal_preferences").upsert({ user_id: user.id, preferences: prefs, updated_at: now }, { onConflict: "user_id" }));
      }
      const results = await Promise.all(operations);
      for (const result of results) if (result.error) throw result.error;
      items.forEach((row) => { row.read = true; });
      paintBadges(0);
      render();
    } catch (error) {
      console.error("[KURO notification box] mark all failed:", error);
      showError(error);
      markAllButton.disabled = false;
    }
  }

  function showError(error) {
    if (!list) return;
    const box = document.createElement("div");
    box.className = "kuro-nb-error";
    box.textContent = "操作を完了できませんでした: " + (error && error.message ? error.message : "不明なエラー");
    list.prepend(box);
  }

  function bind() {
    ensurePanel();
    findTriggers().forEach(attachBadge);
    if (service === "sns") window.openNotifications = function () { open(); };
  }

  function init() {
    bind();
    load();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") load();
    });
    window.addEventListener("focus", () => {
      if (!root || !root.hidden) load();
    });
    const client = activeDb();
    if (client && client.auth && typeof client.auth.onAuthStateChange === "function") {
      client.auth.onAuthStateChange(() => {
        user = null;
        items = [];
        load();
      });
    }
  }

  window.KuroNotificationBox = { __ready: true, open, close: closeBox, refresh: load };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();