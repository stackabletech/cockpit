#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
S3_CONFIG_PATH="$ROOT_DIR/s3-config.json"

if [[ ! -f "$S3_CONFIG_PATH" ]]; then
  echo 's3-config.json was not found.' >&2
  echo 'Run dev/setup.sh to deploy Garage to your kind cluster (it writes s3-config.json).' >&2
  exit 1
fi

node --env-file=.env.test node_modules/.bin/vite build
node_modules/.bin/playwright test "$@"
