(function () {
"use strict";

const DEFAULT_URL = "https://cprvpphlfpmiegjiutjn.supabase.co";
const DEFAULT_KEY = "sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn";
const FUNCTION_NAME = "kurogames-online";

let gameId = null;
let gameConfig = null;
let requestCounter = 0;

function ensureReady() {
  if (!gameId) throw new Error("先に KuroGames.init({ gameId }) を実行してください。");
}

function requestParentSession() {
  if (window.parent === window) {
    return Promise.reject(new Error("KUROGAMESのゲームプレイヤーまたはスタジオプレビュー内で実行してください。"));
  }
  const requestId = "kuro-online-" + Date.now().toString(36) + "-" + (++requestCounter);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("KUROGAMES認証ブリッジが応答しません。ゲームプレイヤーから起動してください。"));
    }, 12000);
    function onMessage(event) {
      if (event.source !== window.parent || !event.data || event.data.requestId !== requestId) return;
      if (event.data.type === "kuro-online-auth-error") {
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        reject(new Error(event.data.message || "KUROGAMES認証に失敗しました。"));
        return;
      }
      if (event.data.type !== "kuro-online-auth") return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve({ accessToken: event.data.access_token, user: event.data.user || null });
    }
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "kuro-online-auth-request", requestId }, "*");
  });
}

async function invoke(action, params) {
  ensureReady();
  const session = await requestParentSession();
  if (!session.accessToken) throw new Error("KUROアカウントの認証情報を取得できませんでした。");
  const response = await fetch(DEFAULT_URL + "/functions/v1/" + FUNCTION_NAME, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": DEFAULT_KEY,
      "Authorization": "Bearer " + session.accessToken,
    },
    body: JSON.stringify(Object.assign({ action: action, gameId: gameId }, params || {})),
  });
  let data;
  try { data = await response.json(); }
  catch (_) { throw new Error("KUROGAMES ONLINEから正しい応答を受け取れませんでした。"); }
  if (!response.ok || data.error) throw new Error(data.error || "KUROGAMES ONLINEとの通信に失敗しました。");
  return data;
}

const KuroGames = {
  async init(options) {
    options = options || {};
    const nextGameId = options.gameId;
    if (typeof nextGameId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nextGameId)) {
      throw new Error("gameIdが正しくありません。Studioのオンライン設定画面からコピーしてください。");
    }
    gameId = nextGameId;
    gameConfig = await invoke("get_config");
    return { gameId: gameId, game: gameConfig.game, features: gameConfig.features };
  },

  get config() { return gameConfig; },

  auth: {
    async getUser() {
      ensureReady();
      const session = await requestParentSession();
      return session.user;
    },
    onChange(callback) {
      if (typeof callback !== "function") return function () {};
      let active = true;
      let previous = null;
      const poll = async function () {
        if (!active) return;
        try {
          const session = await requestParentSession();
          const current = session.user && session.user.id || null;
          if (current !== previous) {
            previous = current;
            callback({ event: "USER_CHANGED", user: session.user });
          }
        } catch (_) {}
      };
      void poll();
      const timer = setInterval(poll, 30000);
      return function () { active = false; clearInterval(timer); };
    },
  },

  ranking: {
    async submit(score, options) {
      options = options || {};
      if (!Number.isSafeInteger(Number(score))) throw new TypeError("scoreは整数で指定してください。");
      return invoke("score_submit", {
        score: Number(score),
        mode: options.mode || "default",
        metadata: options.metadata || {},
        submissionId: crypto.randomUUID(),
      });
    },
    async get(options) {
      options = options || {};
      const result = await invoke("leaderboard", {
        mode: options.mode || "default",
        limit: options.limit || 20,
      });
      return result.scores || [];
    },
  },

  save: {
    async get(key) {
      const result = await invoke("save_get", { key: key || "default" });
      return result.value;
    },
    async set(key, value) {
      return invoke("save_set", { key: key || "default", value: value });
    },
    async delete(key) {
      return invoke("save_delete", { key: key || "default" });
    },
  },

  async refreshConfig() {
    gameConfig = await invoke("get_config");
    return gameConfig;
  },
};

window.KuroGames = KuroGames;
})();