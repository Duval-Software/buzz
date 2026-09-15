// Frontend preview only. Replace this explicit backend failure with verified
// origin routing before attaching the production app hostname.
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (/^\/(api|keeper|push|upload)(\/|$)/.test(path)) {
      return Response.json(
        { error: "Backend services are not connected to this preview. Use app.creatorhive.ai." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return env.ASSETS.fetch(request);
  },
};
