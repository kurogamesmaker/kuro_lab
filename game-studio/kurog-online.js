(function () {
"use strict";

const DEFAULT_URL = "https://cprvpphlfpmiegjiutjn.supabase.co";
const DEFAULT_KEY = "sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn";
const FUNCTION_NAME = "kurogames-online";
const DEFAULT_DURABLE_ENDPOINT = "https://kuro-online-room.kurogamesmaker.workers.dev";

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
      resolve({ accessToken: event.data.access_token || null, user: event.data.user || null, isGuest: event.data.isGuest === true, guestMode: event.data.guestMode === true, useCloudflareProxy: event.data.useCloudflareProxy === true });
    }
    window.addEventListener("message", onMessage);
    // The parent supplies a Supabase Auth access token only for a signed-in KURO account.
    window.parent.postMessage({ type: "kuro-online-auth-request", requestId, gameId: gameId }, "*");
  });
}

async function invoke(action, params) {
  ensureReady();
  const session = await requestParentSession();
  if (!session.accessToken) {
    try { window.parent.postMessage({ type: "kuro-online-login-required", gameId: gameId, action: action }, "*"); } catch (_) {}
    throw new Error("オンライン機能を利用するにはKUROアカウントへのログインが必要です。");
  }
  const path = "/functions/v1/" + FUNCTION_NAME;
  const headers = { "Content-Type": "application/json", "apikey": DEFAULT_KEY, "Authorization": "Bearer " + session.accessToken };
  const body = JSON.stringify(Object.assign({ action: action, gameId: gameId }, params || {}));
  let status, text;
  if (session.useCloudflareProxy) {
    const result = await parentCloudflareRequest(path, "POST", headers, body);
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
function parentCloudflareRequest(path, method, headers, bodyText) {
  const requestId = "kuro-online-proxy-" + Date.now().toString(36) + "-" + (++requestCounter);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { window.removeEventListener("message", onMessage); reject(new Error("Cloudflare中継がタイムアウトしました。")); }, 30000);
    function onMessage(event) {
      if (event.source !== window.parent || !event.data || event.data.requestId !== requestId || event.data.type !== "kuro-online-proxy-response") return;
      clearTimeout(timer); window.removeEventListener("message", onMessage);
      if (event.data.error) { reject(new Error(event.data.error)); return; }
      const result = event.data.response || {};
      let text = ""; try { text = result.bodyBase64 ? decodeBase64(result.bodyBase64) : ""; } catch (_) { reject(new Error("Cloudflare応答を読み取れませんでした。")); return; }
      resolve({ status: Number(result.status) || 502, ok: Number(result.status) >= 200 && Number(result.status) < 300, text });
    }
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "kuro-online-proxy-request", requestId, path, method, headers, bodyBase64: bodyText ? encodeBase64(bodyText) : "" }, "*");
  });
}

