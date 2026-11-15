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
    { label: "マイライブラリ", items: [
      { href: "/favorites/", label: "お気に入り", icon: "☆" },
      { href: "/history/", label: "閲覧履歴", icon: "◷" },
      { href: "/achievements/", label: "実績", icon: "✧" }
    ] },
    { label: "お知らせ", items: [
      { href: "/notifications/", label: "お知らせ一覧", icon: "♧", badge: true }
    ] },
    { label: "アカウント", items: [
      { href: "/mypage/", label: "KURO ID", icon: "◎" },
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
    var read = s.data.preferences.readAnnouncements;
    read = Array.isArray(read) ? read : [];
    var readSet = new Set(read);
    return (s.ann || []).filter(function (item) {
      return item && item.id && !readSet.has(item.id);
    }).length;
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
    if (!header || document.getElementById("portal-notification-button")) return;
    var button = document.createElement("a");
    button.id = "portal-notification-button";
    button.className = "portal-notification-button";
    button.href = "/notifications/";
    button.setAttribute("aria-label", "お知らせ");
    button.innerHTML = '<span>♧</span><i class="portal-notification-badge" hidden></i>';
    var account = document.getElementById("portal-account-button");
    header.insertBefore(button, account || null);
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
    document.querySelectorAll(".portal-sidebar-badge,.portal-notification-badge").forEach(function (el) {
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

  function markAnnouncementsRead() {
    var a = getApi(), s = getState(), p = getPrefs();
    if (!a || !s || !p || !Array.isArray(s.ann) || !s.ann.length) return;
    var ids = s.ann.map(function (x) { return x && x.id; }).filter(Boolean);
    if (!ids.length) return;
    var old = Array.isArray(p.readAnnouncements) ? p.readAnnouncements : [];
    var next = Array.from(new Set(old.concat(ids))).slice(-300);
    if (next.length === old.length && next.every(function (x, i) { return x === old[i]; })) return;
    p.readAnnouncements = next;
    a.save();
    if (s.user && typeof a.sync === "function") {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(function () { a.sync(false); }, 250);
    }
    updateBadges();
  }

  function snapshotCurrent() {
    var p = getPrefs();
    if (!p) return null;
    return {
      widgets: Array.isArray(p.dashboardWidgets) ? p.dashboardWidgets.slice() : [],
      layout: p.dashboardLayout || "balanced",
      sizes: JSON.parse(JSON.stringify(p.dashboardSizes || {})),
      spans: JSON.parse(JSON.stringify(p.dashboardSpans || {})),
      heights: JSON.parse(JSON.stringify(p.dashboardHeights || {}))
    };
  }

  function cloneSnapshot(x) {
    return {
      widgets: Array.isArray(x && x.widgets) ? x.widgets.slice() : ["shortcuts", "games", "favorites", "activity", "recent", "achievements", "clock"],
      layout: x && ["balanced", "three", "single"].indexOf(x.layout) >= 0 ? x.layout : "balanced",
      sizes: JSON.parse(JSON.stringify(x && x.sizes || {})),
      spans: JSON.parse(JSON.stringify(x && x.spans || {})),
      heights: JSON.parse(JSON.stringify(x && x.heights || {}))
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
        name: "ゲーム", widgets: ["games", "shortcuts", "recent", "achievements", "clock"],
        layout: "balanced", sizes: { games: "wide", shortcuts: "half", recent: "half", achievements: "half", clock: "small" }, spans: {}, heights: {}
      },
      creation: {
        name: "制作・開発", widgets: ["shortcuts", "custom", "favorites", "activity", "recent", "clock"],
        layout: "balanced", sizes: { shortcuts: "half", custom: "wide", favorites: "half", activity: "half", recent: "half", clock: "small" }, spans: {}, heights: {}
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
    var w = p.dashboardWorkspaces[id];
    p.activeWorkspace = id;
    var snap = cloneSnapshot(w);
    p.dashboardWidgets = snap.widgets;
    p.dashboardLayout = snap.layout;
    p.dashboardSizes = snap.sizes;
    p.dashboardSpans = snap.spans;
    p.dashboardHeights = snap.heights;
    saveAndRender(w.name + "に切り替えました");
  }

  function createWorkspace() {
    var a = getApi(), p = getPrefs();
    if (!a || !p || !p.dashboardWorkspaces) return;
    if (Object.keys(p.dashboardWorkspaces).length >= 6) {
      a.toast("ワークスペースは最大6個まで作成できます");
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
      var personal = p.dashboardWorkspaces.personal || { widgets: ["shortcuts", "games", "favorites", "activity", "recent", "achievements", "clock"], layout: "balanced", sizes: {}, spans: {}, heights: {} };
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
      items + '<button type="button" class="portal-workspace-create" data-workspace-create aria-label="ワークスペースを追加">＋</button></div></div>';
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
    var bar = document.querySelector(".portal-workspace-bar");
    if (!bar) {
      if (header) {
        var account = header.querySelector("#portal-account-button");
        var notice = header.querySelector("#portal-notification-button");
        var anchor = notice || account;
        if (anchor) anchor.insertAdjacentHTML("beforebegin", workspaceBar(p));
        else header.insertAdjacentHTML("beforeend", workspaceBar(p));
      }
    } else if (header && bar.parentElement !== header) {
      var accountAnchor = header.querySelector("#portal-notification-button") || header.querySelector("#portal-account-button");
      if (accountAnchor) accountAnchor.insertAdjacentElement("beforebegin", bar);
      else header.appendChild(bar);
    }
    bar = document.querySelector(".portal-header-inner .portal-workspace-bar") || document.querySelector(".portal-workspace-bar");
    if (bar) {
      var activeId = p.activeWorkspace || "personal";
      bar.querySelectorAll("[data-workspace-switch]").forEach(function (button) {
        var active = button.dataset.workspaceSwitch === activeId;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }
    var actions = dash.querySelector(".portal-dashboard-actions");
    if (actions && !actions.querySelector("[data-open-quick]")) {
      var search = document.createElement("button");
      search.type = "button";
      search.className = "portal-btn portal-dashboard-search-button";
      search.setAttribute("data-open-quick", "true");
      search.textContent = "⌕ 検索";
      actions.insertBefore(search, actions.firstChild);
    }
    captureWorkspace();
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

  function updateMain() {
    if (!getApi()) return;
    decorateDashboard();
    addThemeOptions();
    updateBadges();
    if (pathNow() === "/notifications/") markAnnouncementsRead();
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
      ["favorites", "お気に入り", "保存したページやゲーム", "/favorites/", "☆", "お気に入り 保存"],
      ["history", "閲覧履歴", "最近開いたページ", "/history/", "◷", "履歴 最近"],
      ["notifications", "お知らせ", "KURO Labからの更新情報", "/notifications/", "♧", "お知らせ 更新 通知"],
      ["mypage", "マイページ", "アカウントと利用データ", "/mypage/", "◎", "アカウント ログイン"],
      ["settings", "表示設定", "テーマやホーム画面を変更", "/settings/", "⚙", "設定 テーマ"],
      ["achievements", "実績", "利用状況と達成記録", "/achievements/", "🏅", "実績 記録"],
      ["request", "リクエストBOX", "機能や改善をリクエスト", "/request/", "💡", "提案 改善 リクエスト"]
    ];
    more.forEach(function (x) {
      if (!a.catalog.some(function (v) { return v.key === x[0]; })) {
        a.catalog.push({ key: x[0], type: "page", title: x[1], desc: x[2], href: x[3], icon: x[4], tags: x[5] });
      }
    });
  }

  document.addEventListener("click", function (event) {
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
    var accent = event.target.closest("[data-accent-choice]");
    if (accent) {
      var select = document.getElementById("portal-accent");
      if (select) {
        select.value = accent.dataset.accentChoice;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }
    if (event.target.closest('a[href="/notifications/"]')) {
      markAnnouncementsRead();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") hideMobileDrawer();
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
    if (pathNow() === "/notifications/") markAnnouncementsRead();
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