#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
S3_CONFIG_PATH="$ROOT_DIR/s3-config.json"

if [[ ! -f "$S3_CONFIG_PATH" ]]; then
  echo 's3-config.json was not found.' >&2
  echo 'Run dev/setup.sh to deploy Garage to your kind cluster (it writes s3-config.json).' >&2
  exit 1
fi

# Signal to the e2e tests that PostgreSQL is available and they should run.
export POSTGRES_E2E_AVAILABLE=true

node --env-file=.env.test node_modules/.bin/vite build
# Run non-storage tests with full parallelism.
node_modules/.bin/playwright test e2e/auth/ e2e/trino/ e2e/smoke.spec.ts e2e/i18n.spec.ts e2e/storage/ e2e/database/ --workers=1 "$@"
