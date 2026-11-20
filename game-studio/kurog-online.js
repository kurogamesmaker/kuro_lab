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
      resolve({ accessToken: event.data.access_token, user: event.data.user || null, useGasProxy: event.data.useGasProxy === true });
    }
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "kuro-online-auth-request", requestId }, "*");
  });
}

async function invoke(action, params) {
  ensureReady();
  const session = await requestParentSession();
  if (!session.accessToken) throw new Error("KUROアカウントの認証情報を取得できませんでした。");
  const path = "/functions/v1/" + FUNCTION_NAME;
  const headers = { "Content-Type": "application/json", "apikey": DEFAULT_KEY, "Authorization": "Bearer " + session.accessToken };
  const body = JSON.stringify(Object.assign({ action: action, gameId: gameId }, params || {}));
  let status, text;
  if (session.useGasProxy) {
    const result = await parentGasRequest(path, "POST", headers, body);
    status = result.status; text = result.text;
  } else {
    const response = await fetch(DEFAULT_URL + path, { method: "POST", headers, body });
    status = response.status; text = await response.text();
  }
  let data;
  try { data = JSON.parse(text); }
  catch (_) { throw new Error("KUROGAMES ONLINEから正しい応答を受け取れませんでした。"); }
  if (status < 200 || status >= 300 || data.error) throw new Error(data.error || "KUROGAMES ONLINEとの通信に失敗しました。");
  return data;
}



function encodeBase64(text) { return btoa(unescape(encodeURIComponent(text))); }
function decodeBase64(text) { return decodeURIComponent(escape(atob(text))); }
function parentGasRequest(path, method, headers, bodyText) {
  const requestId = "kuro-online-proxy-" + Date.now().toString(36) + "-" + (++requestCounter);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { window.removeEventListener("message", onMessage); reject(new Error("GAS中継がタイムアウトしました。")); }, 30000);
    function onMessage(event) {
      if (event.source !== window.parent || !event.data || event.data.requestId !== requestId || event.data.type !== "kuro-online-proxy-response") return;
      clearTimeout(timer); window.removeEventListener("message", onMessage);
      if (event.data.error) { reject(new Error(event.data.error)); return; }
      const result = event.data.response || {};
      let text = ""; try { text = result.bodyBase64 ? decodeBase64(result.bodyBase64) : ""; } catch (_) { reject(new Error("GAS応答を読み取れませんでした。")); return; }
      resolve({ status: Number(result.status) || 502, ok: Number(result.status) >= 200 && Number(result.status) < 300, text });
    }
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "kuro-online-proxy-request", requestId, path, method, headers, bodyBase64: bodyText ? encodeBase64(bodyText) : "" }, "*");
  });
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


