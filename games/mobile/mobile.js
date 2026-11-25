"use strict";

(function () {
  const $ = id => document.getElementById(id);
  const SUPABASE_URL = "https://cprvpphlfpmiegjiutjn.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn";
  const CLOUDFLARE_PROXY_URL = "https://kurolab.cc.cd/api/cloudflare-relay";

  let db = null;
  let games = [];
  let activeCategory = "all";
  let deferredInstallPrompt = null;
  let accountFrameLoaded = false;
  let toastTimer = null;
  let favorites = [];

  const categoryNames = {
    typing: "タイピング", rpg: "RPG", action: "アクション", shooting: "シューティング",
    adventure: "アドベンチャー", simulation: "シミュレーション", strategy: "ストラテジー",
    puzzle: "パズル", sports: "スポーツ", racing: "レース", table: "テーブル",
    rhythm: "リズム・音楽", horror: "ホラー", sandbox: "サンドボックス",
    survival: "サバイバル", fighting: "格闘", party: "パーティー",
    casual: "カジュアル", education: "教育・学習", other: "その他"
  };

  function cloudflareClientId() {
    return "game-studio";
  }

  async function cloudflareFetch(input, init) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== SUPABASE_URL) return fetch(request);

    const bytes = new Uint8Array(await request.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
    }

    const headers = {};
    request.headers.forEach((value, key) => { headers[key] = value; });

    const response = await fetch(CLOUDFLARE_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: url.pathname + url.search,
        method: request.method,
        headers: headers,
        bodyBase64: bytes.length ? btoa(binary) : "",
        clientId: cloudflareClientId()
      })
    });

    let result;
    try {
      result = await response.json();
    } catch (_) {
      throw new Error("Cloudflare中継サーバーの応答を読み取れませんでした。");
    }

    if (!response.ok || !result || typeof result.status !== "number") {
      throw new Error(result && result.error || "Cloudflare中継通信に失敗しました。");
    }

    let body = null;
    if (result.isBinary && result.bodyBase64) {
      const raw = atob(result.bodyBase64);
      const output = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
      body = output;
    } else if (result.bodyText !== undefined && ![204, 205, 304].includes(result.status)) {
      body = result.bodyText;
    }

    return new Response(body, {
      status: result.status,
      headers: result.headers || { "Content-Type": "application/json" }
    });
  }

  function normalizeSearch(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s　・･_\-‐‑‒–—―]/g, "");
  }

  function isRetiredGame(game) {
    const id = String(game && game.id || "").toLowerCase();
    const title = String(game && game.title || "").normalize("NFKC").replace(/[\s_-]+/g, "").toLowerCase();
    return id === "kaiten-sushi-typing" ||
      id === "block-blast" ||
      ["回転寿司", "回転ずし", "かいてんずし", "ブロックブラスト", "blockblast"].some(name => title.includes(name));
  }

  function getCategories(game) {
    const categories = Array.isArray(game.categories) && game.categories.length
      ? game.categories
      : [game.category || "other"];
    return categories.map(value => String(value || "other")).filter(Boolean);
  }

  function categoryLabel(key) {
    return categoryNames[key] || key || "その他";
  }

  function showToast(message) {
    const toast = $("appToast");
    if (!toast) return;
    toast.textContent = String(message || "");
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  function setAccountState(user) {
    const state = $("accountState");
    const button = $("accountButton");
    if (!state || !button) return;

    if (!user || user.is_anonymous) {
      state.textContent = "ゲスト";
      button.textContent = "ログイン";
      button.setAttribute("aria-label", "KUROアカウントにログイン");
      return;
    }

    const metadata = user.user_metadata || {};
    const displayName = metadata.username || metadata.display_name || metadata.name || "";
    state.textContent = displayName ? String(displayName).slice(0, 16) : "ログイン中";
    button.textContent = "アカウント";
    button.setAttribute("aria-label", "KUROアカウントを開く");
  }

  async function refreshAccountState() {
    if (!db) return;
    try {
      const result = await db.auth.getSession();
      if (result.error) throw result.error;
      setAccountState(result.data && result.data.session ? result.data.session.user : null);
    } catch (error) {
      console.warn("[KURO GAMES MOBILE] account state unavailable:", error && error.message || error);
      setAccountState(null);
    }
  }

  function openAccount() {
    const overlay = $("accountOverlay");
    const frame = $("accountFrame");
    if (!overlay || !frame) return;
    overlay.hidden = false;
    document.body.classList.add("account-open");
    if (!accountFrameLoaded) {
      frame.src = "/games/?account=1";
      accountFrameLoaded = true;
    }
    $("closeAccountButton")?.focus();
  }

  function closeAccount() {
    const overlay = $("accountOverlay");
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove("account-open");
    refreshAccountState();
    $("accountButton")?.focus();
  }

  function renderCategories() {
    const host = $("categoryFilters");
    if (!host) return;

    const available = new Set();
    games.forEach(game => getCategories(game).forEach(category => available.add(category)));

    const order = Object.keys(categoryNames).filter(category => available.has(category));
    Array.from(available).filter(category => !order.includes(category)).sort().forEach(category => order.push(category));

    host.replaceChildren();
    const all = document.createElement("button");
    all.type = "button";
    all.className = "category-chip" + (activeCategory === "all" ? " is-active" : "");
    all.dataset.category = "all";
    all.textContent = "すべて";
    host.appendChild(all);

    order.forEach(category => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "category-chip" + (activeCategory === category ? " is-active" : "");
      button.dataset.category = category;
      button.textContent = categoryLabel(category);
      host.appendChild(button);
    });
  }

  function createGameCard(game) {
    const card = document.createElement("article");
    card.className = "game-card";

    const link = document.createElement("a");
    link.className = "game-link";
    link.href = "/games/mobile/play/?id=" + encodeURIComponent(game.id);
    link.setAttribute("aria-label", String(game.title || "ゲーム") + "をプレイ");

    const cover = document.createElement("div");
    cover.className = "game-cover";

    const category = document.createElement("span");
    category.className = "game-category";
    category.textContent = categoryLabel(getCategories(game)[0]);
    cover.appendChild(category);

    const iconValue = String(game.icon || "🎮").trim();
    if (/^(data:image\/|https?:\/\/)/i.test(iconValue)) {
      const image = document.createElement("img");
      image.src = iconValue;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      cover.appendChild(image);
    } else {
      const glyph = document.createElement("span");
      glyph.className = "game-glyph";
      glyph.textContent = iconValue || "🎮";
      cover.appendChild(glyph);
    }

    const info = document.createElement("div");
    info.className = "game-info";

    const title = document.createElement("strong");
    title.className = "game-title";
    title.textContent = String(game.title || "タイトル未設定");

    const description = document.createElement("p");
    description.className = "game-description";
    description.textContent = String(game.description || "タップしてゲームを開始").trim();

    const openLabel = document.createElement("div");
    openLabel.className = "game-open-label";
    const label = document.createElement("span");
    label.textContent = "PLAY NOW";
    const arrow = document.createElement("span");
    arrow.textContent = "↗";
    openLabel.append(label, arrow);

    info.append(title, description, openLabel);
    link.append(cover, info);

    const favorite = document.createElement("button");
    favorite.type = "button";
    favorite.className = "favorite-button";
    favorite.textContent = favorites.includes(game.id) ? "♥" : "♡";
    favorite.classList.toggle("is-favorite", favorites.includes(game.id));
    favorite.setAttribute("aria-label", favorites.includes(game.id) ? "お気に入りから削除" : "お気に入りに追加");
    favorite.addEventListener("click", function () {
      if (favorites.includes(game.id)) {
        favorites = favorites.filter(id => id !== game.id);
      } else {
        favorites = favorites.concat(game.id);
      }
      try { localStorage.setItem("kuroGamesFavorites", JSON.stringify(favorites)); } catch (_) {}
      renderGames();
    });

    card.append(link, favorite);
    return card;
  }

  function renderGames() {
    const host = $("gameGrid");
    const search = normalizeSearch($("gameSearch") && $("gameSearch").value);
    const empty = $("emptyState");
    const error = $("errorState");
    const count = $("gameCount");
    if (!host) return;

    if (error) error.hidden = true;
    const filtered = games.filter(game => {
      const categoryMatch = activeCategory === "all" || getCategories(game).includes(activeCategory);
      const words = [game.title, game.description].concat(Array.isArray(game.search_aliases) ? game.search_aliases : []);
      const searchMatch = !search || normalizeSearch(words.join(" ")).includes(search);
      return categoryMatch && searchMatch;
    });

    host.replaceChildren();
    filtered.forEach(game => host.appendChild(createGameCard(game)));

    if (empty) empty.hidden = filtered.length > 0;
    if (count) count.textContent = filtered.length + " GAMES";
  }

  async function loadGames() {
    const host = $("gameGrid");
    const errorBox = $("errorState");
    try {
      if (!db) throw new Error("データベース接続を初期化できませんでした。");

      const result = await db
        .from("game_studio_games")
        .select("id,title,description,category,categories,icon,search_aliases,published_at")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(60);

      if (result.error) throw result.error;
      games = (Array.isArray(result.data) ? result.data : []).filter(game => !isRetiredGame(game));
      renderCategories();
      renderGames();

      if (!games.length && host) {
        host.innerHTML = '<div class="loading-card"><strong>公開中のゲームはまだありません</strong><small>ゲームが公開されると、ここに表示されます。</small></div>';
      }
    } catch (error) {
      console.error("[KURO GAMES MOBILE] game list load failed:", error);
      if (host) host.replaceChildren();
      if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = "ゲーム一覧を読み込めませんでした。通信状態を確認して、ページを再読み込みしてください。";
      }
      if ($("gameCount")) $("gameCount").textContent = "OFFLINE";
    }
  }

  function setupInstall() {
    const button = $("installButton");
    if (!button) return;

    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault();
      deferredInstallPrompt = event;
      button.classList.add("can-install");
      button.setAttribute("aria-label", "KURO GAMESをインストール");
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      button.classList.remove("can-install");
      showToast("KURO GAMESをホーム画面に追加しました。");
    });

    button.addEventListener("click", async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice.catch(() => null);
        if (choice && choice.outcome === "accepted") showToast("インストールを開始しました。");
        deferredInstallPrompt = null;
        button.classList.remove("can-install");
        return;
      }

      const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (isAppleMobile) {
        showToast("Safariの共有ボタンから「ホーム画面に追加」を選んでください。");
      } else {
        showToast("ブラウザのメニューから「アプリをインストール」または「ホーム画面に追加」を選んでください。");
      }
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/games/mobile/sw.js", { scope: "/games/mobile/" })
        .catch(error => console.warn("[KURO GAMES MOBILE] service worker registration failed:", error));
    }, { once: true });
  }

  function loadFavorites() {
    try {
      const saved = JSON.parse(localStorage.getItem("kuroGamesFavorites") || "[]");
      favorites = Array.isArray(saved) ? saved : [];
    } catch (_) {
      favorites = [];
    }
  }

  function bindUI() {
    $("gameSearch")?.addEventListener("input", renderGames);
    $("categoryFilters")?.addEventListener("click", event => {
      const button = event.target.closest("button[data-category]");
      if (!button) return;
      activeCategory = button.dataset.category || "all";
      renderCategories();
      renderGames();
    });

    $("accountButton")?.addEventListener("click", openAccount);
    $("closeAccountButton")?.addEventListener("click", closeAccount);
    $("closeAccountBackdrop")?.addEventListener("click", closeAccount);
    $("accountOverlay")?.addEventListener("keydown", event => {
      if (event.key === "Escape") closeAccount();
    });

    document.querySelectorAll('.nav-item[href="#games"]').forEach(link => {
      link.addEventListener("click", () => {
        document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("is-current"));
        link.classList.add("is-current");
      });
    });
  }

  function init() {
    bindUI();
    loadFavorites();
    setupInstall();
    registerServiceWorker();

    if (window.supabase && typeof window.supabase.createClient === "function") {
      db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { fetch: cloudflareFetch },
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
      });
      db.auth.onAuthStateChange((_event, session) => setAccountState(session ? session.user : null));
      refreshAccountState();
    }

    loadGames();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();