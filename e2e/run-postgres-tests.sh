#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

cd "$ROOT_DIR"
node --env-file=.env.test node_modules/.bin/vite build
node node_modules/.bin/playwright test e2e/database/ "$@"
