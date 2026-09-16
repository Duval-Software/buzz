const backend = "https://api-dev.creatorhive.ai";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const api = /^\/(?:api|keeper|upload)(?:\/|$)/.test(url.pathname);
    if (api || url.pathname === "/relay-info" || url.pathname === "/backend-build-info.json") {
      const path = url.pathname === "/relay-info" ? "/info" : url.pathname === "/backend-build-info.json" ? "/assets/release.json" : url.pathname;
      const target = new URL(path, backend);
      target.search = url.search;
      const upstream = new Request(target, request);
      upstream.headers.delete("Cookie");
      try {
        const response = await fetch(upstream, { redirect: "manual" });
        const result = new Response(response.body, response);
        result.headers.set("Cache-Control", "no-store");
        return result;
      } catch {
        return Response.json({ error: "The development backend is unavailable. Please retry shortly." }, { status: 502, headers: { "Cache-Control": "no-store" } });
      }
    }
    const response = await env.ASSETS.fetch(request);
    const result = new Response(response.body, response);
    result.headers.set("X-Robots-Tag", "noindex, nofollow");
    if (response.headers.get("Content-Type")?.includes("text/html") || url.pathname === "/sw.js" || url.pathname === "/build-info.json") {
      result.headers.set("Cache-Control", "no-cache");
    }
    return result;
  },
};
