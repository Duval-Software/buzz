#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
. ./bin/activate-hermit
pnpm --dir web build:preview
node --test deploy/cloudflare/development-worker.test.mjs
printf 'Shared development build: web/dist\n'
