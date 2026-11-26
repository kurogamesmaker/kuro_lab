import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { Room, UNON_RULES } from "../online-room-worker.js";

const ROOM_IDLE_TTL_MS = 15 * 60 * 1000;

function createRoom() {
  const values = new Map();
  const pending = [];
  let alarmAt = null;
  let deleteAllCalls = 0;

  const storage = {
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
    async setAlarm(timestamp) { alarmAt = timestamp; },
    async deleteAlarm() { alarmAt = null; },
    async deleteAll() {
      deleteAllCalls += 1;
      values.clear();
      alarmAt = null;
    },
  };

  const state = {
    id: { toString: () => "test-room" },
    storage,
    waitUntil(promise) { pending.push(promise); },
  };

  const room = new Room(state, {});
  return {
    room,
    values,
    pending,
    get alarmAt() { return alarmAt; },
    get deleteAllCalls() { return deleteAllCalls; },
  };
}

test("last socket disconnect schedules a fifteen-minute cleanup alarm", async () => {
  const fixture = createRoom();
  const socket = { send() {} };
  const now = Date.now();

  fixture.room.sockets.set(socket, { id: "user-1" });
  fixture.room.removeSocket(socket, "user-1");
  await fixture.room.lifecycleTail;

  assert.equal(fixture.room.sockets.size, 0);
  assert.ok(Math.abs(fixture.alarmAt - (now + ROOM_IDLE_TTL_MS)) <= 10);
  assert.equal(fixture.deleteAllCalls, 0);
});

test("one remaining player keeps the room storage and does not schedule cleanup", async () => {
  const fixture = createRoom();
  const socketA = { send() {} };
  const socketB = { send() {} };

  fixture.room.sockets.set(socketA, { id: "user-a" });
  fixture.room.sockets.set(socketB, { id: "user-b" });
  fixture.room.removeSocket(socketA, "user-a");
  await fixture.room.lifecycleTail;

  assert.equal(fixture.room.sockets.size, 1);
  assert.equal(fixture.alarmAt, null);
  assert.equal(fixture.deleteAllCalls, 0);
});

test("another device for the same user prevents idle cleanup", async () => {
  const fixture = createRoom();
  const first = { send() {} };
  const second = { send() {} };

  fixture.room.sockets.set(first, { id: "same-user" });
  fixture.room.sockets.set(second, { id: "same-user" });
  fixture.room.removeSocket(first, "same-user");
  await fixture.room.lifecycleTail;

  assert.equal(fixture.room.sockets.size, 1);
  assert.equal(fixture.alarmAt, null);
  assert.equal(fixture.deleteAllCalls, 0);
});

test("idle alarm clears only the room's own storage and resets its cache", async () => {
  const fixture = createRoom();
  fixture.values.set("room-state", { state: { phase: "playing" }, updatedAt: 123 });
  fixture.room.loaded = true;
  fixture.room.data = { state: { phase: "playing" }, updatedAt: 123, idleDeadline: Date.now() - 1 };

  await fixture.room.alarm();

  assert.equal(fixture.deleteAllCalls, 1);
  assert.equal(fixture.values.size, 0);
  assert.equal(fixture.room.loaded, false);
  assert.deepEqual(fixture.room.data, { state: null, updatedAt: null, unonGame: null, unonCrypto: null, unonActionIds: [], unoDeadline: null, idleDeadline: null, disconnectDeadlines: [] });
});

test("an alarm never clears storage while any socket is connected", async () => {
  const fixture = createRoom();
  const socket = { send() {} };
  fixture.room.sockets.set(socket, { id: "active-user" });
  fixture.room.loaded = true;
  fixture.room.data = { state: { phase: "playing" }, updatedAt: 456 };

  await fixture.room.alarm();

  assert.equal(fixture.deleteAllCalls, 0);
  assert.equal(fixture.room.sockets.size, 1);
  assert.deepEqual(fixture.room.data, { state: { phase: "playing" }, updatedAt: 456 });
});

test("failed socket sends use the same disconnect cleanup path", async () => {
  const fixture = createRoom();
  const socket = {
    send() { throw new Error("socket closed"); },
  };
  const now = Date.now();
  fixture.room.sockets.set(socket, { id: "user-1" });

  assert.equal(fixture.room.send(socket, { type: "ping" }), false);
  await fixture.room.lifecycleTail;

  assert.equal(fixture.room.sockets.size, 0);
  assert.equal(fixture.alarmAt, now + ROOM_IDLE_TTL_MS);
});


