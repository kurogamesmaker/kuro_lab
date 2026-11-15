import { onRequest as gasProxy } from "./functions/api/kuro-gas-proxy.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Separate hostname for the private administration console.
    if (url.hostname === "admin.kurolab.cc.cd") {
      if (url.pathname === "/") url.pathname = "/admin/index.html";
      const response = await env.ASSETS.fetch(new Request(url, request));
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "private, no-store, max-age=0");
      headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    // Preserve the existing Pages Function endpoint on the Workers runtime.
    if (url.pathname === "/api/kuro-gas-proxy") {
      return gasProxy({
        request,
        env,
        params: {},
        waitUntil: (promise) => ctx.waitUntil(promise),
        next: () => env.ASSETS.fetch(request)
      });
    }

    // All other requests are served by Workers Static Assets.
    return env.ASSETS.fetch(request);
  }
};
