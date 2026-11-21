const SUPABASE_URL = "https://cprvpphlfpmiegjiutjn.supabase.co";

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequest({ request }) {
  try {
    const incoming = new URL(request.url);
    const prefix = "/api/realtime";
    const suffix = incoming.pathname.slice(prefix.length);

    if (!suffix.startsWith("/v1/") || suffix.includes("..") || suffix.includes("://")) {
      return json({ error: "Realtime path is not allowed" }, 404);
    }

    const upstreamUrl = new URL("/realtime" + suffix + incoming.search, SUPABASE_URL);
    if (upstreamUrl.origin !== SUPABASE_URL) {
      return json({ error: "Invalid Realtime origin" }, 400);
    }

    if ((request.headers.get("Upgrade") || "").toLowerCase() === "websocket") {
      const headers = new Headers({ Upgrade: "websocket" });
      const origin = request.headers.get("Origin");
      const protocol = request.headers.get("Sec-WebSocket-Protocol");
      if (origin) headers.set("Origin", origin);
      if (protocol) headers.set("Sec-WebSocket-Protocol", protocol);

      const upstream = await fetch(upstreamUrl.href, { headers });
      if (!upstream.webSocket) {
        return new Response(upstream.body, {
          status: upstream.status,
          headers: upstream.headers
        });
      }

      return new Response(null, {
        status: 101,
        webSocket: upstream.webSocket
      });
    }

    const upstream = await fetch(new Request(upstreamUrl.href, request));
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstream.headers
    });
  } catch (error) {
    return json({
      error: error && error.message ? error.message : "KURO Cloudflare Realtime relay failed"
    }, 502);
  }
}
