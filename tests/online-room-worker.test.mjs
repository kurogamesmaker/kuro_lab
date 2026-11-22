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
