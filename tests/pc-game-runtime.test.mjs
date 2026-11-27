import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const launcher = readFileSync(new URL("../games/play/launcher.js", import.meta.url), "utf8");
const studio = readFileSync(new URL("../game-studio/code-core-v4.js", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, "start marker was not found: " + startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, "end marker was not found: " + endMarker);
  return source.slice(start, end);
}

function makeModuleChecker(source, endMarker) {
  const block = sourceBlock(source, "function kuroNeedsModuleScript", endMarker);
  const context = {};
  vm.runInNewContext(block + "\nglobalThis.checkModule = kuroNeedsModuleScript;", context);
  return context.checkModule;
}

const moduleChecks = [
  ["launcher", makeModuleChecker(launcher, "const KURO_CLOUDFLARE_TRANSPORT")],
  ["studio", makeModuleChecker(studio, "function makeDocument")]
];

for (const [name, check] of moduleChecks) {
  test(name + ": only actual module syntax uses module mode", () => {
    assert.equal(check("async function load(){ await fetch('/data'); }"), false);
    assert.equal(check("const load = async () => { await fetch('/data'); };"), false);
    assert.equal(check("const load = async () => await fetch('/data');"), false);
    assert.equal(check('const title = "await"; // await is not top-level code'), false);
    assert.equal(check("const result = await fetch('/data');"), true);
    assert.equal(check("if (ready) { await fetch('/data'); }"), true);
    assert.equal(check('import { createClient } from "pkg";'), true);
    assert.equal(check('const packagePromise = import("pkg");'), false);
    assert.equal(check("/* @kuro-module */\nwindow.gameReady = true;"), true);
  });
}

test("sandbox storage bridge supports localStorage and sessionStorage", () => {
  const bridgeBlock = sourceBlock(
    launcher,
    "const KURO_GAME_FRAME_STORAGE_PREFIX",
    "kuroGameAuthClient.auth.onAuthStateChange"
  );
  const backing = new Map();
  function makeHostStorage() {
    return {
      getItem(key) { return backing.has(key) ? backing.get(key) : null; },
      setItem(key, value) { backing.set(String(key), String(value)); },
      removeItem(key) { backing.delete(String(key)); },
      key(index) { return [...backing.keys()][index] ?? null; },
      get length() { return backing.size; }
    };
  }

  const gameId = "test-game-id";
  const hostWindow = { localStorage: makeHostStorage(), sessionStorage: makeHostStorage() };
  const hostContext = { window: hostWindow };
  vm.runInNewContext(
    bridgeBlock + "\nglobalThis.buildStorageBridge = kuroBuildGameFrameStorageBridge;",
    hostContext
  );

  hostWindow.localStorage.setItem(
    "kuro_game_frame_storage_v1:" + gameId,
    JSON.stringify({ existing: "saved-value" })
  );
  const bridgeHtml = hostContext.buildStorageBridge(gameId);
  const script = bridgeHtml.replace(/^<script>/, "").replace(/<\/script>$/, "");
  const messages = [];
  const frameWindow = {};
  vm.runInNewContext(script, {
    window: frameWindow,
    parent: { postMessage(message) { messages.push(message); } },
    DOMException
  });

  assert.equal(frameWindow.localStorage.getItem("existing"), "saved-value");
  frameWindow.localStorage.setItem("score", "42");
  frameWindow.localStorage.theme = "dark";
  assert.equal(frameWindow.localStorage.getItem("score"), "42");
  assert.equal(frameWindow.localStorage.theme, "dark");
  assert.equal(frameWindow.localStorage.length, 3);
  assert.equal(frameWindow.localStorage.key(1), "score");

  frameWindow.sessionStorage.setItem("round", "2");
  assert.equal(frameWindow.sessionStorage.getItem("round"), "2");
  frameWindow.localStorage.removeItem("score");
  assert.equal(frameWindow.localStorage.getItem("score"), null);

  assert.deepEqual(
    messages.map(message => [message.gameId, message.storageType, message.action]),
    [
      [gameId, "local", "set"],
      [gameId, "local", "set"],
      [gameId, "session", "set"],
      [gameId, "local", "remove"]
    ]
  );
});
