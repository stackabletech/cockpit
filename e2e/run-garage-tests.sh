#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

cd "$ROOT_DIR"
node --env-file=.env.test node_modules/.bin/vite build
node_modules/.bin/playwright test e2e/auth/ e2e/trino/ e2e/smoke.spec.ts e2e/i18n.spec.ts e2e/storage/ e2e/database/ --workers=1 "$@"
