import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const request = (url, options = {}) => fetch(url, {
  ...options, redirect: "manual", signal: AbortSignal.timeout(15_000),
});

// Exercise the return leg without signing in, sending email, or creating a user.
export async function checkAuthRedirect(target, config, send = request) {
  const start = new URL("/auth/v1/authorize", config.VITE_SUPABASE_URL);
  start.searchParams.set("provider", "google");
  start.searchParams.set("redirect_to", target);
  start.searchParams.set("code_challenge", createHash("sha256").update(randomBytes(32).toString("base64url")).digest("base64url"));
  start.searchParams.set("code_challenge_method", "s256");
  const response = await send(start, { headers: { apikey: config.VITE_SUPABASE_PUBLISHABLE_KEY } });
  assert.equal(response.status, 302, "OAuth must open the provider");
  const provider = new URL(response.headers.get("location"));
  assert.equal(provider.hostname, "accounts.google.com");
  assert.ok(provider.searchParams.get("state"), "Missing OAuth state");
  const callback = new URL("/auth/v1/callback", config.VITE_SUPABASE_URL);
  callback.searchParams.set("state", provider.searchParams.get("state"));
  callback.searchParams.set("error", "access_denied");
  callback.searchParams.set("error_description", "Development callback check");
  const cookies = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const result = await send(callback, { headers: cookies ? { cookie: cookies } : {} });
  assert.equal(result.status, 302, "OAuth callback must redirect");
  const actual = new URL(result.headers.get("location"));
  const expected = new URL(target);
  // Error fields are added by Auth; preserve the requested route and recovery mode.
  const matches = actual.origin === expected.origin && actual.pathname === expected.pathname &&
    [...expected.searchParams].every(([key, value]) => actual.searchParams.get(key) === value);
  assert.ok(matches, `${target} returned to ${actual.origin}${actual.pathname}. Add the exact requested URL in Supabase Authentication > URL Configuration.`);
}

async function main() {
  const config = parseEnv(readFileSync(`${root}web/.env.development`, "utf8"));
  const api = config.VITE_RELAY_URL.replace(/^ws/, "http");
  const branch = execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim();
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  console.log(`Local source: ${branch} ${commit}; backend: ${api}`);
  const origins = ["https://dev.creatorhive.ai", "http://localhost:5173"];
  if (process.argv.includes("--review")) origins.push("https://review.creatorhive-app-preview.pages.dev");
  const checks = [
    ...[["/health", 200], ["/keeper/health", 200], ["/keeper/agents", 401]].map(([path, status]) => [path, async () => assert.equal((await request(`${api}${path}`)).status, status)]),
    ["Managed account protection", async () => assert.equal((await request(`${api}/api/identity/bootstrap`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401)],
    ...origins.flatMap(origin => ["/chat", "/chat?account=recovery"].map(path => [origin + path, () => checkAuthRedirect(origin + path, config)])),
    ["Allowed browser origins", async () => {
      for (const origin of origins) {
        const response = await request(`${api}/health`, { headers: { Origin: origin } });
        assert.equal(response.headers.get("access-control-allow-origin"), origin, `Backend does not allow ${origin}`);
      }
      const response = await request(`${api}/health`, { headers: { Origin: "https://unrelated.example" } });
      assert.equal(response.headers.get("access-control-allow-origin"), null, "Backend unexpectedly allows an unrelated origin");
    }],
    ["Deployed frontend version", async () => {
      const r = await request("https://dev.creatorhive.ai/build-info.json");
      assert.ok(r.ok && r.headers.get("content-type")?.includes("application/json"), "Frontend build information is missing");
      const info = await r.json();
      console.log(`  Shared dev: ${info.commit} (${info.builtAt})`);
      const expected = process.argv.find(value => value.startsWith("--expect-commit="))?.split("=")[1];
      if (expected) assert.equal(info.commit, expected, "The shared frontend has not deployed the expected commit");
    }],
    ["Deployed backend release", async () => {
      const response = await request(`${api}/assets/release.json?check=${Date.now()}`);
      assert.ok(response.ok && response.headers.get("content-type")?.includes("application/json"), "Backend release information is missing");
      const info = await response.json();
      assert.equal(info.environment, "development");
      assert.ok(info.id && info.keeperCommit && info.configuration && info.migrations?.length, "Incomplete backend release manifest");
      console.log(`  Backend: ${info.id}; keeper: ${info.keeperCommit}; schema: ${info.migrations.at(-1).version}; configuration: ${info.configuration.slice(0, 12)}`);
    }],
  ];
  let failed = 0;
  // Sequential output makes each failure readable; no credentials or callback tokens are logged.
  for (const [label, check] of checks) {
    try { await check(); console.log(`PASS ${label}`); }
    catch (error) { failed++; console.error(`FAIL ${label}: ${error.message}`); }
  }
  console.log(`${checks.length - failed}/${checks.length} checks passed. Local app: http://localhost:5173/chat`);
  process.exitCode = failed ? 1 : 0;
}
if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) await main();
