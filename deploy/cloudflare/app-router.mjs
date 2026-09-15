// Deploy as a Worker ROUTE over the existing proxied Hetzner A record, not a
// custom-domain origin. fetch(request) then preserves Caddy's host and signed
// backend URLs. Never attach this router to the Pages hostname itself.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname !== "app.creatorhive.ai") {
      return new Response("Not found", { status: 404 });
    }
    const publicProfile = /^\/(?:@|%40)[a-zA-Z][a-zA-Z0-9_]{2,23}\/?$/.test(url.pathname);
    const page = publicProfile || /^\/(?:$|(?:chat|onboarding|profile|pulse|live|inbox|workflows|agents|community|invite|repos)(?:\/|$))/.test(url.pathname);
    const asset = /^\/(?:assets\/|icons\/|creatorhive-logo\.png$|manifest\.webmanifest$|sw\.js$)/.test(url.pathname);
    if (
      !["GET", "HEAD"].includes(request.method) ||
      request.headers.has("Upgrade") ||
      (!page && !asset)
    ) {
      return fetch(request);
    }

    // Public frontend files need no cookies, authorization, or callback query.
    const target = new URL(page ? "/" : url.pathname, env.FRONTEND_ORIGIN);
    const response = await fetch(target, {
      method: request.method,
      redirect: "manual",
    });
    // Tabs opened before cutover may still request the old build's chunks.
    if (asset && (response.status === 404 || response.headers.get("Content-Type")?.includes("text/html"))) {
      return fetch(request);
    }
    const result = new Response(response.body, response);
    result.headers.set("X-CreatorHive-Frontend", "cloudflare-pages");
    if (page || url.pathname === "/sw.js") result.headers.set("Cache-Control", "no-cache");
    if (publicProfile) result.headers.set("X-Robots-Tag", "noindex, nofollow");
    return result;
  },
};