async function connectRoomPolling(roomData, members, session) {
  const messageCallbacks = new Set(); const playerCallbacks = new Set(); const leftCallbacks = new Set(); const closeCallbacks = new Set();
  let active = true; let afterId = null; let timer = null; let busy = false; let cachedPlayers = [];
  function emitPlayers(next) {
    const previous = cachedPlayers.slice(); cachedPlayers = (next || []).map((m) => ({ userId: m.userId, kuroId: m.user && m.user.kuroId || null, displayName: m.user && m.user.display_name || "プレイヤー", joinedAt: m.joinedAt }));
    const currentIds = new Set(cachedPlayers.map(p => p.userId)); previous.filter(p => !currentIds.has(p.userId)).forEach(p => leftCallbacks.forEach(cb => { try { cb(p); } catch (e) { console.error(e); } }));
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
    } catch (error) { console.warn("KUROGAMES Cloudflare multiplayer poll:", error); }
    finally { busy = false; }
  }
  emitPlayers(members || []); await poll(); timer = setInterval(poll, 3200);
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
        const noticeData = { state: state, updatedAt: result.updatedAt || null };
        const notification = {
          type: "room-state-updated",
          data: noticeData,
          from: session.user.id,
          sentAt: Date.now(),
        };
        messageCallbacks.forEach((callback) => {
          try { callback(notification); } catch (error) { console.error(error); }
        });
        const wireData = new TextEncoder().encode(JSON.stringify(noticeData)).byteLength <= 28000
          ? noticeData
          : { updatedAt: result.updatedAt || null };
        try { await this.send("room-state-updated", wireData); }
        catch (error) { console.warn("KUROGAMES state notification failed; polling will resync:", error); }
      }
      return result;
    },
    async getDurableState() {
      return invoke("room_state_get", { roomId: roomData.id });
    },
    async updateHostState(state, expectedUpdatedAt) {
      const result = await invoke("room_state_update", {
        roomId: roomData.id,
        state: state,
        expectedUpdatedAt: expectedUpdatedAt || null,
        hostOnly: true,
      });
      if (!result.conflict) {
        const noticeData = { state: state, updatedAt: result.updatedAt || null };
        const notification = { type: "room-state-updated", data: noticeData, from: session.user.id, sentAt: Date.now() };
        messageCallbacks.forEach((callback) => { try { callback(notification); } catch (error) { console.error(error); } });
        try { await this.send("room-state-updated", noticeData); }
        catch (error) { console.warn("KUROGAMES host-state notification failed; polling will resync:", error); }
      }
      return result;
    },
    onPlayersChange(callback) { if (typeof callback !== "function") return () => {}; playerCallbacks.add(callback); callback(cachedPlayers.slice()); return () => playerCallbacks.delete(callback); },
    onPlayerLeft(callback) { if (typeof callback !== "function") return () => {}; leftCallbacks.add(callback); return () => leftCallbacks.delete(callback); },
    onRoomClosed(callback) { if (typeof callback !== "function") return () => {}; closeCallbacks.add(callback); return () => closeCallbacks.delete(callback); },
    async disband() { const result = await invoke("room_disband", { roomId: roomData.id }); active = false; if (timer) clearInterval(timer); closeCallbacks.forEach(cb => { try { cb({ reason: "host_disband" }); } catch (e) { console.error(e); } }); return result; },
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

let parentDurableTicketSequence = 0;
function requestParentDurableTicket(roomData) {
  if (window.parent === window) {
    return Promise.reject(new Error("親ページの接続中継を利用できません。"));
  }
  const requestId = "kuro-ticket-" + Date.now().toString(36) + "-" + (++parentDurableTicketSequence);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("親ページから接続チケットを取得できませんでした。"));
    }, 15000);
    function onMessage(event) {
      if (event.source !== window.parent || !event.data ||
          event.data.type !== "kuro-online-ticket-response" ||
          event.data.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (event.data.error) {
        reject(new Error(String(event.data.error)));
        return;
      }
      resolve({
        ok: event.data.ok === true,
        status: Number(event.data.status) || 0,
        data: event.data.data && typeof event.data.data === "object" ? event.data.data : {},
        endpoint: typeof event.data.endpoint === "string" ? event.data.endpoint : "",
      });
    }
    window.addEventListener("message", onMessage);
    window.parent.postMessage({
      type: "kuro-online-ticket-request",
      requestId,
      gameId: gameId,
      roomId: String(roomData && roomData.id || ""),
    }, "*");
  });
}

