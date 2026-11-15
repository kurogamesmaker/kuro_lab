import { onRequest as gasProxy } from "./functions/api/kuro-gas-proxy.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

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
