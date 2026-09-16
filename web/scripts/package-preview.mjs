import { copyFileSync } from "node:fs";

// Keep preview backend routing out of ordinary production builds.
copyFileSync("../deploy/cloudflare/development-worker.mjs", "dist/_worker.js");