test("non-host members cannot mutate the authoritative game state", async () => {
  const fixture = createRoom();
  fixture.room.loaded = true;
  const sent = [];
  const socket = { send(payload) { sent.push(JSON.parse(payload)); } };
  const player = { id: "player-2", isHost: false };
  fixture.room.sockets.set(socket, player);

  await fixture.room.onMessage(socket, player, JSON.stringify({
    type: "host-state-update",
    requestId: "blocked-1",
    expectedUpdatedAt: null,
    state: { phase: "finished", winner: "player-2" },
  }));

  assert.equal(fixture.room.data.state, null);
  assert.equal(fixture.values.has("room-state"), false);
  assert.equal(sent[0].type, "state-result");
  assert.equal(sent[0].result.forbidden, true);
});

test("host state updates persist in the room DO before broadcasting to peers", async () => {
  const fixture = createRoom();
  fixture.room.loaded = true;
  const hostMessages = [];
  const peerMessages = [];
  const hostSocket = { send(payload) { hostMessages.push(JSON.parse(payload)); } };
  const peerSocket = { send(payload) { peerMessages.push(JSON.parse(payload)); } };
  const host = { id: "host-user", isHost: true };
  const peer = { id: "peer-user", isHost: false };
  fixture.room.sockets.set(hostSocket, host);
  fixture.room.sockets.set(peerSocket, peer);
  const nextState = { phase: "playing", turn: "peer-user", version: 2 };

  await fixture.room.onMessage(hostSocket, host, JSON.stringify({
    type: "host-state-update",
    requestId: "host-write-1",
    expectedUpdatedAt: null,
    state: nextState,
  }));

  const saved = await fixture.room.state.storage.get("room-state");
  assert.deepEqual(saved.state, nextState);
  assert.equal(typeof saved.updatedAt, "number");
  assert.equal(hostMessages[0].type, "state-result");
  assert.equal(hostMessages[0].result.conflict, false);
  assert.equal(peerMessages[0].type, "state");
  assert.deepEqual(peerMessages[0].state, nextState);
});

test("Durable Object rejects stale state updates instead of overwriting newer turns", async () => {
  const fixture = createRoom();
  fixture.room.loaded = true;
  fixture.room.data = { state: { version: 4 }, updatedAt: 400 };
  const sent = [];
  const socket = { send(payload) { sent.push(JSON.parse(payload)); } };
  const host = { id: "host-user", isHost: true };
  fixture.room.sockets.set(socket, host);

  await fixture.room.onMessage(socket, host, JSON.stringify({
    type: "host-state-update",
    requestId: "stale-write",
    expectedUpdatedAt: 300,
    state: { version: 5 },
  }));

  assert.deepEqual(fixture.room.data.state, { version: 4 });
  assert.equal(sent[0].result.conflict, true);
});


test("host can migrate an older room snapshot into an empty Durable Object", async () => {
  const fixture = createRoom();
  fixture.room.loaded = true;
  const sent = [];
  const socket = { send(payload) { sent.push(JSON.parse(payload)); } };
  const host = { id: "host-user", isHost: true };
  fixture.room.sockets.set(socket, host);
  const oldSnapshot = { phase: "playing", version: 8 };

  await fixture.room.onMessage(socket, host, JSON.stringify({
    type: "host-state-update",
    requestId: "legacy-seed",
    expectedUpdatedAt: "2026-11-22T04:00:00.000Z",
    state: oldSnapshot,
  }));

  const saved = await fixture.room.state.storage.get("room-state");
  assert.deepEqual(saved.state, oldSnapshot);
  assert.equal(sent[0].result.conflict, false);
});


function envelope(value) {
  return {
    epk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
    iv: "a".repeat(16),
    ct: value,
  };
}

function gamePatch(version, privateUpdates, matchId = "match-1") {
  return {
    phase: "playing",
    matchId,
    version,
    public: {
      version,
      phase: "playing",
      ruleMode: "official",
      players: [
        { userId: "host-user", name: "Host", handCount: 6 },
        { userId: "peer-a", name: "A", handCount: 7 },
        { userId: "peer-b", name: "B", handCount: 7 },
      ],
      top: { id: "c0", color: "red", value: "3" },
    },
    privateUpdates,
    events: [],
  };
}

