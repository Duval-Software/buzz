import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const [relay, destination] = process.argv.slice(2);
assert.ok(relay && destination, "Usage: node deploy/development/package-release.mjs RELAY OUTPUT_DIR");
const keeper = JSON.parse(readFileSync("deploy/development/keeper.json", "utf8"));
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.match(keeper.commit, /^[a-f0-9]{40}$/);
assert.match(keeper.sha256, /^[a-f0-9]{64}$/);
const hash = (path, algorithm = "sha256") => createHash(algorithm).update(readFileSync(path)).digest("hex");
mkdirSync(destination, { recursive: true });
copyFileSync(relay, `${destination}/buzz-relay`);
const manifest = {
  id: commit, relayCommit: commit, keeperCommit: keeper.commit, builtAt: new Date().toISOString(),
  environment: "development",
  configuration: hash("deploy/development/compose.yml"),
  binaries: { "buzz-relay": hash(relay), agentkeeper: keeper.sha256 },
  migrations: readdirSync("migrations").filter(name => /^\d+_.+\.sql$/.test(name)).sort().map(name => ({ version: Number(name.split("_")[0]), checksum: hash(`migrations/${name}`, "sha384") })),
};
writeFileSync(`${destination}/release.json`, JSON.stringify(manifest, null, 2) + "\n");
execFileSync("tar", ["-czf", `${destination}.tar.gz`, "-C", destination, "buzz-relay", "release.json"]);
console.log(`${destination}.tar.gz: relay ${commit}, keeper ${keeper.commit}`);
