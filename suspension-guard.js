(() => {
  "use strict";

  // The dedicated support page is intentionally exempt.
  const SUPPORT_PATH = location.pathname === "/account/suspension" || location.pathname.indexOf("/account/suspension/") === 0;
  if (SUPPORT_PATH) return;

  const PROJECT_REF = "cprvpphlfpmiegjiutjn";
  const PUBLISHABLE_KEY = "sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn";
  const STORAGE_KEY = "sb-" + PROJECT_REF + "-auth-token";
  const RELAY_URL = "/api/cloudflare-relay";
  let checking = false;
  let initialCheckPending = true;
  let redirected = false;
  let lastCheckAt = 0;

  function getSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const stored = JSON.parse(raw);
      return stored && (stored.currentSession || stored);
    } catch (_) {
      return null;
    }
  }

  function hideInitialPage() {
    if (initialCheckPending) document.documentElement.style.visibility = "hidden";
  }

  function showPage() {
    if (initialCheckPending) {
      document.documentElement.style.visibility = "";
      initialCheckPending = false;
    }
  }

  async function check() {
    if (checking || redirected || SUPPORT_PATH) return;
    const session = getSession();
    const userId = session && session.user && session.user.id;
    const accessToken = session && session.access_token;
    if (!userId || !accessToken || session.user.is_anonymous) {
      showPage();
      return;
    }

    const nowMs = Date.now();
    if (nowMs - lastCheckAt < 1200) return;
    lastCheckAt = nowMs;
    checking = true;
    hideInitialPage();
    let requestTimeout = null;

    try {
      const now = new Date().toISOString();
      const params = new URLSearchParams({
        select: "id",
        user_id: "eq." + userId,
        revoked_at: "is.null",
        starts_at: "lte." + now,
        ends_at: "gt." + now,
        limit: "1"
      });
      // Never leave the whole page invisible if the relay stalls.
      // Server-side writes remain protected by the Worker suspension check.
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      requestTimeout = controller
        ? window.setTimeout(() => controller.abort(), 6000)
        : null;
      const response = await fetch(RELAY_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: "/rest/v1/account_suspensions?" + params.toString(),
          method: "GET",
          headers: {
            apikey: PUBLISHABLE_KEY,
            authorization: "Bearer " + accessToken,
            accept: "application/json"
          },
          bodyBase64: "",
          clientId: "suspension-guard"
        }),
        cache: "no-store",
        credentials: "same-origin",
        signal: controller ? controller.signal : undefined
      });
      if (!response.ok) throw new Error("suspension status relay returned " + response.status);
      const result = await response.json();
      if (!result || typeof result.status !== "number") throw new Error("invalid suspension status response");
      if (result.status === 401 || result.status === 403) return;
      if (result.status < 200 || result.status >= 300) throw new Error("suspension status query returned " + result.status);
      const rows = JSON.parse(result.bodyText || "[]");
      if (Array.isArray(rows) && rows.length) {
        redirected = true;
        location.replace("/account/suspension/");
        return;
      }
    } catch (error) {
      // Fetch may be aborted by the six-second timeout or page navigation.
      // This check is non-blocking; only report unexpected failures.
      if (!error || error.name !== "AbortError") {
        console.warn("KURO global suspension guard check failed:", error);
      }
    } finally {
      if (requestTimeout) window.clearTimeout(requestTimeout);
      checking = false;
      if (!redirected) showPage();
    }
  }

  check();
  window.setInterval(() => {
    if (document.visibilityState !== "hidden") check();
  }, 10000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
  window.addEventListener("focus", check);
  window.addEventListener("pageshow", check);
  window.addEventListener("storage", event => {
    if (!event.key || event.key === STORAGE_KEY) check();
  });
})();