/* KURO GAMES shared PlayFab client
 * Shared Title ID + anonymous player identity for all games under /game/.
 * Client-side only: never put a PlayFab Secret Key in this file.
 */
(() => {
  "use strict";
  const TITLE_ID = "1CB78B";
  let session = null;
  let loginPromise = null;

  function setStatus(message, error=false) {
    const el = document.getElementById("playfabInfo");
    if (!el) return;
    el.textContent = message;
    el.className = "text-xs font-bold " + (error ? "text-rose-700" : "text-emerald-700");
  }

  async function request(endpoint, body, ticket) {
    const headers = {"Content-Type":"application/json"};
    if (ticket) headers["X-Authorization"] = ticket;
    const response = await fetch("https://" + TITLE_ID.toLowerCase() + ".playfabapi.com/" + endpoint, {
      method:"POST", headers, body:JSON.stringify(body)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.error) {
      throw new Error(json.errorMessage || json.error || ("HTTP " + response.status));
    }
    return json.data || {};
  }

  async function login() {
    if (session) return session;
    if (loginPromise) return loginPromise;
    loginPromise = (async () => {
      let customId = "";
      try { customId = localStorage.getItem("kuro_playfab_custom_id") || ""; } catch (_) {}
      if (!customId) {
        customId = "kuro_" + (crypto.randomUUID
          ? crypto.randomUUID().replace(/-/g, "")
          : Date.now().toString(36) + Math.random().toString(36).slice(2));
        try { localStorage.setItem("kuro_playfab_custom_id", customId); } catch (_) {}
      }
      const data = await request("Client/LoginWithCustomID", {
        TitleId:TITLE_ID, CustomId:customId, CreateAccount:true
      });
      if (!data.SessionTicket || !data.PlayFabId) throw new Error("PlayFab login response is incomplete");
      session = {sessionTicket:data.SessionTicket, playFabId:data.PlayFabId};
      return session;
    })();
    try { return await loginPromise; }
    finally { loginPromise = null; }
  }

  async function submitScore(value, statisticName) {
    const score = Math.max(0, Math.floor(Number(value) || 0));
    if (!score || !/^[A-Za-z0-9_]{1,40}$/.test(statisticName)) return;
    setStatus("🌐 KUROランキングへスコア送信中...");
    try {
      const player = await login();
      await request("Client/UpdatePlayerStatistics", {
        Statistics:[{StatisticName:statisticName, Value:score}]
      }, player.sessionTicket);
      setStatus("☁️ PlayFabにスコアを保存しました！");
      return true;
    } catch (error) {
      console.warn("[KURO PlayFab]", error);
      setStatus("⚠️ オンライン未保存（端末内の記録は保存済み）", true);
      return false;
    }
  }

  window.KUROPlayFab = { titleId:TITLE_ID, login, submitScore, setStatus };
  login().then(() => setStatus("☁️ KUROランキング接続済み")).catch(error => {
    console.warn("[KURO PlayFab login]", error);
    setStatus("⚠️ オンライン未接続（ゲームはプレイ可能）", true);
  });
})();