async function connectRoomDurable(roomData, members, session, endpoint) {
  const base = String(endpoint).replace(/\/$/, "");
  let ticketOk = false, ticketStatus = 0, ticketData = {};
  let ticketViaParent = false, parentEndpoint = "";
  try {
    const ticketResponse = await fetch(base + "/ticket", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer " + session.accessToken },
      body: JSON.stringify({ roomId: roomData.id, gameId: gameId }),
    });
    ticketStatus = ticketResponse.status;
    try { ticketData = await ticketResponse.json(); } catch (_) {}
    ticketOk = ticketResponse.ok;
  } catch (directError) {
    console.warn("KURO Durable ticket direct fetch failed; retrying through parent:", directError);
    const bridged = await requestParentDurableTicket(roomData);
    ticketOk = bridged.ok;
    ticketStatus = bridged.status;
    ticketData = bridged.data;
    ticketViaParent = true;
    parentEndpoint = bridged.endpoint;
  }
  if (!ticketOk || !ticketData.ticket) {
    const reasons = {
      unauthorized: "KUROアカウントの認証に失敗しました。",
      room_membership_required: "このルームへの参加権限がありません。",
      invalid_or_expired_ticket: "接続チケットが無効です。再接続してください。",
      room_full: "このルームは満員です。",
    };
    const ticketError = new Error(reasons[ticketData.error] || ticketData.error || "Durable Objects接続チケットを取得できませんでした。");
    ticketError.code = ticketData.error || "ticket_error";
    throw ticketError;
  }
  const wsBase = base.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  const wsUrl = wsBase + "/room/" + encodeURIComponent(String(roomData.id)) + "?ticket=" + encodeURIComponent(ticketData.ticket);
  const callbacks = new Set(), playerCallbacks = new Set(), leftCallbacks = new Set(), closeCallbacks = new Set(), pending = new Map();
  let active = true, cachedPlayers = [], socket = null, heartbeat = null, statusWatch = null, requestSeq = 0;

  function emitPlayers(list) {
    const previous = cachedPlayers.slice(); cachedPlayers = (list || []).map(p => ({ userId: p.id, kuroId: null, displayName: p.name || "プレイヤー", joinedAt: p.joinedAt }));
    const currentIds = new Set(cachedPlayers.map(p => p.userId)); previous.filter(p => !currentIds.has(p.userId)).forEach(p => leftCallbacks.forEach(cb => { try { cb(p); } catch (e) { console.error(e); } }));
    playerCallbacks.forEach(cb => { try { cb(cachedPlayers.slice()); } catch (e) { console.error(e); } });
  }
  function emitMessage(payload) {
    callbacks.forEach(cb => { try { cb(payload); } catch (e) { console.error(e); } });
  }
  function rejectPending(error) {
    pending.forEach(item => { clearTimeout(item.timer); item.reject(error); });
    pending.clear();
  }
  function sendRequest(type, fields) {
    if (!active || !socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Durable Objects接続が切断されています。"));
    }
    const requestId = "r" + (++requestSeq) + "-" + Date.now().toString(36);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("Durable Objectsからの応答がタイムアウトしました。"));
      }, 8000);
      pending.set(requestId, { resolve, reject, timer });
      try { socket.send(JSON.stringify(Object.assign({ type, requestId }, fields || {}))); }
      catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
    });
  }

  const roomPath = "/room/" + encodeURIComponent(String(roomData.id)) + "?ticket=" + encodeURIComponent(ticketData.ticket);
  const parentWsBase = parentEndpoint
    ? parentEndpoint.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:").replace(/\/$/, "")
    : "";
  const parentWsUrl = parentWsBase ? parentWsBase + roomPath : "";
  const wsCandidates = [];
  if (ticketViaParent && parentWsUrl) wsCandidates.push(parentWsUrl);
  wsCandidates.push(wsUrl);
  if (parentWsUrl && !wsCandidates.includes(parentWsUrl)) wsCandidates.push(parentWsUrl);
  let connected = false;

  async function openDurableSocket(candidateUrl) {
    await new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { if (socket) socket.close(); } catch (_) {}
          reject(new Error("Durable Objects接続がタイムアウトしました。"));
        }
      }, 15000);

      try {
        socket = new WebSocket(candidateUrl);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
        return;
      }

      function failInitial(message) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { if (socket) socket.close(); } catch (_) {}
        reject(new Error(message));
      }

      socket.onerror = () => {
        if (!connected) failInitial("Durable Objectsへの接続に失敗しました。");
      };
      socket.onclose = () => {
        if (!connected) {
          failInitial("Durable Objects接続が閉じられました。");
          return;
        }
        active = false;
        if (heartbeat) clearInterval(heartbeat); if (statusWatch) clearInterval(statusWatch);
        rejectPending(new Error("Durable Objects接続が閉じられました。"));
      };
      socket.onmessage = event => {
        let message;
        try { message = JSON.parse(event.data); } catch (_) { return; }
        if (message.type === "welcome") {
          emitPlayers(message.players || []);
          if (!connected) {
            connected = true;
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              resolve();
            }
          }
        } else if (message.type === "players") {
          emitPlayers(message.players || []);
        } else if (message.type === "state-result" || message.type === "game-patch-result" || message.type === "unon-result") {
          const item = pending.get(message.requestId);
          if (item) {
            pending.delete(message.requestId);
            clearTimeout(item.timer);
            item.resolve(message.result || {});
          }
        } else if (message.type === "state") {
          if (message.from !== session.user.id) {
            emitMessage({
              type: "room-state-updated",
              data: { state: message.state, updatedAt: message.updatedAt },
              from: message.from || "",
              sentAt: Date.now(),
            });
          }
        } else if (message.type === "message" && message.message) {
          const item = message.message;
          if (item.from !== session.user.id) {
            emitMessage({ type: item.type, data: item.data, from: item.from, sentAt: item.at });
          }
        } else if (message.type === "error") {
          console.warn("KURO Durable Objects:", message.error);
        }
      };
    });
  }

  let connectionError = null;
  for (const candidateUrl of wsCandidates) {
    try {
      await openDurableSocket(candidateUrl);
      connectionError = null;
      break;
    } catch (error) {
      connectionError = error;
      console.warn("KURO Durable WebSocket route failed; trying the alternate route:", candidateUrl, error);
    }
  }
  if (!connected) {
    throw connectionError || new Error("Durable Objectsへの接続に失敗しました。");
  }

  heartbeat = setInterval(() => {
    if (active && socket && socket.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ type: "ping" })); } catch (_) {}
    }
  }, 25000);
  statusWatch = setInterval(async () => { if (!active) return; try { const status = await invoke("room_poll", { roomId: roomData.id, afterId: null }); emitPlayers(status.members || []); if (status.roomStatus === "closed") { active = false; clearInterval(heartbeat); clearInterval(statusWatch); closeCallbacks.forEach(cb => { try { cb({ reason: "disbanded" }); } catch (e) { console.error(e); } }); try { if (socket) socket.close(1000, "room closed"); } catch (_) {} } } catch (e) { console.warn("room status check failed", e); } }, 30000);

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
        const noticeData = { state: state, updatedAt: result.updatedAt || null };
        const notification = {
          type: "room-state-updated",
          data: noticeData,
          from: session.user.id,
          sentAt: Date.now(),
        };
        emitMessage(notification);
        const wireData = new TextEncoder().encode(JSON.stringify(noticeData)).byteLength <= 28000
          ? noticeData
          : { updatedAt: result.updatedAt || null };
        try { await this.send("room-state-updated", wireData); }
        catch (error) { console.warn("KUROGAMES state notification failed; polling will resync:", error); }
      }
      return result;
    },
    async getDurableState() {
      const result = await sendRequest("get-state", {});
      if (result && result.state !== null && result.state !== undefined) return Object.assign({ roomStatus: "waiting" }, result);
      // One-time bridge for rooms that were already active before this fast state transport was enabled.
      const legacy = await invoke("room_state_get", { roomId: roomData.id });
      return legacy && legacy.state !== null && legacy.state !== undefined
        ? legacy
        : Object.assign({ roomStatus: "waiting" }, result || {});
    },
    async updateHostState(state, expectedUpdatedAt) {
      const result = await sendRequest("host-state-update", {
        state: state,
        expectedUpdatedAt: expectedUpdatedAt || null,
      });
      if (result.forbidden) throw new Error("ゲーム状態を更新できるのはルームホストだけです。");
      if (result.invalid) throw new Error("ゲーム状態の形式が正しくありません。");
      if (!result.conflict) {
        emitMessage({
          type: "room-state-updated",
          data: { state: state, updatedAt: result.updatedAt || null },
          from: session.user.id,
          sentAt: Date.now(),
        });
      }
      return result;
    },
    async sendHostGamePatch(patch) {
      const result = await sendRequest("host-game-patch", { patch: patch });
      if (result.forbidden) throw new Error("ゲーム状態を更新できるのはルームホストだけです。");
      if (result.invalid) throw new Error("ゲーム差分の形式が正しくありません。");
      if (result.conflict) throw new Error("古いゲーム操作は反映されませんでした。最新状態を同期してください。");
      const privateEnvelope = patch && patch.privateUpdates &&
        Object.prototype.hasOwnProperty.call(patch.privateUpdates, session.user.id)
        ? patch.privateUpdates[session.user.id]
        : null;
      emitMessage({
        type: "unon-patch",
        data: {
          phase: patch.phase,
          matchId: patch.matchId,
          version: patch.version,
          public: patch.public,
          events: patch.events || [],
          removeId: patch.removeId || null,
          privateEnvelope: privateEnvelope,
          updatedAt: result.updatedAt || null,
        },
        from: session.user.id,
        sentAt: Date.now(),
      });
      return result;
    },
    async startUnoGame(ruleMode) {
      const result = await sendRequest("unon-start", { ruleMode: ruleMode === "local" ? "local" : "official" });
      if (!result.ok) throw new Error(result.error || "ゲームを開始できませんでした。");
      if (result.roomState) emitMessage({
        type: "room-state-updated",
        data: { state: result.roomState, updatedAt: result.updatedAt || null },
        from: session.user.id, sentAt: Date.now(),
      });
      if (result.patch) emitMessage({ type: "unon-patch", data: result.patch, from: session.user.id, sentAt: Date.now() });
      return result;
    },
    async submitUnoAction(actionId, action) {
      const result = await sendRequest("unon-action", { actionId, action });
      if (result.ok && result.patch) {
        emitMessage({ type: "unon-patch", data: result.patch, from: session.user.id, sentAt: Date.now() });
      }
      return result;
    },
    async getUnoSnapshot() {
      const result = await sendRequest("unon-get", {});
      if (result.ok && result.active && result.patch) {
        emitMessage({ type: "unon-patch", data: result.patch, from: session.user.id, sentAt: Date.now() });
      }
      return result;
    },
    async removeUnoPlayer(userId) {
      const result = await sendRequest("unon-remove-player", { userId: userId });
      if (!result.ok) throw new Error(result.error || "プレイヤーの退出処理に失敗しました。");
      if (result.roomState) emitMessage({
        type: "room-state-updated",
        data: { state: result.roomState, updatedAt: result.updatedAt || null },
        from: session.user.id, sentAt: Date.now(),
      });
      if (result.patch) emitMessage({ type: "unon-patch", data: result.patch, from: session.user.id, sentAt: Date.now() });
      return result;
    },
    onPlayersChange(callback) {
      if (typeof callback !== "function") return function () {};
      playerCallbacks.add(callback);
      callback(cachedPlayers.slice());
      return function () { playerCallbacks.delete(callback); };
    },
    onPlayerLeft(callback) { if (typeof callback !== "function") return function () {}; leftCallbacks.add(callback); return function () { leftCallbacks.delete(callback); }; },
    onRoomClosed(callback) { if (typeof callback !== "function") return function () {}; closeCallbacks.add(callback); return function () { closeCallbacks.delete(callback); }; },
    async disband() { const result = await invoke("room_disband", { roomId: roomData.id }); active = false; if (heartbeat) clearInterval(heartbeat); if (statusWatch) clearInterval(statusWatch); closeCallbacks.forEach(cb => { try { cb({ reason: "host_disband" }); } catch (e) { console.error(e); } }); try { if (socket) socket.close(1000, "disband"); } catch (_) {} return result; },
    onMessage(callback) {
      if (typeof callback !== "function") return function () {};
      callbacks.add(callback);
      return function () { callbacks.delete(callback); };
    },
    async send(type, data) {
      if (!active || !socket || socket.readyState !== WebSocket.OPEN) throw new Error("Durable Objects接続が切断されています。");
      if (typeof type !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(type)) throw new TypeError("イベント名が不正です。");
      const payload = { type: "message", messageType: type, data: data };
      if (new TextEncoder().encode(JSON.stringify(payload)).length > 32768) throw new TypeError("1回の通信データは32KB以内にしてください。");
      socket.send(JSON.stringify(payload));
      return true;
    },
    async leave() {
      if (!active) return;
      active = false;
      if (heartbeat) clearInterval(heartbeat);
      rejectPending(new Error("ルームから退出しました。"));
      try { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "leave" })); } catch (_) {}
      try { if (socket) socket.close(1000, "left"); } catch (_) {}
    },
  };
}

