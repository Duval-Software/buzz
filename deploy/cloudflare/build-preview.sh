#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
. ./bin/activate-hermit
pnpm --dir web typecheck
VITE_MANAGED_ACCOUNTS=false pnpm --dir web exec vite build --outDir dist-cloudflare
cp deploy/cloudflare/preview-worker.mjs web/dist-cloudflare/_worker.js
printf '/*\n  X-Robots-Tag: noindex\n' > web/dist-cloudflare/_headers
node deploy/cloudflare/preview-worker.test.mjs
