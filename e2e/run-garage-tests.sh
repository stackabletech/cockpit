#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
S3_CONFIG_PATH="$ROOT_DIR/s3-config.json"
GARAGE_CONFIG_PATH="$ROOT_DIR/e2e/garage.toml"
GARAGE_INIT_SCRIPT="$ROOT_DIR/e2e/init-garage-s3.sh"
GARAGE_STATE_DIR='/tmp/stackable-ui-garage'
GARAGE_ADMIN_TOKEN='stackable-ui-e2e-admin-token'

garage_pid=''
created_s3_config='0'

cleanup() {
  if [[ -n "$garage_pid" ]] && kill -0 "$garage_pid" 2>/dev/null; then
    kill "$garage_pid" 2>/dev/null || true
    wait "$garage_pid" 2>/dev/null || true
  fi

  if [[ "$created_s3_config" == '1' ]]; then
    rm -f "$S3_CONFIG_PATH"
  fi

  rm -rf "$GARAGE_STATE_DIR"
}

trap cleanup EXIT

if [[ ! -f "$S3_CONFIG_PATH" ]]; then
  if ! command -v garage >/dev/null 2>&1; then
    echo 's3-config.json was not found and the garage binary is not available in PATH.' >&2
    echo 'Install garage locally or pre-create s3-config.json before running test:e2e:garage.' >&2
    exit 1
  fi

  log_path="$ROOT_DIR/.garage.log"

  rm -rf "$GARAGE_STATE_DIR"
  mkdir -p "$GARAGE_STATE_DIR/meta" "$GARAGE_STATE_DIR/data"

  GARAGE_CONFIG_FILE="$GARAGE_CONFIG_PATH" \
    garage server --single-node >"$log_path" 2>&1 &
  garage_pid=$!

  garage_ready='0'
  for _ in $(seq 1 30); do
    if curl -s http://127.0.0.1:3900 >/dev/null 2>&1; then
      garage_ready='1'
      break
    fi

    if ! kill -0 "$garage_pid" 2>/dev/null; then
      break
    fi

    sleep 1
  done

  if [[ "$garage_ready" != '1' ]]; then
    echo 'Garage did not become ready within 30 seconds.' >&2
    if [[ -f "$log_path" ]]; then
      cat "$log_path" >&2
    fi
    exit 1
  fi

  GARAGE_ADMIN_TOKEN="$GARAGE_ADMIN_TOKEN" \
    S3_ENDPOINT='http://127.0.0.1:3900' \
    S3_CONFIG_PATH="$S3_CONFIG_PATH" \
    "$GARAGE_INIT_SCRIPT"

  created_s3_config='1'
fi

node --env-file=.env.test node_modules/.bin/vite build
node_modules/.bin/playwright test "$@"
