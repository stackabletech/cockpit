#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
S3_CONFIG_PATH="$ROOT_DIR/s3-config.json"

garage_pid=''
garage_dir=''
created_s3_config='0'

cleanup() {
  if [[ -n "$garage_pid" ]] && kill -0 "$garage_pid" 2>/dev/null; then
    kill "$garage_pid" 2>/dev/null || true
    wait "$garage_pid" 2>/dev/null || true
  fi

  if [[ "$created_s3_config" == '1' ]]; then
    rm -f "$S3_CONFIG_PATH"
  fi

  if [[ -n "$garage_dir" ]]; then
    rm -rf "$garage_dir"
  fi
}

trap cleanup EXIT

if [[ ! -f "$S3_CONFIG_PATH" ]]; then
  if ! command -v garage >/dev/null 2>&1; then
    echo 's3-config.json was not found and the garage binary is not available in PATH.' >&2
    echo 'Install garage locally or pre-create s3-config.json before running test:e2e:garage.' >&2
    exit 1
  fi

  garage_dir=$(mktemp -d)
  metadata_dir="$garage_dir/meta"
  data_dir="$garage_dir/data"
  config_path="$garage_dir/garage.toml"
  log_path="$garage_dir/garage.log"

  mkdir -p "$metadata_dir" "$data_dir"

  app_key_id="GK$(openssl rand -hex 16)"
  app_secret=$(openssl rand -hex 32)
  rpc_secret=$(openssl rand -hex 32)

  cat > "$config_path" <<EOF
metadata_dir = "$metadata_dir"
data_dir = "$data_dir"
db_engine = "sqlite"

replication_factor = 1

rpc_bind_addr = "127.0.0.1:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "$rpc_secret"

[s3_api]
s3_region = "garage"
api_bind_addr = "127.0.0.1:3900"
root_domain = ".s3.garage.localhost"
EOF

  GARAGE_CONFIG_FILE="$config_path" \
    GARAGE_DEFAULT_ACCESS_KEY="$app_key_id" \
    GARAGE_DEFAULT_SECRET_KEY="$app_secret" \
    GARAGE_DEFAULT_BUCKET='test-bucket' \
    garage server --single-node --default-bucket >"$log_path" 2>&1 &
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

  cat > "$S3_CONFIG_PATH" <<EOF
{
  "awsEndpoint": "http://127.0.0.1:3900",
  "awsRegion": "garage",
  "awsAccessKeyId": "$app_key_id",
  "awsSecretAccessKey": "$app_secret",
  "bucket": "test-bucket"
}
EOF
  created_s3_config='1'
fi

node --env-file=.env.test node_modules/.bin/vite build
node_modules/.bin/playwright test "$@"