(function () {
  "use strict";
  if (window.__kuroUsageTrackerInstalled) return;
  window.__kuroUsageTrackerInstalled = true;

  var SUPABASE_URL = "https://cprvpphlfpmiegjiutjn.supabase.co";
  var PUBLISHABLE_KEY = "sb_publishable_BYPUfB0lr2h26jV8_6ZQnpQ_wfAKOVyn";
  var userId = null;
  var visitorId = null;
  var client = null;
  var queue = [];
  var sending = false;
  var flushTimer = null;
  var sessionId = null;
  var sessionFresh = false;
  var trackedPage = false;
  var lastApiErrorAt = Object.create(null);

  function makeId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }

  function getSession() {
    var key = "kuro_usage_session", startedKey = "kuro_usage_session_started";
    var id = null, started = null;
    try { id = sessionStorage.getItem(key); started = sessionStorage.getItem(startedKey); } catch (_) {}
    if (!id) {
      id = makeId();
      try { sessionStorage.setItem(key, id); } catch (_) {}
    }
    sessionFresh = started !== id;
    if (sessionFresh) {
      try { sessionStorage.setItem(startedKey, id); } catch (_) {}
    }
    sessionId = id;
    return { id: id };
  }

  function serviceFor(input) {
    var raw = typeof input === "string" ? input : (input && input.url) || "";
    var u;
    try { u = new URL(raw, location.href); } catch (_) { return null; }
    var host = u.hostname.toLowerCase(), path = u.pathname.toLowerCase();
    if (host === "api.open-meteo.com" || host === "geocoding-api.open-meteo.com") return "weather";
    if (host === "api.microlink.io") return "ogp";
    if (/youtube|googleapis/.test(host)) return "youtube";
    if (u.origin === location.origin && path === "/api/workspace-rss") return "rss";
    if (host === "script.google.com" || (u.origin === location.origin && path === "/api/kuro-gas-proxy")) return "gas_proxy";
    if (host.endsWith(".supabase.co")) {
      if (path.startsWith("/auth/")) return "supabase_auth";
      if (path.startsWith("/storage/")) return "supabase_storage";
      if (path.startsWith("/functions/")) return "supabase_edge";
      return "supabase_data_api";
    }
    if (u.origin === location.origin && path.startsWith("/api/")) return "other_api";
    return null;
  }

  function addEvent(name, extra) {
    if (!visitorId || !client) return;
    var row = {
      user_id: userId || null,
      visitor_id: visitorId,
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
    if (sending || !client || !visitorId || !queue.length) return;
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
      if (service && !sending && response.status >= 400) {
        // 同じサービス・ステータスの連続エラーは1分に1件だけ記録する。
        var key = service + ":" + response.status;
        var now = Date.now();
        if (!lastApiErrorAt[key] || now - lastApiErrorAt[key] > 60000) {
          lastApiErrorAt[key] = now;
          addEvent("api_error", { service_key: service, status_code: response.status, error_code: "http_" + response.status });
        }
      } else if (service && !sending && service !== "supabase_data_api" && service !== "supabase_auth") {
        // Supabaseの通常成功リクエストは件数が多いため記録対象から除外する。
        addEvent("api_success", { service_key: service, status_code: response.status });
      }
      return response;
    }).catch(function (error) {
      if (service && !sending && !/abort/i.test(String(error && error.message || error))) {
        var key = service + ":network";
        var now = Date.now();
        if (!lastApiErrorAt[key] || now - lastApiErrorAt[key] > 60000) {
          lastApiErrorAt[key] = now;
          addEvent("api_error", { service_key: service, error_code: "network_error" });
        }
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
    // Random first-party visitor ID; no account details are stored in this ID.
    try {
      visitorId = localStorage.getItem("kuro_portal_guest_id");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(visitorId || "")) {
        visitorId = makeId();
        localStorage.setItem("kuro_portal_guest_id", visitorId);
      }
    } catch (_) {
      visitorId = makeId();
    }

    if (!(await loadSdk())) return;
    client = window.supabase.createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: true, detectSessionInUrl: false }
    });
    var result = await client.auth.getSession();
    userId = result && result.data && result.data.session && result.data.session.user
      ? result.data.session.user.id
      : null;

    var session = getSession();
    if (!trackedPage) {
      trackedPage = true;
      if (sessionFresh) addEvent("session_start");
      addEvent("page_view");
    }
    client.auth.onAuthStateChange(function (event, sessionData) {
      userId = sessionData && sessionData.user ? sessionData.user.id : null;
    });
  }

  start().catch(function () {});
})();