test("non-host members cannot submit compact UNON game patches", async () => {
  const fixture = createRoom();
  fixture.room.loaded = true;
  const sent = [];
  const socket = { send(payload) { sent.push(JSON.parse(payload)); } };
  const guest = { id: "peer-a", isHost: false };
  fixture.room.sockets.set(socket, guest);

  await fixture.room.onMessage(socket, guest, JSON.stringify({
    type: "host-game-patch",
    requestId: "guest-patch",
    patch: gamePatch(0, { "peer-a": envelope("private-a") }),
  }));

  assert.equal(fixture.room.data.state, null);
  assert.equal(fixture.values.has("room-state"), false);
  assert.equal(sent[0].type, "game-patch-result");
  assert.equal(sent[0].result.forbidden, true);
});

test("host compact patch persists full reconnect state and sends recipient-only private data", async () => {
  const fixture = createRoom();
  fixture.room.loaded = true;
  fixture.room.data = {
    state: {
      phase: "lobby",
      players: [
        { id: "host-user", name: "Host" },
        { id: "peer-a", name: "A" },
        { id: "peer-b", name: "B" },
      ],
      game: null,
    },
    updatedAt: 100,
  };
  const hostMessages = [], aMessages = [], bMessages = [];
  const hostSocket = { send(payload) { hostMessages.push(JSON.parse(payload)); } };
  const aSocket = { send(payload) { aMessages.push(JSON.parse(payload)); } };
  const bSocket = { send(payload) { bMessages.push(JSON.parse(payload)); } };
  const host = { id: "host-user", isHost: true };
  fixture.room.sockets.set(hostSocket, host);
  fixture.room.sockets.set(aSocket, { id: "peer-a", isHost: false });
  fixture.room.sockets.set(bSocket, { id: "peer-b", isHost: false });

  await fixture.room.onMessage(hostSocket, host, JSON.stringify({
    type: "host-game-patch",
    requestId: "patch-0",
    patch: gamePatch(0, {
      "host-user": envelope("private-host"),
      "peer-a": envelope("private-a"),
      "peer-b": envelope("private-b"),
    }),
  }));

  const saved = await fixture.room.state.storage.get("room-state");
  assert.equal(saved.state.phase, "playing");
  assert.equal(saved.state.game.version, 0);
  assert.equal(saved.state.game.priv["peer-a"].ct, "private-a");
  assert.equal(saved.state.game.priv["peer-b"].ct, "private-b");
  assert.equal(hostMessages[0].type, "game-patch-result");
  assert.equal(hostMessages[0].result.ok, true);

  const updateA = aMessages.find(item => item.type === "message" && item.message.type === "unon-patch");
  const updateB = bMessages.find(item => item.type === "message" && item.message.type === "unon-patch");
  assert.equal(updateA.message.data.privateEnvelope.ct, "private-a");
  assert.equal(updateB.message.data.privateEnvelope.ct, "private-b");
  assert.equal(JSON.stringify(updateA).includes("private-b"), false);
  assert.equal(JSON.stringify(updateB).includes("private-a"), false);
});

test("compact UNON patch merges unchanged private envelopes and rejects stale versions", async () => {
  const fixture = createRoom();
  fixture.room.loaded = true;
  fixture.room.data = {
    state: {
      phase: "playing",
      matchId: "match-1",
      players: [{ id: "host-user" }, { id: "peer-a" }, { id: "peer-b" }],
      game: {
        version: 1,
        public: { version: 1, players: [] },
        priv: {
          "host-user": envelope("old-host"),
          "peer-a": envelope("old-a"),
          "peer-b": envelope("keep-b"),
        },
      },
    },
    updatedAt: 200,
  };
  const hostMessages = [], peerMessages = [];
  const hostSocket = { send(payload) { hostMessages.push(JSON.parse(payload)); } };
  const peerSocket = { send(payload) { peerMessages.push(JSON.parse(payload)); } };
  const host = { id: "host-user", isHost: true };
  fixture.room.sockets.set(hostSocket, host);
  fixture.room.sockets.set(peerSocket, { id: "peer-b", isHost: false });

  const patch = gamePatch(2, { "peer-a": envelope("new-a") });
  await fixture.room.onMessage(hostSocket, host, JSON.stringify({
    type: "host-game-patch", requestId: "patch-2", patch,
  }));
  let saved = await fixture.room.state.storage.get("room-state");
  assert.equal(saved.state.game.priv["peer-a"].ct, "new-a");
  assert.equal(saved.state.game.priv["peer-b"].ct, "keep-b");
  const update = peerMessages.find(item => item.type === "message");
  assert.equal(update.message.data.privateEnvelope, null);
  assert.equal(JSON.stringify(update).includes("new-a"), false);

  await fixture.room.onMessage(hostSocket, host, JSON.stringify({
    type: "host-game-patch", requestId: "stale-patch", patch,
  }));
  assert.equal(hostMessages.at(-1).type, "game-patch-result");
  assert.equal(hostMessages.at(-1).result.conflict, true);
  saved = await fixture.room.state.storage.get("room-state");
  assert.equal(saved.state.game.version, 2);
});


