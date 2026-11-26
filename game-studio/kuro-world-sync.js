(() => {
  "use strict";

  const GAME_ID = "d5cb7d40-5c7e-4b41-a2a6-f0db55a87b7d";
  const ctx = window.KURO_WORLD_CONTEXT;
  const status = document.getElementById("worldStatus");
  if (!ctx || !window.KuroGames) {
    if (status) status.textContent = "共有ワールドを読み込めませんでした";
    return;
  }

  let room = null;
  let ownUserId = "";
  let capturing = true;
  let ready = false;
  let loading = false;
  let flushBusy = false;
  let flushTimer = 0;
  let lastPresenceAt = 0;
  let lastSentPosition = null;
  let lastFrameAt = 0;
  const pendingBlocks = new Map();
  const queuedRemoteBlocks = [];
  const remotePlayers = new Map();

  function setStatus(message) {
    if (status) status.textContent = String(message || "");
  }

  function blockKey(x, y, z) {
    return x + ctx.N * (z + ctx.N * y);
  }

  function decodeBlockKey(key) {
    const y = Math.floor(key / (ctx.N * ctx.N));
    const rest = key - y * ctx.N * ctx.N;
    const z = Math.floor(rest / ctx.N);
    return { x: rest - z * ctx.N, y, z };
  }

  function applyBlocks(changes) {
    if (!Array.isArray(changes)) return;
    window.KURO_WORLD_APPLYING = true;
    try {
      for (const change of changes) {
        const key = Number(change && change.key);
        const value = Number(change && change.value);
        if (!Number.isSafeInteger(key) || key < 0 || key >= ctx.N * ctx.N * ctx.TOP ||
            !Number.isInteger(value) || value < 0 || value > 255) continue;
        const point = decodeBlockKey(key);
        if (!ctx.isInside(point.x, point.y, point.z)) continue;
        ctx.applyBlock(point.x, point.y, point.z, value);
      }
    } finally {
      window.KURO_WORLD_APPLYING = false;
    }
  }

  function scheduleFlush() {
    if (flushTimer || !ready || !pendingBlocks.size) return;
    flushTimer = setTimeout(() => {
      flushTimer = 0;
      void flushBlocks();
    }, 400);
  }

  async function flushBlocks() {
    if (!ready || !room || flushBusy || !pendingBlocks.size) return;
    flushBusy = true;
    const batch = Array.from(pendingBlocks.entries()).slice(0, 120);
    batch.forEach(([key]) => pendingBlocks.delete(key));
    const changes = batch.map(([key, value]) => ({ key, value }));
    try {
      await KuroGames.world.saveBlocks(changes);
      room.send("world-blocks", { changes }).catch(error => {
        console.warn("[KURO world] broadcast failed; saved data is retained", error);
      });
    } catch (error) {
      batch.forEach(([key, value]) => pendingBlocks.set(key, value));
      setStatus("地形データを再保存中...");
      console.warn("[KURO world] block save failed", error);
    } finally {
      flushBusy = false;
      if (pendingBlocks.size) scheduleFlush();
    }
  }

  window.KURO_WORLD_ON_BLOCK_CHANGE = (x, y, z, value) => {
    if (!capturing || window.KURO_WORLD_APPLYING || !ctx.isInside(x, y, z)) return;
    pendingBlocks.set(blockKey(x, y, z), value);
    scheduleFlush();
  };

  function removeRemotePlayer(id) {
    const player = remotePlayers.get(id);
    if (!player) return;
    ctx.scene.remove(player.avatar);
    ctx.scene.remove(player.tag);
    if (player.tag.material && player.tag.material.map) player.tag.material.map.dispose();
    if (player.tag.material) player.tag.material.dispose();
    remotePlayers.delete(id);
  }

  function ensureRemotePlayer(member) {
    const id = String(member && member.userId || "");
    if (!id || id === ownUserId) return null;
    const name = String(member.displayName || member.username || "プレイヤー").slice(0, 24);
    let player = remotePlayers.get(id);
    if (!player) {
      const avatar = ctx.makeAvatar();
      ctx.scene.add(avatar);
      const tag = ctx.makeNameTag(name);
      avatar.visible = false;
      tag.visible = false;
      player = {
        avatar,
        tag,
        name,
        target: ctx.makeVector(ctx.player.p.x, ctx.player.p.y, ctx.player.p.z),
        yaw: 0,
        dimension: ctx.dimension,
        hasPosition: false,
      };
      remotePlayers.set(id, player);
    } else if (player.name !== name) {
      ctx.scene.remove(player.tag);
      if (player.tag.material && player.tag.material.map) player.tag.material.map.dispose();
      if (player.tag.material) player.tag.material.dispose();
      player.tag = ctx.makeNameTag(name);
      player.name = name;
    }
    return player;
  }

  function updateRoster(players) {
    const active = new Set();
    (players || []).forEach(member => {
      const id = String(member && member.userId || "");
      if (!id || id === ownUserId) return;
      active.add(id);
      ensureRemotePlayer(member);
    });
    Array.from(remotePlayers.keys()).forEach(id => {
      if (!active.has(id)) removeRemotePlayer(id);
    });
    setStatus("共有ワールド · " + (players || []).length + "/35人");
  }

  function receivePresence(event) {
    if (!event || event.from === ownUserId || !event.data) return;
    const data = event.data;
    const x = Number(data.x), y = Number(data.y), z = Number(data.z);
    if (![x, y, z].every(Number.isFinite) ||
        x < 0 || x >= ctx.N || z < 0 || z >= ctx.N ||
        y < 0 || y >= ctx.TOP + 8) return;
    const player = remotePlayers.get(String(event.from));
    if (!player) return;
    player.target.set(x, y, z);
    player.yaw = Number(data.yaw) || 0;
    player.dimension = Number(data.dimension) === 1 ? 1 : 0;
    player.hasPosition = true;
  }

  function tick(now) {
    const dt = lastFrameAt ? Math.min(0.05, (now - lastFrameAt) / 1000) : 0.016;
    lastFrameAt = now;
    const currentDimension = ctx.dimension;
    remotePlayers.forEach(player => {
      if (!player.hasPosition || player.dimension !== currentDimension) {
        player.avatar.visible = false;
        player.tag.visible = false;
        return;
      }
      player.avatar.visible = true;
      player.tag.visible = true;
      player.avatar.position.lerp(player.target, Math.min(1, dt * 8));
      player.avatar.rotation.y += Math.atan2(
        Math.sin(player.yaw - player.avatar.rotation.y),
        Math.cos(player.yaw - player.avatar.rotation.y)
      ) * Math.min(1, dt * 9);
      player.tag.position.set(
        player.avatar.position.x,
        player.avatar.position.y + 2.25,
        player.avatar.position.z
      );
    });

    if (room && !ctx.titleOpen && now - lastPresenceAt >= 450) {
      const p = ctx.player;
      const current = {
        x: p.p.x, y: p.p.y, z: p.p.z,
        yaw: p.g.rotation.y || 0, dimension: currentDimension,
      };
      const old = lastSentPosition;
      const moved = !old ||
        Math.hypot(current.x - old.x, current.y - old.y, current.z - old.z) > 0.045 ||
        Math.abs(Math.atan2(Math.sin(current.yaw - old.yaw), Math.cos(current.yaw - old.yaw))) > 0.035 ||
        old.dimension !== current.dimension;
      if (moved) {
        lastPresenceAt = now;
        lastSentPosition = current;
        room.send("world-player", current).catch(() => {});
      }
    }
    requestAnimationFrame(tick);
  }

  async function start() {
    try {
      const config = await KuroGames.init({ gameId: GAME_ID });
      if (!config || !config.features || config.features.multiplayer !== true) {
        capturing = false;
        pendingBlocks.clear();
        window.parent.postMessage({ type: "kuro-online-login-required", action: "world" }, "*");
        throw new Error("共有ワールドへの参加にはKURO GAMESへのログインが必要です。");
      }

      const profile = await KuroGames.auth.getProfile();
      const authUser = await KuroGames.auth.getUser();
      const username = String(profile && profile.username || "").trim();
      if (!username || !authUser || !authUser.id) {
        throw new Error("KUROプロフィールを確認できませんでした。再ログインしてください。");
      }
      ownUserId = String(authUser.id);
      ctx.setUsername(username.slice(0, 24));

      room = await KuroGames.multiplayer.joinSharedWorld();
      loading = true;
      room.onPlayersChange(updateRoster);
      room.onMessage(event => {
        if (!event || !event.data) return;
        if (event.type === "world-player") {
          receivePresence(event);
        } else if (event.type === "world-blocks" && Array.isArray(event.data.changes)) {
          if (loading) queuedRemoteBlocks.push(event.data.changes);
          else applyBlocks(event.data.changes);
        }
      });

      const saved = await KuroGames.world.getBlocks({ limit: 5000 });
      applyBlocks(saved);
      // Apply local edits made while the saved world snapshot was loading.
      applyBlocks(Array.from(pendingBlocks.entries()).map(([key, value]) => ({ key, value })));
      queuedRemoteBlocks.forEach(applyBlocks);
      queuedRemoteBlocks.length = 0;
      loading = false;
      ready = true;
      scheduleFlush();

      updateRoster(room.getPlayers());
      setStatus("共有ワールド接続中 · " + room.getPlayers().length + "/35人");
      const p = ctx.player;
      room.send("world-player", {
        x: p.p.x, y: p.p.y, z: p.p.z,
        yaw: p.g.rotation.y || 0, dimension: ctx.dimension,
      }).catch(() => {});
      note("共有ワールドに接続しました");
    } catch (error) {
      console.warn("[KURO shared world]", error);
      const message = error && error.message ? error.message : "共有ワールドに接続できませんでした。";
      setStatus("オフライン · " + message);
      note(message);
    }
  }

  requestAnimationFrame(tick);
  void start();
  window.addEventListener("pagehide", () => {
    capturing = false;
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
    if (room) {
      if (pendingBlocks.size && ready) void flushBlocks().finally(() => room && room.leave());
      else void room.leave();
    }
  });
})();