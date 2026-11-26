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
  let accountRefreshPromise = null;
  let gamesLoadPromise = null;
  let toastTimer = null;
  let favorites = [];
  const CATALOG_CACHE_KEY = "kurogames_mobile_catalog_v1";
  const CATALOG_CACHE_MAX_AGE = 14 * 24 * 60 * 60 * 1000;

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

  function setNetworkState(state) {
    const host = $("networkState");
    if (!host) return;
    const labels = {
      online: "接続中",
      connecting: "接続確認中",
      retrying: "再接続中",
      unstable: "通信不安定",
      offline: "オフライン"
    };
    host.dataset.state = state;
    const label = host.querySelector("span");
    if (label) label.textContent = labels[state] || labels.connecting;
  }

  function waitForRetry(delay, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(signal.reason || new Error("通信が中断されました。"));
        return;
      }
      const timer = window.setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, delay);
      function onAbort() {
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(signal.reason || new Error("通信が中断されました。"));
      }
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  async function cloudflareFetch(input, init) {
    const request = input instanceof Request
      ? (init ? new Request(input, init) : input)
      : new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== SUPABASE_URL) return fetch(request);

    const method = request.method.toUpperCase();
    const retryableRead = method === "GET" || method === "HEAD";
    const maxAttempts = retryableRead ? 2 : 1;

    if (navigator.onLine === false) {
      setNetworkState("offline");
      throw new TypeError("インターネットに接続されていません。");
    }

    // Read a clone so the original request remains intact for Supabase's caller.
    const bytes = new Uint8Array(await request.clone().arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
    }

    const headers = {};
    request.headers.forEach((value, key) => { headers[key] = value; });

    const relayBody = JSON.stringify({
      path: url.pathname + url.search,
      method: method,
      headers: headers,
      bodyBase64: bytes.length ? btoa(binary) : "",
      clientId: cloudflareClientId()
    });

    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      const abortFromCaller = () => controller.abort(
        request.signal.reason || new Error("通信が中断されました。")
      );
      request.signal.addEventListener("abort", abortFromCaller, { once: true });
      const timeoutId = window.setTimeout(
        () => controller.abort(new Error("Cloudflare中継がタイムアウトしました。")),
        15000
      );

      try {
        const relayResponse = await fetch(CLOUDFLARE_PROXY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: relayBody,
          cache: "no-store",
          credentials: "omit",
          signal: controller.signal
        });

        let result;
        try {
          result = await relayResponse.json();
        } catch (_) {
          throw new Error("Cloudflare中継サーバーの応答を読み取れませんでした。");
        }

        if (!relayResponse.ok || !result || typeof result.status !== "number") {
          const canRetry = retryableRead &&
            attempt + 1 < maxAttempts &&
            [502, 503, 504].includes(relayResponse.status);
          if (canRetry) {
            setNetworkState("retrying");
            await waitForRetry(250 * (attempt + 1), request.signal);
            continue;
          }
          throw new Error(result && result.error || "Cloudflare中継通信に失敗しました。");
        }

        if (retryableRead && attempt + 1 < maxAttempts &&
            [502, 503, 504].includes(result.status)) {
          setNetworkState("retrying");
          await waitForRetry(250 * (attempt + 1), request.signal);
          continue;
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

        setNetworkState(result.status >= 500 ? "unstable" : "online");
        return new Response(body, {
          status: result.status,
          headers: result.headers || { "Content-Type": "application/json" }
        });
      } catch (error) {
        lastError = error;
        const callerCancelled = request.signal.aborted;
        if (callerCancelled) throw error;
        const mayRetry = retryableRead &&
          attempt + 1 < maxAttempts &&
          !callerCancelled &&
          navigator.onLine !== false;

        if (mayRetry) {
          setNetworkState("retrying");
          await waitForRetry(250 * (attempt + 1), request.signal);
          continue;
        }

        setNetworkState(navigator.onLine === false ? "offline" : "unstable");
        throw error;
      } finally {
        window.clearTimeout(timeoutId);
        request.signal.removeEventListener("abort", abortFromCaller);
      }
    }

    setNetworkState(navigator.onLine === false ? "offline" : "unstable");
    throw lastError || new Error("Cloudflare中継通信に失敗しました。");
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

  function refreshAccountState() {
    if (!db) return Promise.resolve();
    if (accountRefreshPromise) return accountRefreshPromise;

    accountRefreshPromise = (async () => {
      try {
        const result = await db.auth.getSession();
        if (result.error) throw result.error;
        setAccountState(result.data && result.data.session ? result.data.session.user : null);
      } catch (error) {
        console.warn("[KURO GAMES MOBILE] account state unavailable:", error && error.message || error);
        setAccountState(null);
      }
    })().finally(() => {
      accountRefreshPromise = null;
    });

    return accountRefreshPromise;
  }

  function openAccount() {
    // The KURO GAMES page sends X-Frame-Options: deny, so it cannot be embedded
    // in this app's account iframe. Open the account page as a top-level page.
    location.assign("/games/");
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

    if (empty) empty.hidden = games.length === 0 || filtered.length > 0;
    if (count) count.textContent = filtered.length + " GAMES";
  }

  function readCachedCatalog() {
    try {
      const saved = JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY) || "null");
      if (!saved || !Array.isArray(saved.games) || !Number.isFinite(Number(saved.savedAt))) return null;
      if (Date.now() - Number(saved.savedAt) > CATALOG_CACHE_MAX_AGE) return null;
      return saved.games.filter(game => game && typeof game.id === "string" && !isRetiredGame(game));
    } catch (_) {
      return null;
    }
  }

  function saveCatalogCache(list) {
    try {
      const safeGames = list.map(game => ({
        id: game.id,
        title: String(game.title || "").slice(0, 120),
        description: String(game.description || "").slice(0, 500),
        category: game.category || "other",
        categories: getCategories(game).slice(0, 8),
        icon: /^data:image\//i.test(String(game.icon || "")) ? "🎮" : String(game.icon || "🎮").slice(0, 500),
        search_aliases: Array.isArray(game.search_aliases) ? game.search_aliases.slice(0, 40) : [],
        published_at: game.published_at || null
      }));
      localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        games: safeGames
      }));
    } catch (error) {
      console.debug("[KURO GAMES MOBILE] catalog cache skipped:", error && error.message || error);
    }
  }

  function renderCachedCatalog(message) {
    const cached = readCachedCatalog();
    if (!cached || !cached.length) return false;

    games = cached;
    renderCategories();
    renderGames();

    const errorBox = $("errorState");
    if (errorBox) {
      errorBox.hidden = false;
      errorBox.textContent = message || "通信できないため、前回取得したゲーム一覧を表示しています。";
    }
    if ($("gameCount")) $("gameCount").textContent = games.length + " SAVED";
    return true;
  }

  function loadGames() {
    if (gamesLoadPromise) return gamesLoadPromise;

    gamesLoadPromise = (async () => {
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
        saveCatalogCache(games);
        renderCategories();
        renderGames();
        if (errorBox) errorBox.hidden = true;

        if (!games.length && host) {
          host.innerHTML = '<div class="loading-card"><strong>公開中のゲームはまだありません</strong><small>ゲームが公開されると、ここに表示されます。</small></div>';
        }
      } catch (error) {
        console.error("[KURO GAMES MOBILE] game list load failed:", error);
        const restored = renderCachedCatalog(
          navigator.onLine === false
            ? "オフラインのため、保存済みのゲーム一覧を表示しています。"
            : "通信が不安定なため、保存済みのゲーム一覧を表示しています。"
        );
        if (!restored && host) host.replaceChildren();

        if (!restored && errorBox) {
          errorBox.hidden = false;
          errorBox.textContent = "ゲーム一覧を読み込めませんでした。通信状態を確認して、もう一度お試しください。";
        }
        if ($("gameCount")) $("gameCount").textContent = restored ? games.length + " SAVED" : "OFFLINE";
        setNetworkState(navigator.onLine === false ? "offline" : "unstable");
      }
    })().finally(() => {
      gamesLoadPromise = null;
    });

    return gamesLoadPromise;
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

    window.addEventListener("offline", () => {
      setNetworkState("offline");
      showToast("インターネット接続が切断されました。");
    });
    window.addEventListener("online", () => {
      setNetworkState("connecting");
      showToast("ネットワークに再接続しました。");
      refreshAccountState();
      loadGames();
    });

    document.querySelectorAll('.nav-item[href="#games"]').forEach(link => {
      link.addEventListener("click", () => {
        document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("is-current"));
        link.classList.add("is-current");
      });
    });
  }

  function init() {
    setNetworkState(navigator.onLine === false ? "offline" : "connecting");
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