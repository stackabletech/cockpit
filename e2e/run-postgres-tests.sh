#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# Database connection variables — can be overridden by the caller (e.g. CI).
export DATABASE_HOST="${DATABASE_HOST:-localhost}"
export DATABASE_PORT="${DATABASE_PORT:-31432}"
export DATABASE_NAME="${DATABASE_NAME:-cockpit}"
export DATABASE_USER="${DATABASE_USER:-cockpit}"
export DATABASE_PASSWORD="${DATABASE_PASSWORD:-cockpit-dev-password}"

# Signal to the e2e tests that PostgreSQL is available and they should run.
export POSTGRES_E2E_AVAILABLE=true

cd "$ROOT_DIR"
node --env-file=.env.test node_modules/.bin/vite build
node node_modules/.bin/playwright test e2e/database/ "$@"