async function connectRoomPolling(roomData, members, session) {
  const messageCallbacks = new Set(); const playerCallbacks = new Set();
  let active = true; let afterId = null; let timer = null; let busy = false; let cachedPlayers = [];
  function emitPlayers(next) {
    cachedPlayers = (next || []).map((m) => ({ userId: m.userId, kuroId: m.user && m.user.kuroId || null, displayName: m.user && m.user.display_name || "プレイヤー", joinedAt: m.joinedAt }));
    playerCallbacks.forEach((cb) => { try { cb(cachedPlayers.slice()); } catch (e) { console.error(e); } });
  }
  async function poll() {
    if (!active || busy) return; busy = true;
    try {
      const result = await invoke("room_poll", { roomId: roomData.id, afterId });
      emitPlayers(result.members || []);
      if (result.cursor !== undefined && afterId === null) afterId = Number(result.cursor) || 0;
      (result.messages || []).forEach((message) => {
        const id = Number(message.id); if (Number.isSafeInteger(id)) afterId = Math.max(afterId, id);
        if (message.from === session.user.id) return;
        messageCallbacks.forEach((cb) => { try { cb({ type: message.type, data: message.data, from: message.from, sentAt: new Date(message.sentAt).getTime() }); } catch (e) { console.error(e); } });
      });
      if (result.roomStatus === "closed") { active = false; if (timer) clearInterval(timer); }
    } catch (error) { console.warn("KUROGAMES GAS multiplayer poll:", error); }
    finally { busy = false; }
  }
  emitPlayers(members || []); await poll(); timer = setInterval(poll, 1400);
  return {
    room: roomData, members: members || [], getPlayers() { return cachedPlayers.slice(); },
    async getState() {
      return invoke("room_state_get", { roomId: roomData.id });
    },
    async updateState(state, expectedUpdatedAt) {
      const result = await invoke("room_state_update", {
        roomId: roomData.id,
        state: state,
        expectedUpdatedAt: expectedUpdatedAt || null,
      });
      if (!result.conflict) {
        const notification = {
          type: "room-state-updated",
          data: { updatedAt: result.updatedAt || null },
          from: session.user.id,
          sentAt: Date.now(),
        };
        messageCallbacks.forEach((callback) => {
          try { callback(notification); } catch (error) { console.error(error); }
        });
        await this.send("room-state-updated", { updatedAt: result.updatedAt || null });
      }
      return result;
    },
    onPlayersChange(callback) { if (typeof callback !== "function") return () => {}; playerCallbacks.add(callback); callback(cachedPlayers.slice()); return () => playerCallbacks.delete(callback); },
    onMessage(callback) { if (typeof callback !== "function") return () => {}; messageCallbacks.add(callback); return () => messageCallbacks.delete(callback); },
    async send(type, data) {
      if (!active) throw new Error("このルームから退出済みです。");
      if (typeof type !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(type)) throw new TypeError("イベント名は英数字・_・-の40文字以内で指定してください。");
      if (new TextEncoder().encode(JSON.stringify(data)).length > 32768) throw new TypeError("1回の通信データは32KB以内にしてください。");
      await invoke("room_send", { roomId: roomData.id, eventType: type, payload: data });
      return true;
    },
    async leave() { if (!active) return; active = false; if (timer) clearInterval(timer); try { await invoke("room_leave", { roomId: roomData.id }); } catch (e) { console.warn(e); } }
  };
}

async function connectRoom(roomData, members) {
  const session = await requestParentSession();
  if (!session.accessToken || !session.user || !session.user.id) {
    throw new Error("KUROアカウントの認証情報を取得できませんでした。");
  }
  // Cloudflare HTTP relay is the only transport; never open a direct Supabase Realtime WebSocket.
  return connectRoomPolling(roomData, members, session);
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
    kuroId: ownMember && ownMember.user && ownMember.user.kuroId || null,
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
    async getState() {
      return invoke("room_state_get", { roomId: roomData.id });
    },
    async updateState(state, expectedUpdatedAt) {
      const result = await invoke("room_state_update", {
        roomId: roomData.id,
        state: state,
        expectedUpdatedAt: expectedUpdatedAt || null,
      });
      if (!result.conflict) {
        const notification = {
          type: "room-state-updated",
          data: { updatedAt: result.updatedAt || null },
          from: session.user.id,
          sentAt: Date.now(),
        };
        messageCallbacks.forEach((callback) => {
          try { callback(notification); } catch (error) { console.error(error); }
        });
        await this.send("room-state-updated", { updatedAt: result.updatedAt || null });
      }
      return result;
    },
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
    async getProfile() {
      const result = await invoke("profile_me");
      return result.profile || null;
    },
    async getKuroId() {
      const result = await invoke("profile_me");
      return result.profile && result.profile.kuroId || null;
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
    async list(options) {
      options = options || {};
      const result = await invoke("save_list", { limit: options.limit || 100 });
      return result.saves || [];
    },
  },

  storage: {
    async get(key) { return KuroGames.save.get(key); },
    async set(key, value) { return KuroGames.save.set(key, value); },
    async remove(key) { return KuroGames.save.delete(key); },
    async list(options) { return KuroGames.save.list(options); },
  },

  multiplayer: {
    async listRooms() {
      const result = await invoke("room_list");
      return result.rooms || [];
    },
    async createRoom(options) {
      options = options || {};
      const result = await invoke("room_create", { maxPlayers: Math.max(2, Math.min(35, Math.floor(Number(options.maxPlayers) || 4))) });
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