async function makePlayerKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
  return {
    pub: await crypto.subtle.exportKey("jwk", pair.publicKey),
    privateKey: pair.privateKey,
  };
}

async function openServerEnvelope(envelope, privateKey) {
  const remote = await crypto.subtle.importKey("jwk", envelope.epk, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const key = await crypto.subtle.deriveKey({ name: "ECDH", public: remote }, privateKey,
    { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const iv = Uint8Array.from(atob(envelope.iv), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(envelope.ct), c => c.charCodeAt(0));
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

test("UNON server starts the match and encrypts each hand only for its owner", async () => {
  const fixture = createRoom();
  fixture.room.loaded = true;
  const hostKeys = await makePlayerKeys();
  const guestKeys = await makePlayerKeys();
  fixture.room.data.state = {
    phase: "lobby",
    players: [
      { id: "host-user", name: "Host", pub: hostKeys.pub, ready: true, start: true },
      { id: "guest-user", name: "Guest", pub: guestKeys.pub, ready: true, start: true },
    ],
  };
  const hostMessages = [], guestMessages = [];
  const hostSocket = { send(payload) { hostMessages.push(JSON.parse(payload)); } };
  const guestSocket = { send(payload) { guestMessages.push(JSON.parse(payload)); } };
  const host = { id: "host-user", isHost: true };
  const guest = { id: "guest-user", isHost: false };
  fixture.room.sockets.set(hostSocket, host);
  fixture.room.sockets.set(guestSocket, guest);

  await fixture.room.onMessage(hostSocket, host, JSON.stringify({
    type: "unon-start", requestId: "start-1", ruleMode: "official",
  }));

  const started = hostMessages.find(item => item.type === "unon-result").result;
  assert.equal(started.ok, true);
  assert.equal(started.patch.public.phase, "playing");
  assert.equal(fixture.room.data.unonGame.players.length, 2);
  assert.equal(fixture.room.data.unonGame.players[0].hand.length, 7);
  assert.equal(fixture.room.data.state.game, null);
  assert.equal(started.patch.publicDelta, undefined);
  assert.equal((await openServerEnvelope(started.patch.privateEnvelope, hostKeys.privateKey)).hand.length, 7);

  const guestPatch = guestMessages.find(item => item.type === "message" && item.message.type === "unon-patch").message.data;
  assert.equal(guestPatch.public.version, 0);
  assert.equal(guestPatch.privateEnvelope !== null, true);
  assert.equal((await openServerEnvelope(guestPatch.privateEnvelope, guestKeys.privateKey)).hand.length, 7);
  assert.equal(guestPatch.privateUpdates, undefined);
});

test("UNON actions go directly to the server, reject wrong turns and send only changed public/private data", async () => {
  const fixture = createRoom();
  fixture.room.loaded = true;
  const hostKeys = await makePlayerKeys();
  const guestKeys = await makePlayerKeys();
  fixture.room.data.state = {
    phase: "playing",
    players: [
      { id: "host-user", name: "Host", pub: hostKeys.pub, ready: true },
      { id: "guest-user", name: "Guest", pub: guestKeys.pub, ready: true },
    ],
  };
  fixture.room.data.unonGame = UNON_RULES.createGame({ players: [
    { userId: "host-user", name: "Host" }, { userId: "guest-user", name: "Guest" },
  ], ruleMode: "official" });
  fixture.room.data.unonGame.matchId = "match-server";
  const hostMessages = [], guestMessages = [];
  const hostSocket = { send(payload) { hostMessages.push(JSON.parse(payload)); } };
  const guestSocket = { send(payload) { guestMessages.push(JSON.parse(payload)); } };
  const host = { id: "host-user", isHost: true };
  const guest = { id: "guest-user", isHost: false };
  fixture.room.sockets.set(hostSocket, host);
  fixture.room.sockets.set(guestSocket, guest);

  await fixture.room.onMessage(guestSocket, guest, JSON.stringify({
    type: "unon-action", requestId: "wrong-turn", actionId: "guest-action-1", action: { type: "draw" },
  }));
  const denied = guestMessages.find(item => item.type === "unon-result").result;
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "NOT_YOUR_TURN");
  assert.equal(fixture.room.data.unonGame.version, 0);

  await fixture.room.onMessage(hostSocket, host, JSON.stringify({
    type: "unon-action", requestId: "draw-1", actionId: "host-action-1", action: { type: "draw" },
  }));
  const accepted = hostMessages.filter(item => item.type === "unon-result").at(-1).result;
  assert.equal(accepted.ok, true);
  assert.equal(accepted.patch.public, undefined);
  assert.ok(accepted.patch.publicDelta);
  assert.ok(accepted.patch.privateEnvelope);
  assert.equal(fixture.room.data.unonGame.version, 1);
  assert.equal(fixture.room.data.state.phase, "playing");
  assert.equal(fixture.room.data.state.matchId, "match-server");
  assert.equal(fixture.room.data.state.game, null);
  const hostHand = await openServerEnvelope(accepted.patch.privateEnvelope, hostKeys.privateKey);
  assert.equal(hostHand.hand.length, 8);

  const peerPatch = guestMessages.filter(item => item.type === "message" && item.message.type === "unon-patch").at(-1).message.data;
  assert.equal(peerPatch.public, undefined);
  assert.ok(peerPatch.publicDelta);
  assert.equal(peerPatch.privateEnvelope, null);
  assert.equal(peerPatch.privateUpdates, undefined);
  assert.equal(fixture.room.data.unonGame.players[1].hand.length, 7);
});

test("UNON action IDs are idempotent when a client retries after a delayed acknowledgement", async () => {
  const fixture = createRoom();
  fixture.room.loaded = true;
  const hostKeys = await makePlayerKeys();
  const guestKeys = await makePlayerKeys();
  fixture.room.data.state = {
    phase: "playing",
    players: [
      { id: "host-user", name: "Host", pub: hostKeys.pub, ready: true },
      { id: "guest-user", name: "Guest", pub: guestKeys.pub, ready: true },
    ],
  };
  fixture.room.data.unonGame = UNON_RULES.createGame({ players: [
    { userId: "host-user", name: "Host" }, { userId: "guest-user", name: "Guest" },
  ], ruleMode: "official" });
  fixture.room.data.unonGame.matchId = "match-idempotent";
  const sent = [];
  const socket = { send(payload) { sent.push(JSON.parse(payload)); } };
  const host = { id: "host-user", isHost: true };
  fixture.room.sockets.set(socket, host);
  const message = JSON.stringify({
    type: "unon-action", requestId: "draw-first", actionId: "same-action-id", action: { type: "draw" },
  });
  await fixture.room.onMessage(socket, host, message);
  const version = fixture.room.data.unonGame.version;
  await fixture.room.onMessage(socket, host, JSON.stringify({
    type: "unon-action", requestId: "draw-retry", actionId: "same-action-id", action: { type: "draw" },
  }));
  assert.equal(fixture.room.data.unonGame.version, version);
  const retry = sent.filter(item => item.type === "unon-result").at(-1).result;
  assert.equal(retry.ok, true);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.patch.public.version, version);
});


test("generic room snapshots never expose the server-only UNON deck, hands or ECDH private key", async () => {
  const fixture = createRoom();
  fixture.room.loaded = true;
  fixture.room.data = {
    state: { phase: "playing", matchId: "private-match", game: null },
    updatedAt: 900,
    unonGame: { deck: [{ id: "hidden-card" }], players: [{ userId: "secret", hand: [{ id: "private-card" }] }] },
    unonCrypto: { privateKey: { d: "server-private-key" }, publicKey: { kty: "EC" } },
    unonActionIds: ["user:action"],
    unoDeadline: null,
    idleDeadline: null,
  };
  const sent = [];
  const socket = { send(payload) { sent.push(JSON.parse(payload)); } };
  const player = { id: "host-user", isHost: true };
  fixture.room.sockets.set(socket, player);

  await fixture.room.onMessage(socket, player, JSON.stringify({ type: "get-state", requestId: "safe-state" }));
  const result = sent[0].result;
  assert.deepEqual(result.state, fixture.room.data.state);
  assert.equal(result.unonGame, undefined);
  assert.equal(result.unonCrypto, undefined);
  assert.equal(result.unonActionIds, undefined);
  assert.equal(JSON.stringify(sent[0]).includes("server-private-key"), false);
  assert.equal(JSON.stringify(sent[0]).includes("private-card"), false);
});


function localUnonState({ players, deck = [], top = { id: "top", color: "red", value: "5" }, turn = 0, pendingDraw = 0, drawn = null, ruleMode = "local" }) {
  return {
    ver: 1,
    version: 0,
    phase: "playing",
    scoreMultiplier: 2,
    ruleMode,
    players,
    deck,
    pile: [top],
    turn,
    direction: 1,
    activeColor: top.color,
    pendingDraw,
    drawn,
    unoPending: null,
    matchId: "local-test-match",
  };
}

const unonCard = (id, color, value) => ({ id, color, value });

test("UNON local mode plays all selected same-value cards in one action", () => {
  const cards = [
    unonCard("red-7-a", "red", "7"),
    unonCard("blue-7-a", "blue", "7"),
    unonCard("green-7-a", "green", "7"),
    unonCard("yellow-7-a", "yellow", "7"),
    unonCard("red-7-b", "red", "7"),
  ];
  const state = localUnonState({
    players: [
      { userId: "p1", name: "P1", hand: [...cards, unonCard("spare", "blue", "1")] },
      { userId: "p2", name: "P2", hand: [unonCard("other", "green", "2")] },
    ],
    top: unonCard("top", "red", "7"),
  });

  const result = UNON_RULES.applyAction(state, "p1", {
    type: "play",
    cardIds: cards.map(card => card.id),
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.players[0].hand.length, 1);
  assert.deepEqual(result.state.pile.slice(-5).map(card => card.id), cards.map(card => card.id));
  assert.equal(result.state.turn, 1);
  assert.equal(result.state.unoPending, "p1");
});

test("UNON local mode stacks mixed plus-two and plus-four cards and accumulates the penalty", () => {
  const cards = [
    unonCard("d2-red", "red", "D2"),
    unonCard("d2-blue", "blue", "D2"),
    unonCard("w4-a", "wild", "W4"),
    unonCard("w4-b", "wild", "W4"),
    unonCard("d2-green", "green", "D2"),
  ];
  const state = localUnonState({
    turn: 1,
    pendingDraw: 2,
    players: [
      { userId: "p1", name: "P1", hand: [unonCard("p1-card", "red", "3")] },
      { userId: "p2", name: "P2", hand: [...cards, unonCard("spare-a", "blue", "4"), unonCard("spare-b", "green", "8")] },
    ],
    top: unonCard("top", "red", "5"),
  });

  const result = UNON_RULES.applyAction(state, "p2", {
    type: "play",
    cardIds: cards.map(card => card.id),
    color: "yellow",
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.pendingDraw, 16);
  assert.equal(result.state.turn, 0);
  assert.equal(result.state.players[1].hand.length, 2);
  assert.equal(result.state.activeColor, "green");
});

test("UNON local mode lets the player who takes a stacked penalty continue their turn", () => {
  const drawnCards = Array.from({ length: 6 }, (_, i) => unonCard("draw-" + i, "blue", String(i + 1)));
  const state = localUnonState({
    turn: 1,
    pendingDraw: 6,
    players: [
      { userId: "p1", name: "P1", hand: [unonCard("p1-card", "red", "1")] },
      { userId: "p2", name: "P2", hand: [unonCard("p2-card", "green", "2")] },
    ],
    deck: drawnCards,
  });

  const result = UNON_RULES.applyAction(state, "p2", { type: "draw" });

  assert.equal(result.ok, true);
  assert.equal(result.state.pendingDraw, 0);
  assert.equal(result.state.players[1].hand.length, 7);
  assert.equal(result.state.turn, 1);
});

test("UNON official mode still rejects multi-card plays", () => {
  const cards = [
    unonCard("official-red-7", "red", "7"),
    unonCard("official-blue-7", "blue", "7"),
  ];
  const state = localUnonState({
    ruleMode: "official",
    players: [
      { userId: "p1", name: "P1", hand: cards },
      { userId: "p2", name: "P2", hand: [unonCard("other", "red", "1")] },
    ],
    top: unonCard("top", "red", "7"),
  });

  const result = UNON_RULES.applyAction(state, "p1", {
    type: "play",
    cardIds: cards.map(card => card.id),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "ONE_CARD_ONLY");
});

test("UNON online action endpoint accepts a five-card local-rule play", async () => {
  const fixture = createRoom();
  fixture.room.loaded = true;
  const hostKeys = await makePlayerKeys();
  const guestKeys = await makePlayerKeys();
  const cards = Array.from({ length: 5 }, (_, i) => unonCard("local-d2-" + i, ["red", "blue", "green", "yellow", "red"][i], "D2"));
  fixture.room.data.state = {
    phase: "playing",
    players: [
      { id: "host-user", name: "Host", pub: hostKeys.pub, ready: true },
      { id: "guest-user", name: "Guest", pub: guestKeys.pub, ready: true },
    ],
  };
  fixture.room.data.unonGame = localUnonState({
    players: [
      { userId: "host-user", name: "Host", hand: [...cards, unonCard("host-spare-a", "red", "3"), unonCard("host-spare-b", "blue", "4")] },
      { userId: "guest-user", name: "Guest", hand: [unonCard("guest-card", "green", "6")] },
    ],
    top: unonCard("top", "red", "D2"),
  });
  const sent = [];
  const socket = { send(payload) { sent.push(JSON.parse(payload)); } };
  const host = { id: "host-user", isHost: true };
  fixture.room.sockets.set(socket, host);

  await fixture.room.onMessage(socket, host, JSON.stringify({
    type: "unon-action",
    requestId: "five-card-local-play",
    actionId: "five-card-local-play",
    action: { type: "play", cardIds: cards.map(card => card.id) },
  }));

  const result = sent.filter(item => item.type === "unon-result").at(-1).result;
  assert.equal(result.ok, true);
  assert.equal(fixture.room.data.unonGame.pendingDraw, 10);
  assert.equal(fixture.room.data.unonGame.players[0].hand.length, 2);
});


test("UNON three-player lobby waits for the host start lock after every vote", async () => {
  const fixture = createRoom();
  fixture.room.loaded = true;
  const players = [];
  const sockets = [];
  const messages = [];
  for (const [index, id] of ["host-3p", "guest-3p-a", "guest-3p-b"].entries()) {
    const keys = await makePlayerKeys();
    players.push({
      id,
      name: "Player " + (index + 1),
      pub: keys.pub,
      ready: false,
      start: false,
    });
    const sent = [];
    const socket = { send(payload) { sent.push(JSON.parse(payload)); } };
    sockets.push(socket);
    messages.push(sent);
    fixture.room.sockets.set(socket, { id, isHost: index === 0 });
  }
  fixture.room.data.state = {
    phase: "lobby",
    ruleMode: "official",
    players,
  };

  for (let i = 0; i < players.length; i++) {
    await fixture.room.onMessage(sockets[i], fixture.room.sockets.get(sockets[i]), JSON.stringify({
      type: "message",
      messageType: "unon-vote",
      data: { vote: "ready" },
    }));
    await fixture.room.onMessage(sockets[i], fixture.room.sockets.get(sockets[i]), JSON.stringify({
      type: "message",
      messageType: "unon-vote",
      data: { vote: "start" },
    }));
  }

  assert.equal(fixture.room.data.state.phase, "lobby");
  assert.equal(fixture.room.data.state.players.length, 3);
  assert.ok(fixture.room.data.state.players.every(player => player.ready && player.start));
  assert.equal(fixture.room.data.unonGame, null);

  await fixture.room.onMessage(sockets[0], fixture.room.sockets.get(sockets[0]), JSON.stringify({
    type: "unon-start",
    requestId: "start-three-player",
    ruleMode: "official",
  }));

  const result = messages[0].filter(item => item.type === "unon-result").at(-1).result;
  assert.equal(result.ok, true);
  assert.equal(fixture.room.data.state.phase, "playing");
  assert.equal(fixture.room.data.unonGame.players.length, 3);
  assert.deepEqual(fixture.room.data.unonGame.players.map(player => player.hand.length), [7, 7, 7]);
});


test("UNON three-player turns advance to all three seats and return to the starter", () => {
  const state = localUnonState({
    ruleMode: "official",
    players: [
      { userId: "p1", name: "P1", hand: [
        unonCard("p1-red-3", "red", "3"),
        unonCard("p1-red-7", "red", "7"),
        unonCard("p1-blue-2", "blue", "2"),
      ] },
      { userId: "p2", name: "P2", hand: [
        unonCard("p2-red-4", "red", "4"),
        unonCard("p2-green-2", "green", "2"),
      ] },
      { userId: "p3", name: "P3", hand: [
        unonCard("p3-red-6", "red", "6"),
        unonCard("p3-yellow-2", "yellow", "2"),
      ] },
    ],
    top: unonCard("top", "red", "5"),
  });

  const p1 = UNON_RULES.applyAction(state, "p1", { type: "play", cardIds: ["p1-red-3"] });
  assert.equal(p1.ok, true);
  assert.equal(p1.state.turn, 1);

  const p2 = UNON_RULES.applyAction(p1.state, "p2", { type: "play", cardIds: ["p2-red-4"] });
  assert.equal(p2.ok, true);
  assert.equal(p2.state.turn, 2);

  const p3 = UNON_RULES.applyAction(p2.state, "p3", { type: "play", cardIds: ["p3-red-6"] });
  assert.equal(p3.ok, true);
  assert.equal(p3.state.turn, 0);
});

test("UNON reverse sends a three-player game to the previous seat", () => {
  const state = localUnonState({
    ruleMode: "official",
    players: [
      { userId: "p1", name: "P1", hand: [
        unonCard("p1-rev", "red", "REV"),
        unonCard("p1-extra-a", "blue", "2"),
        unonCard("p1-extra-b", "green", "4"),
      ] },
      { userId: "p2", name: "P2", hand: [unonCard("p2-a", "red", "3"), unonCard("p2-b", "blue", "4")] },
      { userId: "p3", name: "P3", hand: [unonCard("p3-a", "green", "3"), unonCard("p3-b", "yellow", "4")] },
    ],
    top: unonCard("top", "red", "5"),
  });

  const result = UNON_RULES.applyAction(state, "p1", { type: "play", cardIds: ["p1-rev"] });
  assert.equal(result.ok, true);
  assert.equal(result.state.direction, -1);
  assert.equal(result.state.turn, 2);
});


test("UNON Durable Objects reject a fifth distinct socket even though shared rooms support more players", async () => {
  const fixture = createRoom();
  const { room } = fixture;
  for (let i = 1; i <= 4; i++) {
    room.sockets.set({ send() {} }, { id: "player-" + i, isHost: i === 1 });
  }

  const response = await room.fetch(new Request("https://example.test/room/test-room", {
    headers: {
      Upgrade: "websocket",
      "x-kuro-user-id": "player-5",
      "x-kuro-game-id": "faa155cb-2143-4361-9a96-dc759d334e46",
      "x-kuro-room-id": "test-room",
    },
  }));

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "room_full");
});

test("room host role refresh is verified against Supabase before granting host privileges", async () => {
  const fixture = createRoom();
  fixture.room.loaded = true;
  fixture.room.env = {
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_ANON_KEY: "anon-key",
  };
  const messages = [];
  const socket = { send(payload) { messages.push(JSON.parse(payload)); } };
  const player = { id: "new-host", gameId: "game-id", roomId: "test-room", isHost: false };
  fixture.room.sockets.set(socket, player);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "new-host", is_anonymous: false }), { status: 200 });
    }
    if (String(url).endsWith("/functions/v1/kurogames-online")) {
      return new Response(JSON.stringify({
        roomStatus: "waiting",
        hostUserId: "new-host",
        members: [{ userId: "new-host" }],
      }), { status: 200 });
    }
    throw new Error("Unexpected URL: " + url);
  };

  try {
    await fixture.room.onMessage(socket, player, JSON.stringify({
      type: "refresh-role",
      requestId: "refresh-host",
      accessToken: "valid-test-token",
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(player.isHost, true);
  assert.equal(messages[0].type, "state-result");
  assert.deepEqual(messages[0].result, { ok: true, isHost: true, hostUserId: "new-host" });
});

test("room host role refresh cannot promote a member who is not the database host", async () => {
  const fixture = createRoom();
  fixture.room.loaded = true;
  fixture.room.env = {
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_ANON_KEY: "anon-key",
  };
  const messages = [];
  const socket = { send(payload) { messages.push(JSON.parse(payload)); } };
  const player = { id: "guest", gameId: "game-id", roomId: "test-room", isHost: false };
  fixture.room.sockets.set(socket, player);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "guest", is_anonymous: false }), { status: 200 });
    }
    if (String(url).endsWith("/functions/v1/kurogames-online")) {
      return new Response(JSON.stringify({
        roomStatus: "waiting",
        hostUserId: "real-host",
        members: [{ userId: "guest" }, { userId: "real-host" }],
      }), { status: 200 });
    }
    throw new Error("Unexpected URL: " + url);
  };

  try {
    await fixture.room.onMessage(socket, player, JSON.stringify({
      type: "refresh-role",
      requestId: "refresh-guest",
      accessToken: "valid-test-token",
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(player.isHost, false);
  assert.equal(messages[0].result.ok, true);
  assert.equal(messages[0].result.isHost, false);
  assert.equal(messages[0].result.hostUserId, "real-host");
});
