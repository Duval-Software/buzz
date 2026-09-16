import assert from "node:assert/strict";
import worker from "./development-worker.mjs";

const originalFetch = globalThis.fetch;
try {
  let forwarded;
  globalThis.fetch = async (request, options) => {
    forwarded = { request, options };
    return Response.json({ error: "Sign in required" }, { status: 401 });
  };
  const response = await worker.fetch(new Request("https://dev.creatorhive.ai/keeper/agents?limit=5", {
    method: "POST", headers: { Authorization: "Nostr signed-test-request", Cookie: "private-cookie", "Content-Type": "application/json" }, body: '{"name":"test"}',
  }), {});
  assert.equal(forwarded.request.url, "https://api-dev.creatorhive.ai/keeper/agents?limit=5");
  assert.equal(forwarded.request.headers.get("Authorization"), "Nostr signed-test-request");
  assert.equal(forwarded.request.headers.get("Cookie"), null);
  assert.equal(await forwarded.request.text(), '{"name":"test"}');
  assert.equal(forwarded.options.redirect, "manual");
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  await worker.fetch(new Request("https://dev.creatorhive.ai/relay-info"), {});
  assert.equal(forwarded.request.url, "https://api-dev.creatorhive.ai/info");
  globalThis.fetch = async () => { throw new Error("offline"); };
  assert.equal((await worker.fetch(new Request("https://dev.creatorhive.ai/upload"), {})).status, 502);
  const page = await worker.fetch(new Request("https://dev.creatorhive.ai/chat"), { ASSETS: { fetch: async () => new Response("app", { headers: { "Content-Type": "text/html" } }) } });
  assert.equal(await page.text(), "app");
  assert.equal(page.headers.get("X-Robots-Tag"), "noindex, nofollow");
  console.log("Development routing preserves signed requests, errors, and private response caching.");
} finally {
  globalThis.fetch = originalFetch;
}
