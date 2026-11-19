(function () {
"use strict";

const DEFAULT_URL = "https://cprvpphlfpmiegjiutjn.supabase.co";
const DEFAULT_KEY = "sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn";
const FUNCTION_NAME = "kurogames-online";

let gameId = null;
let gameConfig = null;
let requestCounter = 0;
let realtimeClientPromise = null;

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


function loadRealtimeClient() {
  if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
  if (realtimeClientPromise) return realtimeClientPromise;
  realtimeClientPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    script.async = true;
    script.onload = () => {
      if (window.supabase && window.supabase.createClient) resolve(window.supabase);
      else reject(new Error("Realtimeライブラリを読み込めませんでした。"));
    };
    script.onerror = () => reject(new Error("Realtimeライブラリの読み込みに失敗しました。"));
    document.head.appendChild(script);
  });
  return realtimeClientPromise;
}

async function connectRoom(roomData, members) {
  const session = await requestParentSession();
  if (!session.accessToken || !session.user || !session.user.id) {
    throw new Error("KUROアカウントの認証情報を取得できませんでした。");
  }
  const library = await loadRealtimeClient();
  const client = library.createClient(DEFAULT_URL, DEFAULT_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  client.realtime.setAuth(session.accessToken);
  const topic = "kurogame:" + gameId + ":" + roomData.id;
  const channel = client.channel(topic, {
    config: {
      private: true,
      broadcast: { ack: false, self: false },
      presence: { key: session.user.id },
    },
  });
  const messageCallbacks = new Set();
  const playerCallbacks = new Set();
  let active = true;
  let refreshTimer = null;
  let cachedPlayers = [];

  function readPlayers() {
    const state = channel.presenceState();
    const all = [];
    Object.keys(state || {}).forEach((key) => (state[key] || []).forEach((entry) => all.push(entry)));
    const unique = new Map();
    all.forEach((entry) => { if (entry && entry.userId) unique.set(entry.userId, entry); });
    cachedPlayers = Array.from(unique.values());
    playerCallbacks.forEach((callback) => {
      try { callback(cachedPlayers.slice()); } catch (error) { console.error(error); }
    });
  }

  channel
    .on("broadcast", { event: "game-event" }, (message) => {
      const payload = message && message.payload;
      messageCallbacks.forEach((callback) => {
        try { callback(payload); } catch (error) { console.error(error); }
      });
    })
    .on("presence", { event: "sync" }, readPlayers);

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("ルームへの接続がタイムアウトしました。")), 15000);
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearTimeout(timeout);
        reject(error || new Error("ルームに接続できませんでした: " + status));
      }
    });
  });

  const metadata = session.user.user_metadata || {};
  const ownMember = (members || []).find((member) => member.userId === session.user.id);
  const displayName = (ownMember && ownMember.user && ownMember.user.display_name) ||
    metadata.display_name || metadata.username || "プレイヤー";
  await channel.track({
    userId: session.user.id,
    displayName: String(displayName).slice(0, 40),
    joinedAt: new Date().toISOString(),
  });
  readPlayers();

  refreshTimer = setInterval(async () => {
    if (!active) return;
    try {
      const latest = await requestParentSession();
      if (latest.accessToken) client.realtime.setAuth(latest.accessToken);
      await invoke("room_heartbeat", { roomId: roomData.id });
    } catch (error) { console.warn("KUROGAMES room heartbeat:", error); }
  }, 30000);

  return {
    room: roomData,
    members: members || [],
    getPlayers() { return cachedPlayers.slice(); },
    onPlayersChange(callback) {
      if (typeof callback !== "function") return function () {};
      playerCallbacks.add(callback);
      callback(cachedPlayers.slice());
      return function () { playerCallbacks.delete(callback); };
    },
    onMessage(callback) {
      if (typeof callback !== "function") return function () {};
      messageCallbacks.add(callback);
      return function () { messageCallbacks.delete(callback); };
    },
    async send(type, data) {
      if (!active) throw new Error("このルームから退出済みです。");
      if (typeof type !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(type)) {
        throw new TypeError("イベント名は英数字・_・-の40文字以内で指定してください。");
      }
      const payload = { type: type, data: data, from: session.user.id, sentAt: Date.now() };
      if (new TextEncoder().encode(JSON.stringify(payload)).length > 32768) {
        throw new TypeError("1回の通信データは32KB以内にしてください。");
      }
      const result = await channel.send({ type: "broadcast", event: "game-event", payload: payload });
      if (result !== "ok") throw new Error("ゲームデータを送信できませんでした。");
      return true;
    },
    async leave() {
      if (!active) return;
      active = false;
      if (refreshTimer) clearInterval(refreshTimer);
      try { await channel.untrack(); } catch (_) {}
      try { await client.removeChannel(channel); } catch (_) {}
      try { await invoke("room_leave", { roomId: roomData.id }); } catch (error) { console.warn(error); }
    },
  };
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

  multiplayer: {
    async listRooms() {
      const result = await invoke("room_list");
      return result.rooms || [];
    },
    async createRoom(options) {
      options = options || {};
      const result = await invoke("room_create", { maxPlayers: options.maxPlayers || 4 });
      return connectRoom(result.room, result.members);
    },
    async joinRoom(roomCode) {
      const result = await invoke("room_join", { roomCode: roomCode });
      return connectRoom(result.room, result.members);
    },
  },

  async refreshConfig() {
    gameConfig = await invoke("get_config");
    return gameConfig;
  },
};

window.KuroGames = KuroGames;
})();