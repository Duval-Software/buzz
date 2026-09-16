import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { checkAuthRedirect } from "./doctor-web.mjs";

test("Auth check rejects a successful provider launch that returns to the wrong site", async () => {
  const config = { VITE_SUPABASE_URL: "https://example.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "public-test" };
  const target = "https://dev.creatorhive.ai/chat?account=recovery";
  const send = destination => async url => {
    const parsed = new URL(url);
    return Response.redirect(parsed.pathname.endsWith("authorize") ? "https://accounts.google.com/o/oauth2/auth?state=test" : destination);
  };
  await checkAuthRedirect(target, config, send(`${target}&error=access_denied`));
  await assert.rejects(checkAuthRedirect(target, config, send("https://app.creatorhive.ai/")), /returned to/);
  await assert.rejects(checkAuthRedirect(target, config, send("https://dev.creatorhive.ai/chat")), /returned to/);
});

test("CreatorHive pushes use its integration branch and still reject conflicting feature branches", () => {
  const dir = mkdtempSync(join(tmpdir(), "creatorhive-branch-check-"));
  const origin = join(dir, "Duval-Software", "buzz.git");
  const work = join(dir, "work");
  const guard = fileURLToPath(new URL("check-branch-skew.sh", import.meta.url));
  const git = (...args) => execFileSync("git", args, { cwd: work, stdio: "pipe" });
  try {
    mkdirSync(join(dir, "Duval-Software"));
    mkdirSync(work);
    execFileSync("git", ["init", "--bare", origin], { stdio: "pipe" });
    git("init", "-b", "creatorhive-web");
    git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid");
    git("remote", "add", "origin", origin);
    writeFileSync(join(work, "app.txt"), "base\n"); git("add", "."); git("commit", "-sm", "base");
    git("push", "-u", "origin", "creatorhive-web");
    assert.equal(spawnSync("bash", [guard], { cwd: work }).status, 0);
    git("switch", "-c", "feature");
    writeFileSync(join(work, "app.txt"), "feature\n"); git("commit", "-asm", "feature");
    git("switch", "creatorhive-web");
    writeFileSync(join(work, "app.txt"), "integration\n"); git("commit", "-asm", "integration"); git("push");
    git("switch", "feature");
    const result = spawnSync("bash", [guard], { cwd: work, encoding: "utf8" });
    assert.equal(result.status, 1); assert.match(result.stderr, /origin\/creatorhive-web/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
