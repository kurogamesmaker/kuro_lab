(function () {
  "use strict";
  if (window.__kuroUsageTrackerInstalled) return;
  window.__kuroUsageTrackerInstalled = true;

  var SUPABASE_URL = "https://cprvpphlfpmiegjiutjn.supabase.co";
  var PUBLISHABLE_KEY = "sb_publishable_BYPUfB0lr2h26jV8_6ZQnpQ_wfAKOVyn";
  var userId = null;
  var client = null;
  var queue = [];
  var sending = false;
  var flushTimer = null;
  var sessionId = null;
  var sessionFresh = false;
  var trackedPage = false;

  function makeId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }

  function getSession() {
    var now = Date.now(), state = null, key = "kuro_usage_session";
    try { state = JSON.parse(sessionStorage.getItem(key) || "null"); } catch (_) {}
    sessionFresh = !state || !state.id || !state.lastAt || now - Number(state.lastAt) > 1800000;
    if (sessionFresh) state = { id: makeId(), lastAt: now };
    else state.lastAt = now;
    try { sessionStorage.setItem(key, JSON.stringify(state)); } catch (_) {}
    sessionId = state.id;
    return state;
  }

  function serviceFor(input) {
    var raw = typeof input === "string" ? input : (input && input.url) || "";
    var u;
    try { u = new URL(raw, location.href); } catch (_) { return null; }
    var host = u.hostname.toLowerCase(), path = u.pathname.toLowerCase();
    if (host === "api.open-meteo.com" || host === "geocoding-api.open-meteo.com") return "weather";
    if (host === "api.microlink.io") return "ogp";
    if (u.origin === location.origin && path === "/api/workspace-rss") return "rss";
    if (host.endsWith(".supabase.co")) {
      if (path.startsWith("/auth/")) return "supabase_auth";
      if (path.startsWith("/storage/")) return "supabase_storage";
      if (path.startsWith("/functions/")) return "supabase_edge";
      return "supabase_data_api";
    }
    if (u.origin === location.origin && path.startsWith("/api/") && path !== "/api/kuro-gas-proxy") return "other_api";
    return null;
  }

  function addEvent(name, extra) {
    if (!userId || !client) return;
    var row = {
      user_id: userId,
      session_id: sessionId || getSession().id,
      event_name: name,
      page_key: (location.pathname.split("/").filter(Boolean)[0] || "home").replace(/[^a-zA-Z0-9_/-]/g, "").slice(0, 64) || "home"
    };
    extra = extra || {};
    if (extra.service_key) row.service_key = extra.service_key;
    if (Number.isInteger(extra.status_code) && extra.status_code >= 100 && extra.status_code <= 599) row.status_code = extra.status_code;
    if (extra.error_code) row.error_code = String(extra.error_code).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    queue.push(row);
    if (queue.length > 100) queue.splice(0, queue.length - 100);
    if (queue.length >= 10) flush();
    else if (!flushTimer) flushTimer = setTimeout(function () { flushTimer = null; flush(); }, 5000);
  }

  function flush() {
    if (sending || !client || !userId || !queue.length) return;
    var batch = queue.splice(0, 30);
    sending = true;
    Promise.resolve(client.from("usage_events").insert(batch)).then(function (result) {
      if (result && result.error) console.warn("KURO usage log could not be saved");
    }).catch(function () {
      console.warn("KURO usage log transport failed");
    }).finally(function () {
      sending = false;
      if (queue.length && !flushTimer) flushTimer = setTimeout(function () { flushTimer = null; flush(); }, 1000);
    });
  }

  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var service = serviceFor(input);
    return nativeFetch(input, init).then(function (response) {
      if (service && !sending) {
        if (response.status >= 400) addEvent("api_error", { service_key: service, status_code: response.status, error_code: "http_" + response.status });
        else addEvent("api_success", { service_key: service, status_code: response.status });
      }
      return response;
    }).catch(function (error) {
      if (service && !sending && !/abort/i.test(String(error && error.message || error))) {
        addEvent("api_error", { service_key: service, error_code: "network_error" });
      }
      throw error;
    });
  };

  window.addEventListener("error", function (event) {
    if (event && event.message) addEvent("client_error", { error_code: "script_error" });
  });
  window.addEventListener("unhandledrejection", function (event) {
    var message = String(event && event.reason && event.reason.message || event && event.reason || "");
    if (!/abort/i.test(message)) addEvent("client_error", { error_code: "unhandled_rejection" });
  });
  window.addEventListener("pagehide", flush);

  // Track dashboard widgets without collecting their settings or contents.
  var previousWidgetIds = null;
  var viewedWidgetIds = new Set();
  var widgetObserver = null;
  function scanDashboardWidgets() {
    var grid = document.querySelector("#portal-dashboard-grid");
    if (!grid) return;
    var nodes = Array.prototype.slice.call(grid.querySelectorAll(".portal-widget[data-widget-id]"));
    var current = new Set(nodes.map(function (node) { return String(node.dataset.widgetId || "").slice(0, 64); }).filter(Boolean));
    if (previousWidgetIds) {
      current.forEach(function (id) { if (!previousWidgetIds.has(id)) addEvent("widget_added", { widget_key: id }); });
      previousWidgetIds.forEach(function (id) { if (!current.has(id)) addEvent("widget_removed", { widget_key: id }); });
    }
    previousWidgetIds = current;
    if (!("IntersectionObserver" in window)) {
      nodes.forEach(function (node) {
        var id = node.dataset.widgetId;
        if (id && !viewedWidgetIds.has(id)) { viewedWidgetIds.add(id); addEvent("widget_view", { widget_key: id }); }
      });
      return;
    }
    if (!widgetObserver) {
      widgetObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.25) return;
          var id = entry.target && entry.target.dataset ? entry.target.dataset.widgetId : "";
          if (id && !viewedWidgetIds.has(id)) { viewedWidgetIds.add(id); addEvent("widget_view", { widget_key: id }); }
          widgetObserver.unobserve(entry.target);
        });
      }, { threshold: [0.25] });
    }
    nodes.forEach(function (node) { if (!viewedWidgetIds.has(node.dataset.widgetId)) widgetObserver.observe(node); });
  }
  window.addEventListener("kuro:portal-rendered", scanDashboardWidgets);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scanDashboardWidgets, { once: true });
  else setTimeout(scanDashboardWidgets, 0);
  var dashboardRoot = document.getElementById("portal-main");
  if (dashboardRoot && "MutationObserver" in window) {
    new MutationObserver(scanDashboardWidgets).observe(dashboardRoot, { childList: true, subtree: true });
  }

  function loadSdk() {
    if (window.supabase && typeof window.supabase.createClient === "function") return Promise.resolve(true);
    return new Promise(function (resolve) {
      var script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      script.onload = function () { resolve(!!(window.supabase && window.supabase.createClient)); };
      script.onerror = function () { resolve(false); };
      document.head.appendChild(script);
    });
  }

  async function start() {
    try {
      // Avoid loading the SDK on anonymous sessions; the tracker is account-only.
      if (!localStorage.getItem("sb-cprvpphlfpmiegjiutjn-auth-token")) return;
    } catch (_) { return; }

    if (!(await loadSdk())) return;
    client = window.supabase.createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: true, detectSessionInUrl: false }
    });
    var result = await client.auth.getSession();
    userId = result && result.data && result.data.session && result.data.session.user
      ? result.data.session.user.id
      : null;
    if (!userId) return;

    var session = getSession();
    if (!trackedPage) {
      trackedPage = true;
      if (sessionFresh) addEvent("session_start");
      addEvent("page_view");
    }
    client.auth.onAuthStateChange(function (event, sessionData) {
      userId = sessionData && sessionData.user ? sessionData.user.id : null;
      if (event === "SIGNED_OUT") queue = [];
    });
  }

  start().catch(function () {});
})();