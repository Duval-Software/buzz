import assert from "node:assert/strict";
import { loadConfigFromFile } from "vite";

process.env.VITE_RELAY_URL = "ws://localhost:3300";
process.env.VITE_MANAGED_ACCOUNTS = "true";
process.env.VITE_KEEPER_URL = "";
const config = async () =>
  (await loadConfigFromFile({ command: "serve", mode: "development" })).config;
let proxy = (await config()).server.proxy;
for (const path of ["/api/identity", "/api/accounts", "/upload", "/keeper"]) {
  assert.equal(proxy[path].target, "http://localhost:3300", path);
}
process.env.VITE_KEEPER_URL = "http://localhost:3301";
proxy = (await config()).server.proxy;
assert.equal(proxy["/keeper"].target, "http://localhost:3301");
assert.equal(proxy["/upload"].target, "http://localhost:3300");
console.log(
  "Managed preview requests stay on the configured preview services.",
);
