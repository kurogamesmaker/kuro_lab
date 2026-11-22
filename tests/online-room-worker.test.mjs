import test from "node:test";
import assert from "node:assert/strict";
import { Room } from "../online-room-worker.js";

const ROOM_IDLE_TTL_MS = 5 * 60 * 1000;

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

test("last socket disconnect schedules a five-minute cleanup alarm", async () => {
  const fixture = createRoom();
  const socket = { send() {} };
  const now = Date.now();

  fixture.room.sockets.set(socket, { id: "user-1" });
  fixture.room.removeSocket(socket, "user-1");
  await fixture.room.lifecycleTail;

  assert.equal(fixture.room.sockets.size, 0);
  assert.equal(fixture.alarmAt, now + ROOM_IDLE_TTL_MS);
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
  fixture.room.data = { state: { phase: "playing" }, updatedAt: 123 };

  await fixture.room.alarm();

  assert.equal(fixture.deleteAllCalls, 1);
  assert.equal(fixture.values.size, 0);
  assert.equal(fixture.room.loaded, false);
  assert.deepEqual(fixture.room.data, { state: null, updatedAt: null });
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