async function connectRoom(roomData, members) {
  const session = await requestParentSession();
  if (!session.accessToken || !session.user || !session.user.id) {
    throw new Error("KUROアカウントの認証情報を取得できませんでした。");
  }
  // Durable Objects is the primary real-time transport. Legacy polling remains available to older games.
  const requiresUnonDurable = gameId === "faa155cb-2143-4361-9a96-dc759d334e46";
  const configuredEndpoint = typeof window.KuroGamesDurableEndpoint === "string"
    ? window.KuroGamesDurableEndpoint.trim()
    : DEFAULT_DURABLE_ENDPOINT;
  if (!configuredEndpoint && requiresUnonDurable) {
    throw new Error("UNONリアルタイムサーバーの接続先が設定されていません。");
  }
  if (configuredEndpoint) {
    try {
      return await connectRoomDurable(roomData, members, session, configuredEndpoint);
    } catch (error) {
      if (["unauthorized", "room_membership_required", "room_full"].includes(error && error.code)) throw error;
      console.warn("KUROGAMES Durable Objects connection failed:", error);
      if (requiresUnonDurable) {
        const detail = error && (error.code || error.message) || "unknown_error";
        const visible = new Error("UNONリアルタイムサーバーへの接続に失敗しました: " + detail);
        visible.code = error && error.code || "durable_connection_failed";
        visible.cause = error;
        throw visible;
      }
    }
  }
  return connectRoomPolling(roomData, members, session);
}

