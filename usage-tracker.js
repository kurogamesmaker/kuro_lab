(function () {
  "use strict";
  if (window.__kuroUsageTrackerInstalled) return;
  window.__kuroUsageTrackerInstalled = true;

  // Telemetry uses the same-origin Cloudflare relay. Do not create another GoTrueClient:
  // the page's main Supabase client owns the auth session.
  var PUBLISHABLE_KEY = "sb_publishable_BYPUfB0lr2h26jV8_6ZQnpQ_wfAKOVyn";
  var visitorId = null, sessionId = null, queue = [], sending = false, timer = null;
  var lastApiErrorAt = Object.create(null);
  var nativeFetch = window.fetch.bind(window);

  function makeId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }
  function storageGet(store, key) { try { return window[store].getItem(key); } catch (_) { return null; } }
  function storageSet(store, key, value) { try { window[store].setItem(key, value); } catch (_) {} }

  function authInfo() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || !/^sb-.+-auth-token$/.test(key)) continue;
        var saved = JSON.parse(localStorage.getItem(key) || "null");
        var token = saved && saved.access_token;
        if (!token) continue;
        var part = token.split(".")[1];
        var payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
        return { token: token, userId: payload.sub || null };
      }
    } catch (_) {}
    return { token: PUBLISHABLE_KEY, userId: null };
  }

  function addEvent(name, extra) {
    if (!visitorId || !sessionId) return;
    var auth = authInfo();
    var row = {
      user_id: auth.userId,
      visitor_id: visitorId,
      session_id: sessionId,
      event_name: name,
      page_key: (location.pathname.split("/").filter(Boolean)[0] || "home").replace(/[^a-zA-Z0-9_/-]/g, "").slice(0, 64) || "home"
    };
    extra = extra || {};
    if (extra.service_key) row.service_key = extra.service_key;
    if (Number.isInteger(extra.status_code) && extra.status_code >= 100 && extra.status_code <= 599) row.status_code = extra.status_code;
    if (extra.error_code) row.error_code = String(extra.error_code).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    if (extra.widget_key && /^[a-zA-Z0-9_-]{1,64}$/.test(extra.widget_key)) row.widget_key = extra.widget_key;
    queue.push(row);
    if (queue.length > 100) queue.splice(0, queue.length - 100);
    if (queue.length >= 10) flush();
    else if (!timer) timer = setTimeout(function () { timer = null; flush(); }, 5000);
  }

  function flush() {
    if (sending || !queue.length) return;
    var batch = queue.splice(0, 30), auth = authInfo();
    var bytes = new TextEncoder().encode(JSON.stringify(batch));
    var binary = "";
    for (var i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
    sending = true;
    nativeFetch("/api/cloudflare-relay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "/rest/v1/usage_events",
        method: "POST",
        headers: {
          "apikey": PUBLISHABLE_KEY,
          "Authorization": "Bearer " + auth.token,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        bodyBase64: btoa(binary),
        clientId: visitorId
      }),
      keepalive: true
    }).then(function (response) {
      if (!response.ok) console.debug("KURO usage telemetry skipped");
      else return response.json().then(function (result) {
        if (!result || typeof result.status !== "number" || result.status < 200 || result.status >= 300) {
          console.debug("KURO usage telemetry skipped");
        }
      });
    }).catch(function () {
      // Telemetry must never interrupt the SNS or portal experience.
    }).finally(function () {
      sending = false;
      if (queue.length && !timer) timer = setTimeout(function () { timer = null; flush(); }, 1000);
    });
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
    if (u.origin === location.origin && path === "/api/cloudflare-relay") return null;
    if (host.endsWith(".supabase.co")) {
      if (path.startsWith("/auth/")) return "supabase_auth";
      if (path.startsWith("/storage/")) return "supabase_storage";
      if (path.startsWith("/functions/")) return "supabase_edge";
      return "supabase_data_api";
    }
    if (u.origin === location.origin && path.startsWith("/api/")) return "other_api";
    return null;
  }

  window.fetch = function (input, init) {
    var service = serviceFor(input);
    return nativeFetch(input, init).then(function (response) {
      if (service && response.status >= 400) {
        var key = service + ":" + response.status, now = Date.now();
        if (!lastApiErrorAt[key] || now - lastApiErrorAt[key] > 60000) {
          lastApiErrorAt[key] = now;
          addEvent("api_error", { service_key: service, status_code: response.status, error_code: "http_" + response.status });
        }
      } else if (service && service !== "supabase_data_api" && service !== "supabase_auth") {
        addEvent("api_success", { service_key: service, status_code: response.status });
      }
      return response;
    }).catch(function (error) {
      if (service && !/abort/i.test(String(error && error.message || error))) {
        var key = service + ":network", now = Date.now();
        if (!lastApiErrorAt[key] || now - lastApiErrorAt[key] > 60000) {
          lastApiErrorAt[key] = now;
          addEvent("api_error", { service_key: service, error_code: "network_error" });
        }
      }
      throw error;
    });
  };

  try {
    visitorId = storageGet("localStorage", "kuro_portal_guest_id");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(visitorId || "")) {
      visitorId = makeId();
      storageSet("localStorage", "kuro_portal_guest_id", visitorId);
    }
  } catch (_) { visitorId = makeId(); }
  sessionId = storageGet("sessionStorage", "kuro_usage_session");
  if (!sessionId) {
    sessionId = makeId();
    storageSet("sessionStorage", "kuro_usage_session", sessionId);
  }
  var startedKey = "kuro_usage_session_started";
  if (storageGet("sessionStorage", startedKey) !== sessionId) {
    storageSet("sessionStorage", startedKey, sessionId);
    addEvent("session_start");
  }
  addEvent("page_view");

  window.addEventListener("error", function (event) {
    if (event && event.message) addEvent("client_error", { error_code: "script_error" });
  });
  window.addEventListener("unhandledrejection", function (event) {
    var message = String(event && event.reason && event.reason.message || event && event.reason || "");
    if (!/abort/i.test(message)) addEvent("client_error", { error_code: "unhandled_rejection" });
  });
  window.addEventListener("pagehide", flush);

  var viewedWidgetIds = new Set(), widgetObserver = null;
  function scanDashboardWidgets() {
    var grid = document.querySelector("#portal-dashboard-grid");
    if (!grid) return;
    var nodes = Array.prototype.slice.call(grid.querySelectorAll(".portal-widget[data-widget-id]"));
    if ("IntersectionObserver" in window) {
      if (!widgetObserver) widgetObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.25) return;
          var id = entry.target && entry.target.dataset ? entry.target.dataset.widgetId : "";
          if (id && !viewedWidgetIds.has(id)) {
            viewedWidgetIds.add(id);
            addEvent("widget_view", { widget_key: id });
          }
          widgetObserver.unobserve(entry.target);
        });
      }, { threshold: [0.25] });
      nodes.forEach(function (node) {
        if (!viewedWidgetIds.has(node.dataset.widgetId)) widgetObserver.observe(node);
      });
    } else {
      nodes.forEach(function (node) {
        var id = node.dataset.widgetId;
        if (id && !viewedWidgetIds.has(id)) {
          viewedWidgetIds.add(id);
          addEvent("widget_view", { widget_key: id });
        }
      });
    }
  }
  window.addEventListener("kuro:portal-rendered", scanDashboardWidgets);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scanDashboardWidgets, { once: true });
  else setTimeout(scanDashboardWidgets, 0);
  var dashboardRoot = document.getElementById("portal-main");
  if (dashboardRoot && "MutationObserver" in window) {
    new MutationObserver(scanDashboardWidgets).observe(dashboardRoot, { childList: true, subtree: true });
  }
})();