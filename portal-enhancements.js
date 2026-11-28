/* KURO Lab portal enhancements: unified navigation, workspaces, responsive shell */
(function () {
  "use strict";

  var api = null;
  var observer = null;
  var captureTimer = 0;
  var syncTimer = 0;
  var esc = function (v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var pathNow = function () {
    return location.pathname.replace(/\/+$/, "") || "/";
  };

  var groups = [
    { label: "メイン", items: [
      { href: "/", label: "ホーム", icon: "⌂" },
      { href: "/search/", label: "探す", icon: "⌕" }
    ] },
    { label: "サービス", items: [
      { href: "/games/", label: "KURO GAMES", icon: "🎮" },
      { href: "/sns/", label: "KURO SNS", icon: "💬" },
      { href: "/chat/", label: "チャット", icon: "🗨️" }
    ] },
    { label: "履歴", items: [
      { href: "/history/", label: "閲覧履歴", icon: "◷" },
    ] },

    { label: "アカウント", items: [
      { href: "/account/", label: "アカウント管理", icon: "◎" },
      { href: "/pro-tools/", label: "開発ツール", icon: "⚡" },
      { href: "/theme-studio/", label: "Theme Studio", icon: "🎨" },
      { href: "/settings/", label: "設定", icon: "⚙" },
      { href: "/request/", label: "リクエストBOX", icon: "✉" }
    ] },
    { label: "ヘルプ", items: [
      { href: "/guide/", label: "使い方ガイド", icon: "📘" },
      { href: "/faq/", label: "よくある質問", icon: "❔" },
      { href: "/about/", label: "KURO Labについて", icon: "ⓘ" },
      { href: "/contact/", label: "お問い合わせ", icon: "✉" }
    ] }
  ];

  var mobilePrimary = [
    { href: "/", label: "ホーム", icon: "⌂" },
    { href: "/games/", label: "ゲーム", icon: "🎮" },
    { href: "/search/", label: "探す", icon: "⌕", action: "search" },
    { href: "/sns/", label: "SNS", icon: "💬" }
  ];

  function getApi() {
    if (!api && window.__kuroPortal) api = window.__kuroPortal;
    return api;
  }

  function getPrefs() {
    var a = getApi();
    return a && a.state && a.state.data ? a.state.data.preferences : null;
  }

  function getState() {
    var a = getApi();
    return a && a.state ? a.state : null;
  }

  function openQuick() {
    var a = getApi();
    if (a && typeof a.openQuick === "function") a.openQuick();
    else {
      var q = document.getElementById("portal-quick-button");
      if (q) q.click();
    }
  }

  function currentPageActive(href) {
    var p = pathNow();
    var target = href.replace(/\/+$/, "") || "/";
    if (target === "/") return p === "/";
    return p === target || (target.indexOf("/game/") === 0 && p.indexOf(target) === 0);
  }

  function getUnreadCount() {
    var s = getState();
    if (!s || !s.data) return 0;
    var preferences = s.data.preferences || {};
    var read = Array.isArray(preferences.readAnnouncements) ? preferences.readAnnouncements : [];
    var dismissed = new Set(Array.isArray(preferences.dismissedNotifications) ? preferences.dismissedNotifications : []);
    var readAnnouncements = new Set(read);
    var mirrored = new Set((s.adminMessages || []).map(function (item) {
      return item && item.portal_announcement_id;
    }).filter(Boolean));
    var adminReads = new Set((s.adminMessageReads || []).map(function (item) {
      return item && item.message_id;
    }).filter(Boolean));
    var announcements = (s.ann || []).filter(function (item) {
      return item && item.id && !readAnnouncements.has(item.id) && !mirrored.has(item.id) && !dismissed.has("announcement:" + item.id);
    }).length;
    var admin = (s.adminMessages || []).filter(function (item) {
      return item && item.id && !adminReads.has(item.id) && !dismissed.has("admin:" + item.id);
    }).length;
    var social = (s.socialNotifications || []).filter(function (item) {
      return item && item.id && !item.read_at && !dismissed.has("social:" + item.id);
    }).length;
    var replies = (s.requestNotifications || []).filter(function (item) {
      return item && item.id && !item.read_at && !dismissed.has("reply:" + item.id);
    }).length;
    return announcements + admin + social + replies;
  }

  function badgeHtml() {
    var n = getUnreadCount();
    return n ? '<span class="portal-sidebar-badge">' + (n > 99 ? "99+" : n) + "</span>" : "";
  }

  function navItem(item) {
    var cls = "portal-sidebar-item" + (currentPageActive(item.href) ? " is-active" : "");
    var click = item.action === "search" ? ' data-open-quick="true"' : "";
    return '<a class="' + cls + '" href="' + item.href + '"' + click +
      (currentPageActive(item.href) ? ' aria-current="page"' : "") +
      '><span class="portal-sidebar-icon">' + item.icon + "</span><span class=\"portal-sidebar-text\">" +
      esc(item.label) + "</span>" + (item.badge ? badgeHtml() : "") + "</a>";
  }

  function sidebarMarkup() {
    var blocks = groups.map(function (group) {
      return '<div class="portal-sidebar-group"><div class="portal-sidebar-group-label">' +
        group.label + "</div>" + group.items.map(navItem).join("") + "</div>";
    }).join("");
    return '<div class="portal-sidebar-heading">ナビゲーション</div>' +
      '<div class="portal-sidebar-nav">' + blocks + "</div>" +
      '<div class="portal-sidebar-bottom"><div class="portal-sidebar-workspace"><span class="portal-sidebar-workspace-dot"></span><span><small>ACTIVE WORKSPACE</small><b id="portal-sidebar-workspace-name">普段使い</b></span></div>' +
      '<a class="portal-sidebar-settings" href="/settings/">⚙ <span>設定をカスタマイズ</span><i>↗</i></a></div>';
  }

  function mobileDrawerMarkup() {
    var all = groups.reduce(function (a, g) { return a.concat(g.items); }, []);
    return '<div class="portal-mobile-drawer" id="portal-mobile-drawer" hidden><div class="portal-mobile-drawer-backdrop" data-mobile-close></div>' +
      '<section class="portal-mobile-drawer-panel" role="dialog" aria-modal="true" aria-label="すべてのメニュー">' +
      '<div class="portal-mobile-drawer-head"><div><small>KURO LAB</small><b>メニュー</b></div><button type="button" data-mobile-close aria-label="閉じる">×</button></div>' +
      '<button type="button" class="portal-mobile-drawer-search" data-open-quick="true">⌕　サービス・ページを検索</button>' +
      '<div class="portal-mobile-drawer-links">' + all.map(function (x) {
        return '<a href="' + x.href + '"' + (currentPageActive(x.href) ? ' aria-current="page"' : "") + '><span>' + x.icon +
          "</span><b>" + esc(x.label) + "</b>" + (x.badge ? badgeHtml() : "") + "</a>";
      }).join("") + "</div></section></div>";
  }

  function setupShell() {
    var main = document.getElementById("portal-main");
    if (!main) return;
    var shell = main.parentElement;
    if (!shell || !shell.classList.contains("portal-app-shell")) {
      shell = document.createElement("div");
      shell.className = "portal-app-shell";
      main.parentNode.insertBefore(shell, main);
      var side = document.createElement("aside");
      side.id = "portal-app-sidebar";
      side.className = "portal-app-sidebar";
      side.setAttribute("aria-label", "KURO Lab ナビゲーション");
      side.innerHTML = sidebarMarkup();
      shell.appendChild(side);
      shell.appendChild(main);
    } else {
      var sideExisting = document.getElementById("portal-app-sidebar");
      if (sideExisting) sideExisting.innerHTML = sidebarMarkup();
    }
    main.classList.add("portal-app-main");
    setupHeaderActions();
    setupMobileNavigation();
    updateBadges();
  }

  function setupHeaderActions() {
    var header = document.querySelector(".portal-header-inner");
    if (!header) return;
    // Remove the retired transport badge even when an older cached HTML shell still contains it.
    header.querySelectorAll("#portal-transport-button,.portal-transport-button").forEach(function (el) { el.remove(); });
    Array.from(header.children).forEach(function (el) {
      if (el.id !== "portalNotificationBoxTrigger" && el.id !== "portal-account-button" && el.textContent.trim() === "Cloudflare経由") el.remove();
    });
    if (!document.getElementById("portalNotificationBoxTrigger")) {
      var notificationButton = document.createElement("button");
      notificationButton.id = "portalNotificationBoxTrigger";
      notificationButton.type = "button";
      notificationButton.className = "portal-quick-button portal-notification-button";
      notificationButton.setAttribute("aria-label", "通知BOX");
      notificationButton.title = "このサービス内で通知を確認";
      notificationButton.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg>';
      var accountButton = document.getElementById("portal-account-button");
      header.appendChild(notificationButton);
      if (!document.getElementById("portal-notification-button-position-style")) {
        var notificationStyle = document.createElement("style");
        notificationStyle.id = "portal-notification-button-position-style";
        notificationStyle.textContent = ".portal-header-inner .portal-notification-button{order:999;margin-left:auto!important;color:#111!important}.portal-header-inner .portal-notification-button svg{stroke:#111!important}.portal-header-inner #portal-account-button{order:1000}";
        document.head.appendChild(notificationStyle);
      }
    }
    if (!document.getElementById("kuro-service-notification-box-script")) {
      var notificationScript = document.createElement("script");
      notificationScript.id = "kuro-service-notification-box-script";
      notificationScript.src = "/service-notification-box.js?v=20261127targetnav4";
      document.body.appendChild(notificationScript);
    }
    if (!document.getElementById("portal-toolbox-menu-wrap")) {
      var toolbox = document.createElement("div");
      toolbox.id = "portal-toolbox-menu-wrap";
      toolbox.className = "portal-toolbox-menu-wrap";
      toolbox.innerHTML =
        '<button type="button" class="portal-toolbox-trigger" data-toolbox-toggle aria-expanded="false" aria-controls="portal-toolbox-menu">' +
          '<span class="portal-toolbox-trigger-icon">▦</span><span>ツールボックス</span><span class="portal-toolbox-chevron">⌄</span>' +
        '</button>' +
        '<div class="portal-toolbox-menu" id="portal-toolbox-menu" hidden>' +
          '<div class="portal-toolbox-menu-heading"><b>ツールボックス</b><small>使いたいツールを選択</small></div>' +
          '<a href="/tools/?tool=weather"><span>🌦️</span><b>天気予報</b><i>↗</i></a>' +
          '<a href="/tools/?tool=news"><span>📰</span><b>ニュースまとめ</b><i>↗</i></a>' +
          '<a href="/tools/?tool=worldclock"><span>🌐</span><b>世界時計</b><i>↗</i></a>' +
          '<a href="/tools/?tool=convert"><span>💱</span><b>為替・単位変換</b><i>↗</i></a>' +
          '<a href="/tools/?tool=rss"><span>📡</span><b>RSSリーダー</b><i>↗</i></a>' +
          '<a href="/tools/?tool=status"><span>📶</span><b>サイト稼働状況</b><i>↗</i></a>' +
          '<a href="/pro-tools/?tool=json"><span>{ }</span><b>JSON Formatter</b><i >↗</i></a>' +
          '<a href="/pro-tools/?tool=convert"><span>↔</span><b>URL / Base64 Converter</b><i >↗</i></a>' +
          '<a href="/pro-tools/?tool=uuid"><span>⌗</span><b>UUID Generator</b><i >↗</i></a>' +
          '<a class="portal-toolbox-all" href="/tools/">すべてのツールを見る <i>→</i></a>' +
        '</div>';
      var accountButton = document.getElementById("portal-account-button");
      header.insertBefore(toolbox, accountButton || null);
    }
  }

  function setupMobileNavigation() {
    var nav = document.getElementById("portal-mobile-nav");
    if (!nav) return;
    nav.innerHTML = mobilePrimary.map(function (item) {
      var active = currentPageActive(item.href);
      var cls = active ? ' aria-current="page"' : "";
      if (item.action === "search") {
        return '<button type="button" class="portal-mobile-nav-action" data-open-quick="true"><span>' + item.icon + "</span><span>" + item.label + "</span></button>";
      }
      return '<a href="' + item.href + '"' + cls + '><span>' + item.icon + "</span><span>" + item.label + "</span></a>";
    }).join("") +
      '<button type="button" class="portal-mobile-nav-action" data-mobile-open><span>☷</span><span>その他</span></button>';
    if (!document.getElementById("portal-mobile-drawer")) {
      document.body.insertAdjacentHTML("beforeend", mobileDrawerMarkup());
    }
  }

  function updateBadges() {
    var n = getUnreadCount();
    document.querySelectorAll(".portal-sidebar-badge").forEach(function (el) {
      el.textContent = n > 99 ? "99+" : String(n);
      el.hidden = !n;
    });
    var name = document.getElementById("portal-sidebar-workspace-name");
    var p = getPrefs();
    if (name && p) {
      var active = p.activeWorkspace || "personal";
      var w = p.dashboardWorkspaces && p.dashboardWorkspaces[active];
      name.textContent = w && w.name ? w.name : "普段使い";
    }
  }

    function snapshotCurrent() {
    var p = getPrefs();
    if (!p) return null;
    return {
      widgets: Array.isArray(p.dashboardWidgets) ? p.dashboardWidgets.slice() : [],
      layout: p.dashboardLayout || "balanced",
      viewMode: p.dashboardViewMode === "canvas" ? "canvas" : "grid",
      sizes: JSON.parse(JSON.stringify(p.dashboardSizes || {})),
      spans: JSON.parse(JSON.stringify(p.dashboardSpans || {})),
      heights: JSON.parse(JSON.stringify(p.dashboardHeights || {})),
      positions: JSON.parse(JSON.stringify(p.dashboardCanvasPositions || {})),
      bounds: JSON.parse(JSON.stringify(p.dashboardCanvasBounds || {width:4800,height:3200})),
      zoom: Number(p.dashboardCanvasZoom) || 1
    };
  }

  function cloneSnapshot(x) {
    return {
      widgets: Array.isArray(x && x.widgets) ? x.widgets.slice() : ["shortcuts", "games", "weather"],
      layout: x && ["balanced", "three", "single"].indexOf(x.layout) >= 0 ? x.layout : "balanced",
      viewMode: x && x.viewMode === "canvas" ? "canvas" : "grid",
      sizes: JSON.parse(JSON.stringify(x && x.sizes || {})),
      spans: JSON.parse(JSON.stringify(x && x.spans || {})),
      heights: JSON.parse(JSON.stringify(x && x.heights || {})),
      positions: JSON.parse(JSON.stringify(x && x.positions || {})),
      bounds: JSON.parse(JSON.stringify(x && x.bounds || {width:4800,height:3200})),
      zoom: Math.max(.55,Math.min(1.5,Number(x && x.zoom) || 1))
    };
  }

  function ensureWorkspaces() {
    var a = getApi(), p = getPrefs();
    if (!a || !p) return false;
    if (p.dashboardWorkspaces && Object.keys(p.dashboardWorkspaces).length) return false;
    var current = snapshotCurrent() || {};
    p.dashboardWorkspaces = {
      personal: Object.assign({ name: "普段使い" }, cloneSnapshot(current)),
      gaming: {
        name: "ゲーム", widgets: ["games", "shortcuts", "clock"],
        layout: "balanced", sizes: { games: "wide", shortcuts: "half", clock: "small" }, spans: {}, heights: {}
      },
      creation: {
        name: "制作・開発", widgets: ["shortcuts", "custom", "activity", "clock"],
        layout: "balanced", sizes: { shortcuts: "half", custom: "wide", activity: "half", clock: "small" }, spans: {}, heights: {}
      }
    };
    p.activeWorkspace = "personal";
    a.save();
    var s = getState();
    if (s && s.user && typeof a.sync === "function") a.sync(false);
    return true;
  }

  function captureWorkspace() {
    var a = getApi(), p = getPrefs();
    if (!a || !p || !p.dashboardWorkspaces) return;
    var id = p.activeWorkspace || "personal";
    var previous = p.dashboardWorkspaces[id];
    if (!previous) return;
    var next = Object.assign({ name: previous.name || "ワークスペース" }, cloneSnapshot(snapshotCurrent()));
    var before = JSON.stringify(previous), after = JSON.stringify(next);
    if (before !== after) {
      p.dashboardWorkspaces[id] = next;
      a.save();
      var s = getState();
      if (s && s.user && typeof a.sync === "function") {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(function () { a.sync(false); }, 500);
      }
    }
  }

  function saveAndRender(message) {
    var a = getApi();
    if (!a) return;
    a.save();
    var s = getState();
    if (s && s.user && typeof a.sync === "function") a.sync(false);
    if (typeof a.render === "function") a.render();
    if (message && typeof a.toast === "function") a.toast(message);
    updateBadges();
  }

  function switchWorkspace(id) {
    var a = getApi(), p = getPrefs();
    if (!a || !p || !p.dashboardWorkspaces || !p.dashboardWorkspaces[id]) return;
    captureWorkspace();
    window.__kuroCanvasScroll = null;
    var w = p.dashboardWorkspaces[id];
    p.activeWorkspace = id;
    var snap = cloneSnapshot(w);
    p.dashboardWidgets = snap.widgets;
    p.dashboardLayout = snap.layout;
    p.dashboardSizes = snap.sizes;
    p.dashboardSpans = snap.spans;
    p.dashboardHeights = snap.heights;
    p.dashboardViewMode = snap.viewMode;
    p.dashboardCanvasPositions = snap.positions;
    p.dashboardCanvasBounds = snap.bounds;
    p.dashboardCanvasZoom = snap.zoom;
    saveAndRender(w.name + "に切り替えました");
  }

  function createWorkspace() {
    var a = getApi(), p = getPrefs();
    if (!a || !p || !p.dashboardWorkspaces) return;
    var workspaceLimit = 20;
    if (Object.keys(p.dashboardWorkspaces).length >= workspaceLimit) {
      a.toast("ワークスペースの上限（20個）に達しました");
      return;
    }
    var name = window.prompt("新しいワークスペース名を入力してください（最大16文字）");
    if (!name) return;
    name = name.trim().slice(0, 16);
    if (!name) return;
    captureWorkspace();
    var id = "custom_" + Date.now();
    p.dashboardWorkspaces[id] = Object.assign({ name: name }, cloneSnapshot(snapshotCurrent()));
    p.activeWorkspace = id;
    saveAndRender("ワークスペースを作成しました");
  }

  function deleteWorkspace(id) {
    var a = getApi(), p = getPrefs();
    if (!a || !p || !p.dashboardWorkspaces || !p.dashboardWorkspaces[id] || id.indexOf("custom_") !== 0) return;
    var w = p.dashboardWorkspaces[id];
    if (!window.confirm("「" + w.name + "」を削除しますか？")) return;
    delete p.dashboardWorkspaces[id];
    if (p.activeWorkspace === id) {
      window.__kuroCanvasScroll = null;
      var personal = p.dashboardWorkspaces.personal || { widgets: ["shortcuts", "games", "weather"], layout: "balanced", sizes: {}, spans: {}, heights: {} };
      var fallback = cloneSnapshot(personal);
      p.activeWorkspace = "personal";
      p.dashboardWidgets = fallback.widgets;
      p.dashboardLayout = fallback.layout;
      p.dashboardSizes = fallback.sizes;
      p.dashboardSpans = fallback.spans;
      p.dashboardHeights = fallback.heights;
    }
    saveAndRender("ワークスペースを削除しました");
  }

  function workspaceBar(p) {
    var items = Object.keys(p.dashboardWorkspaces || {}).map(function (id) {
      var w = p.dashboardWorkspaces[id];
      var active = (p.activeWorkspace || "personal") === id;
      var displayName = id === "gaming" ? "ゲームモード" : id === "creation" ? "仕事モード" : (w.name || "ワークスペース");
      return '<div class="portal-workspace-tab-wrap"><button type="button" class="portal-workspace-tab' +
        (active ? " is-active" : "") + '" data-workspace-switch="' + esc(id) + '" aria-pressed="' + active + '">' +
        '<span class="portal-workspace-tab-dot"></span><span>' + esc(displayName) + "</span></button>" +
        (id.indexOf("custom_") === 0 ? '<button type="button" class="portal-workspace-delete" data-workspace-delete="' + esc(id) + '" aria-label="削除">×</button>' : "") +
        "</div>";
    }).join("");
    return '<div class="portal-workspace-bar"><div class="portal-workspace-heading"><span>YOUR WORKSPACES</span><small>用途ごとにホームを切り替え</small></div><div class="portal-workspace-tabs">' +
      items + '<button type="button" class="portal-workspace-create" data-workspace-create aria-label="ワークスペースを追加">＋</button><button type="button" class="portal-workspace-share" data-workspace-share aria-label="ワークスペースを共有">共有 ↗</button></div></div>';
  }


  var TEMPLATE_WIDGETS = ["shortcuts","games","activity","clock","weather","market","smartlinks","groups","searchbox","qr","rss","notes","todo","pomodoro","worldclock","countdown","utilities","photo","media","custom"];
  var pendingSharedTemplate = null;

  function cleanTemplatePayload(input) {
    if (!input || input.v !== 1 || !Array.isArray(input.widgets)) return null;
    var widgets = Array.from(new Set(input.widgets.filter(function (id) {
      return TEMPLATE_WIDGETS.indexOf(id) >= 0;
    }))).slice(0, 24);
    if (!widgets.length) return null;
    function cleanMap(source, allowed) {
      var out = {};
      if (!source || typeof source !== "object") return out;
      Object.keys(source).forEach(function (key) {
        if (widgets.indexOf(key) < 0) return;
        var value = source[key];
        if (allowed === "size" && ["small","half","wide","full"].indexOf(value) >= 0) out[key] = value;
        else if (allowed === "span" && Number(value) >= 1 && Number(value) <= 12) out[key] = Math.round(Number(value));
        else if (allowed === "height" && Number(value) >= 160 && Number(value) <= 900) out[key] = Math.round(Number(value));
        else if (allowed === "position" && value && typeof value === "object") {
          out[key] = {
            x: Math.max(-50000,Math.min(50000,Number(value.x)||0)),
            y: Math.max(-50000,Math.min(50000,Number(value.y)||0)),
            width: Math.max(260,Math.min(1100,Number(value.width)||420)),
            rotation: Math.max(-180,Math.min(180,Number(value.rotation)||0)),
            z: Math.max(1,Math.min(999,Number(value.z)||100))
          };
        }
      });
      return out;
    }
    var bounds = input.bounds || {};
    return {
      v: 1,
      name: String(input.name || "共有テンプレート").replace(/[<>]/g,"").trim().slice(0,24) || "共有テンプレート",
      widgets: widgets,
      layout: ["balanced","three","single"].indexOf(input.layout) >= 0 ? input.layout : "balanced",
      viewMode: input.viewMode === "canvas" ? "canvas" : "grid",
      sizes: cleanMap(input.sizes,"size"),
      spans: cleanMap(input.spans,"span"),
      heights: cleanMap(input.heights,"height"),
      positions: cleanMap(input.positions,"position"),
      bounds: {
        width: Math.max(3200,Math.min(30000,Number(bounds.width)||4800)),
        height: Math.max(2200,Math.min(30000,Number(bounds.height)||3200))
      },
      zoom: Math.max(.55,Math.min(1.5,Number(input.zoom)||1))
    };
  }

  function encodeTemplate(payload) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
      .replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  }

  function decodeTemplate(token) {
    try {
      var base64 = String(token || "").replace(/-/g,"+").replace(/_/g,"/");
      while (base64.length % 4) base64 += "=";
      var json = decodeURIComponent(escape(atob(base64)));
      if (json.length > 18000) return null;
      return cleanTemplatePayload(JSON.parse(json));
    } catch (e) { return null; }
  }

  function readIncomingTemplate() {
    if (pendingSharedTemplate) return pendingSharedTemplate;
    var hash = String(location.hash || "");
    var match = hash.match(/(?:^#|&)kuro-template=([^&]+)/);
    if (!match) return null;
    pendingSharedTemplate = decodeTemplate(match[1]);
    return pendingSharedTemplate;
  }

  function clearTemplateHash() {
    try { history.replaceState(null,"",location.pathname + location.search); } catch (e) {}
    pendingSharedTemplate = null;
  }

  function shareCurrentWorkspace() {
    var a = getApi(), p = getPrefs();
    if (!a || !p || !p.dashboardWorkspaces) return;
    captureWorkspace();
    p = getPrefs();
    var id = p.activeWorkspace || "personal", w = p.dashboardWorkspaces[id] || {};
    var snap = cleanTemplatePayload(Object.assign({v:1,name:w.name || "KURO ワークスペース"}, snapshotCurrent()));
    if (!snap) { a.toast("共有できるウィジェットがありません"); return; }
    var url = location.origin + location.pathname + location.search + "#kuro-template=" + encodeTemplate(snap);
    if (url.length > 14000) { a.toast("テンプレートの情報量が多すぎます。ウィジェット数を減らしてください"); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        a.toast("テンプレート共有URLをコピーしました");
      }).catch(function () {
        window.prompt("このURLをコピーして共有してください",url);
      });
    } else {
      window.prompt("このURLをコピーして共有してください",url);
    }
  }

  function showTemplateImportCard() {
    var a = getApi(), dash = document.querySelector(".portal-dashboard-v2");
    var payload = readIncomingTemplate();
    if (!a || !dash || !payload || document.getElementById("portal-template-import")) return;
    var card = document.createElement("section");
    card.id = "portal-template-import";
    card.className = "portal-template-import";
    card.innerHTML = '<div><span class="portal-eyebrow">SHARED WORKSPACE TEMPLATE</span><strong>' + esc(payload.name) + '</strong><small>' + payload.widgets.length + '種類のウィジェット配置 · ' + (payload.viewMode === "canvas" ? "自由配置" : "整列レイアウト") + '</small><p>このテンプレートには配置・サイズ・表示モードのみが含まれます。メモ、個人URL、RSS登録内容、アカウント情報は共有されません。</p></div><div class="portal-template-actions"><button type="button" class="portal-btn primary" data-template-import>新しいワークスペースとして追加</button><button type="button" class="portal-btn subtle" data-template-dismiss>閉じる</button></div>';
    var host = dash.querySelector(".portal-canvas-viewport") || dash.querySelector("#portal-dashboard-grid");
    if (host) host.insertAdjacentElement("beforebegin",card);
    else dash.appendChild(card);
  }

  function importSharedTemplate() {
    var a = getApi(), p = getPrefs(), payload = readIncomingTemplate();
    if (!a || !p || !payload || !p.dashboardWorkspaces) return;
    var workspaceLimit = 20;
    if (Object.keys(p.dashboardWorkspaces).length >= workspaceLimit) {
      a.toast("ワークスペースの上限（20個）に達しました");
      return;
    }
    captureWorkspace();
    var id = "custom_shared_" + Date.now();
    var snap = cloneSnapshot(payload);
    p.dashboardWorkspaces[id] = Object.assign({name:payload.name},snap);
    p.activeWorkspace = id;
    window.__kuroCanvasScroll = null;
    p.dashboardWidgets = snap.widgets;
    p.dashboardLayout = snap.layout;
    p.dashboardViewMode = snap.viewMode;
    p.dashboardSizes = snap.sizes;
    p.dashboardSpans = snap.spans;
    p.dashboardHeights = snap.heights;
    p.dashboardCanvasPositions = snap.positions;
    p.dashboardCanvasBounds = snap.bounds;
    p.dashboardCanvasZoom = snap.zoom;
    clearTemplateHash();
    saveAndRender("共有テンプレートを追加しました");
  }

  function decorateDashboard() {
    var a = getApi(), p = getPrefs();
    if (!a || !p) return;
    ensureWorkspaces();
    p = getPrefs();
    var dash = document.querySelector(".portal-dashboard-v2");
    var header = document.querySelector(".portal-header-inner");
    if (!dash) {
      if (header) {
        var staleBar = header.querySelector(".portal-workspace-bar");
        if (staleBar) staleBar.remove();
      }
      updateBadges();
      return;
    }
    var actions = document.querySelector(".portal-dashboard-toolbar .portal-dashboard-actions") || dash.querySelector(".portal-dashboard-actions");
    var bar = document.querySelector(".portal-workspace-bar");
    if (!bar && actions) {
      actions.insertAdjacentHTML("beforeend", workspaceBar(p));
      bar = actions.querySelector(".portal-workspace-bar");
    }
    if (bar && actions && bar.parentElement !== actions) {
      var editButton = actions.querySelector("#portal-dashboard-edit");
      if (editButton) editButton.insertAdjacentElement("afterend", bar);
      else actions.insertAdjacentElement("afterbegin", bar);
    }
    if (bar) {
      var activeId = p.activeWorkspace || "personal";
      bar.querySelectorAll("[data-workspace-switch]").forEach(function (button) {
        var active = button.dataset.workspaceSwitch === activeId;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }
    actions = document.querySelector(".portal-dashboard-toolbar .portal-dashboard-actions") || dash.querySelector(".portal-dashboard-actions");
    if (actions && !actions.querySelector("[data-open-quick]")) {
      var search = document.createElement("button");
      search.type = "button";
      search.className = "portal-btn portal-dashboard-search-button";
      search.setAttribute("data-open-quick", "true");
      search.textContent = "⌕ 検索";
      actions.insertBefore(search, actions.firstChild);
    }
    captureWorkspace();
    showTemplateImportCard();
    updateBadges();
  }

  function addThemeOptions() {
    var p = getPrefs();
    var select = document.getElementById("portal-theme");
    if (!select || !p) return;
    if (!select.querySelector('option[value="auto"]')) {
      var option = document.createElement("option");
      option.value = "auto";
      option.textContent = "システムに合わせる";
      select.appendChild(option);
    }
    select.value = p.theme || "light";
    if (!document.getElementById("portal-accent-swatches")) {
      var accent = document.getElementById("portal-accent");
      if (accent && accent.parentElement) {
        var swatches = document.createElement("div");
        swatches.id = "portal-accent-swatches";
        swatches.className = "portal-accent-swatches";
        swatches.innerHTML = [
          ["violet", "バイオレット", "#8b5cf6"],
          ["blue", "ブルー", "#087fbd"],
          ["green", "グリーン", "#15966d"],
          ["rose", "ローズ", "#db5475"],
          ["amber", "アンバー", "#c17a16"]
        ].map(function (x) {
          return '<button type="button" data-accent-choice="' + x[0] + '" title="' + x[1] + '" aria-label="' + x[1] +
            '" style="--swatch:' + x[2] + '"></button>';
        }).join("");
        var control = document.createElement("div");
        control.className = "portal-accent-control";
        accent.parentNode.insertBefore(control, accent);
        control.appendChild(accent);
        control.appendChild(swatches);
      }
    }
    var row = Array.from(document.querySelectorAll(".portal-settings-row")).find(function (x) { return !!x.querySelector("#portal-theme"); });
    if (row && !row.querySelector(".portal-theme-auto-note")) {
      var note = document.createElement("small");
      note.className = "portal-theme-auto-note";
      note.textContent = "PCやスマホ本体のライト・ダーク設定に自動で合わせることもできます。";
      var left = row.querySelector("div");
      if (left) left.appendChild(note);
      else row.appendChild(note);
    }
  }

  function updateViewportClass() {
    var width = window.innerWidth || document.documentElement.clientWidth;
    document.body.dataset.viewport = width <= 760 ? "mobile" : width <= 1120 ? "tablet" : "desktop";
  }

  function normalizeRetiredDashboardWidgets() {
    var a = getApi(), p = getPrefs(), s = getState();
    if (!a || !p) return false;
    var retired = { favorites: true, recent: true, achievements: true };
    var changed = false;
    function clean(list) {
      if (!Array.isArray(list)) return list;
      var next = list.filter(function (id) { return !retired[id]; });
      if (next.length !== list.length) changed = true;
      return next;
    }
    p.dashboardWidgets = clean(p.dashboardWidgets);
    Object.keys(p.dashboardWorkspaces || {}).forEach(function (id) {
      var workspace = p.dashboardWorkspaces[id];
      if (workspace && Array.isArray(workspace.widgets)) workspace.widgets = clean(workspace.widgets);
    });
    if (changed) {
      a.save();
      if (s && s.user && typeof a.sync === "function") a.sync(false);
    }
    return changed;
  }

  function updateMain() {
    if (!getApi()) return;
    decorateDashboard();
    var migrated = normalizeRetiredDashboardWidgets();
    if (migrated && pathNow() === "/" && typeof getApi().render === "function") getApi().render();
    addThemeOptions();
    updateBadges();
    updateViewportClass();
  }

  function startObserver() {
    var main = document.getElementById("portal-main");
    if (!main || observer) return;
    observer = new MutationObserver(function () {
      clearTimeout(captureTimer);
      captureTimer = setTimeout(updateMain, 90);
    });
    observer.observe(main, { childList: true, subtree: true });
  }

  function showMobileDrawer() {
    var drawer = document.getElementById("portal-mobile-drawer");
    if (drawer) {
      drawer.hidden = false;
      document.body.classList.add("portal-drawer-open");
    }
  }

  function hideMobileDrawer() {
    var drawer = document.getElementById("portal-mobile-drawer");
    if (drawer) {
      drawer.hidden = true;
      document.body.classList.remove("portal-drawer-open");
    }
  }

  function addCatalogItems() {
    var a = getApi();
    if (!a || !Array.isArray(a.catalog)) return;
    var more = [
      ["features", "KURO Labの機能", "サービスの機能とできること", "/features/", "✨", "機能 特徴 サービス"],
      ["developer", "開発者向け", "開発・運営に関する情報", "/developer/", "🛠️", "開発者 運営 開発"],
      ["contact", "お問い合わせ", "KURO Labへのお問い合わせ", "/contact/", "✉️", "問い合わせ サポート"],
      ["privacy", "プライバシー", "個人情報とデータの取り扱い", "/privacy/", "🔒", "プライバシー 個人情報"],
      ["terms", "利用規約", "KURO Labの利用ルール", "/terms/", "📄", "規約 ルール"],
      ["history", "閲覧履歴", "最近開いたページ", "/history/", "◷", "履歴 最近"],

      ["mypage", "マイページ", "アカウントと利用データ", "/mypage/", "◎", "アカウント ログイン"],
      ["settings", "表示設定", "テーマやホーム画面を変更", "/settings/", "⚙", "設定 テーマ"],
      ["theme-studio", "Theme Studio", "カラー・背景・UIを自由に編集", "/theme-studio/", "🎨", "テーマ デザイン"],
      ["request", "リクエストBOX", "機能や改善をリクエスト", "/request/", "💡", "提案 改善 リクエスト"]
    ];
    more.forEach(function (x) {
      if (!a.catalog.some(function (v) { return v.key === x[0]; })) {
        a.catalog.push({ key: x[0], type: "page", title: x[1], desc: x[2], href: x[3], icon: x[4], tags: x[5] });
      }
    });
  }

  window.addEventListener("kuro:canvas-layout-changed", function () {
    captureWorkspace();
    updateBadges();
  });
  window.addEventListener("kuro:portal-notifications-updated", updateBadges);

  document.addEventListener("click", function (event) {
    var toolboxToggle = event.target.closest("[data-toolbox-toggle]");
    var toolboxWrap = document.getElementById("portal-toolbox-menu-wrap");
    var toolboxMenu = document.getElementById("portal-toolbox-menu");
    if (toolboxToggle && toolboxMenu) {
      event.preventDefault();
      var opening = toolboxMenu.hidden;
      toolboxMenu.hidden = !opening;
      toolboxToggle.setAttribute("aria-expanded", String(opening));
      return;
    }
    if (toolboxMenu && toolboxWrap && !toolboxWrap.contains(event.target)) {
      toolboxMenu.hidden = true;
      var toolboxButton = toolboxWrap.querySelector("[data-toolbox-toggle]");
      if (toolboxButton) toolboxButton.setAttribute("aria-expanded", "false");
    }
    if (toolboxMenu && event.target.closest("#portal-toolbox-menu a")) {
      toolboxMenu.hidden = true;
      var menuButton = toolboxWrap && toolboxWrap.querySelector("[data-toolbox-toggle]");
      if (menuButton) menuButton.setAttribute("aria-expanded", "false");
    }
    var quick = event.target.closest("[data-open-quick]");
    if (quick) {
      event.preventDefault();
      openQuick();
      hideMobileDrawer();
      return;
    }
    if (event.target.closest("[data-mobile-open]")) {
      showMobileDrawer();
      return;
    }
    if (event.target.closest("[data-mobile-close]")) {
      hideMobileDrawer();
      return;
    }
    var sw = event.target.closest("[data-workspace-switch]");
    if (sw) {
      switchWorkspace(sw.dataset.workspaceSwitch);
      return;
    }
    var create = event.target.closest("[data-workspace-create]");
    if (create) {
      createWorkspace();
      return;
    }
    var del = event.target.closest("[data-workspace-delete]");
    if (del) {
      deleteWorkspace(del.dataset.workspaceDelete);
      return;
    }
    if (event.target.closest("[data-workspace-share]")) {
      shareCurrentWorkspace();
      return;
    }
    if (event.target.closest("[data-template-import]")) {
      importSharedTemplate();
      return;
    }
    if (event.target.closest("[data-template-dismiss]")) {
      clearTemplateHash();
      var importCard = document.getElementById("portal-template-import");
      if (importCard) importCard.remove();
      return;
    }
    var accent = event.target.closest("[data-accent-choice]");
    if (accent) {
      var select = document.getElementById("portal-accent");
      if (select) {
        select.value = accent.dataset.accentChoice;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      hideMobileDrawer();
      var toolboxMenu = document.getElementById("portal-toolbox-menu");
      var toolboxWrap = document.getElementById("portal-toolbox-menu-wrap");
      if (toolboxMenu) toolboxMenu.hidden = true;
      var toolboxButton = toolboxWrap && toolboxWrap.querySelector("[data-toolbox-toggle]");
      if (toolboxButton) toolboxButton.setAttribute("aria-expanded", "false");
    }
  });

  window.addEventListener("resize", updateViewportClass, { passive: true });
  if (window.matchMedia) {
    var scheme = window.matchMedia("(prefers-color-scheme: dark)");
    var applySystemTheme = function () { var p = getPrefs(), a = getApi(); if (p && p.theme === "auto" && a && a.applyDisplayPrefs) a.applyDisplayPrefs(); };
    if (scheme.addEventListener) scheme.addEventListener("change", applySystemTheme);
    else if (scheme.addListener) scheme.addListener(applySystemTheme);
  }
  window.addEventListener("kuro:portal-api-ready", function () {
    api = window.__kuroPortal || null;
    setupShell();
    startObserver();
    addCatalogItems();
    updateMain();
  });
  window.addEventListener("kuro:portal-rendered", function () {
    setupShell();
    updateMain();
  });
  window.addEventListener("kuro:announcements-updated", function () {
    updateBadges();
  });

  setupShell();
  updateViewportClass();
  if (window.__kuroPortal) {
    api = window.__kuroPortal;
    startObserver();
    addCatalogItems();
    updateMain();
  }



  // Keep vertical trackpad scrolling on the page when the pointer is over navigation or dashboard widgets.
  // Capture before nested widget scroll areas and interactive elements receive the wheel event.
  window.addEventListener("wheel", function (event) {
    if (event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    var target = event.target;
    if (target && target.nodeType !== 1) target = target.parentElement;
    if (!target || !target.closest) return;
    if (target.closest(".portal-canvas-viewport")) return;
    var tab = target.closest(
      ".portal-topnav, .portal-workspace-tabs, .portal-workspace-tab, .portal-workspace-create, .portal-workspace-delete, .portal-widget, .portal-widget-body"
    );
    if (!tab) return;

    var delta = Number(event.deltaY) || 0;
    if (!delta) return;
    if (event.deltaMode === 1) delta *= 16;
    else if (event.deltaMode === 2) delta *= Math.max(1, window.innerHeight);

    var root = document.scrollingElement || document.documentElement;
    var body = document.body;
    var maxScroll = Math.max(
      0,
      Math.max(root ? root.scrollHeight : 0, body ? body.scrollHeight : 0) - window.innerHeight
    );
    var current = Math.max(
      window.pageYOffset || 0,
      root ? root.scrollTop : 0,
      body ? body.scrollTop : 0
    );
    var next = Math.max(0, Math.min(maxScroll, current + delta));
    if (Math.abs(next - current) < 0.5) return;

    event.preventDefault();
    window.scrollTo(0, next);
  }, { capture: true, passive: false });

})();