async function connectMatchedMatchmakingResult(result) {
  if (!result || result.status !== "matched" || !result.room || !result.room.id) {
    return { status: result && result.status === "cancelled" ? "cancelled" : "waiting" };
  }
  const room = await connectRoom(result.room, result.members || []);
  try {
    await invoke("matchmaking_ack", { roomId: result.room.id });
  } catch (error) {
    console.warn("KUROGAMES matchmaking acknowledgement:", error);
  }
  return { status: "matched", room: room };
}

async function connectMatchedUnonMatchmakingResult(result) {
  if (!result || result.status !== "matched" || !result.room || !result.room.id) {
    return { status: result && result.status === "cancelled" ? "cancelled" : "waiting" };
  }
  const room = await connectRoom(result.room, result.members || []);
  try {
    await invoke("unon_matchmaking_ack", { roomId: result.room.id });
  } catch (error) {
    console.warn("UNON matchmaking acknowledgement:", error);
  }
  return { status: "matched", room: room };
}

const KuroGames = {
  async init(options) {
    options = options || {};
    const nextGameId = options.gameId;
    if (typeof nextGameId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nextGameId)) {
      throw new Error("gameIdが正しくありません。Studioのオンライン設定画面からコピーしてください。");
    }
    gameId = nextGameId;
    const auth = await requestParentSession();
    if (!auth.accessToken) {
      // 未ログインでもSDK初期化は成功させ、オフライン部分のゲーム進行を妨げない
      const offlineFeatures = { ranking: false, cloudSave: false, multiplayer: false };
      gameConfig = { game: null, features: offlineFeatures };
      return { gameId: gameId, game: null, features: offlineFeatures };
    }
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
        submissionId: typeof options.submissionId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.submissionId) ? options.submissionId : crypto.randomUUID(),
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
    async setDaifugoReady(roomId, ready) {
      return invoke("daifugo_ready_set", { roomId: roomId, ready: !!ready });
    },
    async getDaifugoReadyState(roomId) {
      return invoke("daifugo_ready_state", { roomId: roomId });
    },
    async startDaifugoGame(roomId, rules) {
      return invoke("daifugo_start", { roomId: roomId, rules: rules || {} });
    },
    async getDaifugoGameState(roomId) {
      return invoke("daifugo_state", { roomId: roomId });
    },
    async submitDaifugoGameAction(roomId, action, cardIds) {
      return invoke("daifugo_action", {
        roomId: roomId,
        gameAction: action,
        cardIds: Array.isArray(cardIds) ? cardIds : [],
      });
    },
    async findRandomMatch() {
      return connectMatchedMatchmakingResult(await invoke("matchmaking_join"));
    },
    async getRandomMatchStatus() {
      return connectMatchedMatchmakingResult(await invoke("matchmaking_status"));
    },
    async cancelRandomMatch() {
      return invoke("matchmaking_cancel");
    },
    async findUnoRandomMatch(ruleMode) {
      const mode = ruleMode === "local" ? "local" : "official";
      return connectMatchedUnonMatchmakingResult(await invoke("unon_matchmaking_join", { ruleMode: mode }));
    },
    async getUnoRandomMatchStatus(ruleMode) {
      const mode = ruleMode === "local" ? "local" : "official";
      return connectMatchedUnonMatchmakingResult(await invoke("unon_matchmaking_status", { ruleMode: mode }));
    },
    async cancelUnoRandomMatch() {
      return invoke("unon_matchmaking_cancel");
    },
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