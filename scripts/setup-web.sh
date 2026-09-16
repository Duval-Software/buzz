#!/usr/bin/env bash
# Run directly after cloning; no globally installed pnpm or Rust toolchain needed.
set -euo pipefail
cd "$(dirname "$0")/.."
. ./bin/activate-hermit
pnpm --filter buzz-web... install --frozen-lockfile
just hooks
pnpm --dir web exec playwright install chromium
printf '\nSetup complete. Run: pnpm dev:web\nCheck changes: pnpm check:web\nCheck live services: pnpm doctor\n'
