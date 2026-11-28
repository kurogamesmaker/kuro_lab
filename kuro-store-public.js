(function () {
  "use strict";
  window.kuroLoadPublicStoreCosmetics = async function (userId) {
    const id = String(userId || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error("プロフィールIDが正しくありません。");
    }
    const response = await fetch("/api/kuro-economy/public-cosmetics?userId=" + encodeURIComponent(id), {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Accept": "application/json" }
    });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok || !payload || !payload.cosmetics) {
      throw new Error(payload && payload.error || "装備情報を取得できませんでした。");
    }
    return payload.cosmetics;
  };
})();
