import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createServer } from "vite";

// This command always uses the shared preview, including on machines with an
// old SSH-based .env.development.local or production shell settings.
const root = fileURLToPath(new URL("../", import.meta.url));
Object.assign(
  process.env,
  parseEnv(readFileSync(`${root}.env.development`, "utf8")),
);
const api = process.env.VITE_RELAY_URL.replace(/^ws/, "http");

try {
  const [health, account] = await Promise.all([
    fetch(`${api}/health`, { signal: AbortSignal.timeout(10_000) }),
    fetch(`${api}/api/identity/bootstrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(10_000),
    }),
  ]);
  if (!health.ok || account.status !== 401) {
    throw new Error(
      `health HTTP ${health.status}, accounts HTTP ${account.status}`,
    );
  }
  console.log(`CreatorHive shared development backend is ready: ${api}`);
  if (!process.argv.includes("--check")) {
    const server = await createServer({
      root,
      mode: "development",
      server: { host: "localhost", port: 5173, strictPort: true },
    });
    await server.listen();
    server.printUrls();
  }
} catch (error) {
  console.error(`Could not start CreatorHive: ${error.message}`);
  console.error(
    `Check your internet connection and ${api}/health, then retry pnpm dev:web. If port 5173 is busy, stop the previous Vite process first.`,
  );
  process.exitCode = 1;
}
