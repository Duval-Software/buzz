import assert from "node:assert/strict";
import worker from "./app-router.mjs";

const env = { FRONTEND_ORIGIN: "https://creatorhive-app.pages.dev" };
const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (...args) => {
  calls.push(args);
  return new Response("ok", { headers: { "Content-Type": "text/javascript" } });
};
try {
  for (const path of ["/", "/@scott", "/%40scott", "/profile/edit", "/chat?channel=123", "/live", "/pulse", "/invite/abc", "/repos/abc/blob/main/README.md"]) {
    calls.length = 0;
    const request = new Request(`https://app.creatorhive.ai${path}`, {
      headers: { Cookie: "private", Authorization: "private" },
    });
    const response = await worker.fetch(request, env);
    assert.equal(calls[0][0].href, `${env.FRONTEND_ORIGIN}/`);
    assert.equal(calls[0][1].headers, undefined);
    assert.equal(response.headers.get("Cache-Control"), "no-cache");
    assert.equal(response.headers.get("X-CreatorHive-Frontend"), "cloudflare-pages");
  }
  for (const path of ["/api/profiles/scott", "/api/profile-images/abc", "/api/identity/profile/save", "/api/identity/sign", "/keeper/agents", "/push/subscribe", "/upload", "/unknown-backend"]) {
    for (const method of ["GET", "POST", "DELETE", "OPTIONS"]) {
      calls.length = 0;
      const request = new Request(`https://app.creatorhive.ai${path}`, {
        method, headers: { Authorization: "Nostr signed-for-original-url" },
        ...(method === "POST" ? { body: "original-body" } : {}),
      });
      await worker.fetch(request, env);
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], request);
    }
  }
  calls.length = 0;
  const socket = new Request("https://app.creatorhive.ai/chat", { headers: { Upgrade: "websocket" } });
  await worker.fetch(socket, env);
  assert.equal(calls[0][0], socket);

  calls.length = 0;
  await worker.fetch(new Request("https://app.creatorhive.ai/assets/current.js", { method: "HEAD" }), env);
  assert.equal(calls[0][0].href, `${env.FRONTEND_ORIGIN}/assets/current.js`);
  assert.equal(calls[0][1].method, "HEAD");

  calls.length = 0;
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return new Response("old-chunk", { headers: { "Content-Type": "text/html" } });
  };
  const oldChunk = new Request("https://app.creatorhive.ai/assets/old.js");
  await worker.fetch(oldChunk, env);
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0], oldChunk);
  calls.length = 0;
  assert.equal((await worker.fetch(new Request("https://other.example/chat"), env)).status, 404);
  assert.equal(calls.length, 0);
  console.log("App router: frontend delivery, credential isolation, backend/body preservation, WebSockets and old chunks passed.");
} finally {
  globalThis.fetch = originalFetch;
}
