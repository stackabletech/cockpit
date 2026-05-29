#!/usr/bin/env bash

set -euo pipefail

: "${GARAGE_ADMIN_URL:=http://127.0.0.1:3902}"
: "${GARAGE_ADMIN_TOKEN:?GARAGE_ADMIN_TOKEN must be set}"
: "${S3_ENDPOINT:=http://127.0.0.1:3900}"
: "${S3_REGION:=garage}"
: "${S3_BUCKET:=test-bucket}"
: "${S3_CONFIG_PATH:=s3-config.json}"
: "${S3_ACCESS_KEY_NAME:=e2e-test-app}"
: "${S3_PERMISSION_OWNER:=true}"
: "${S3_PERMISSION_READ:=true}"
: "${S3_PERMISSION_WRITE:=true}"

json_get() {
  local field="$1"

  node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const value = process.argv[1].split(".").reduce((current, key) => current?.[key], data);
    if (value === undefined || value === null) {
      process.exit(1);
    }
    process.stdout.write(String(value));
  ' "$field"
}

json_find_bucket_id_by_alias() {
  local bucket_name="$1"

  node -e '
    const fs = require("fs");
    const bucketName = process.argv[1];
    const items = JSON.parse(fs.readFileSync(0, "utf8"));
    const bucket = items.find((item) => Array.isArray(item.globalAliases) && item.globalAliases.includes(bucketName));
    if (bucket?.id) {
      process.stdout.write(bucket.id);
    }
  ' "$bucket_name"
}

json_find_key_id_by_name() {
  local key_name="$1"

  node -e '
    const fs = require("fs");
    const keyName = process.argv[1];
    const items = JSON.parse(fs.readFileSync(0, "utf8"));
    const key = items.find((item) => item?.name === keyName && item?.expired === false);
    if (key?.id) {
      process.stdout.write(key.id);
    }
  ' "$key_name"
}

admin_post() {
  local path="$1"
  local payload="$2"

  curl -fsS \
    -X POST \
    -H "Authorization: Bearer $GARAGE_ADMIN_TOKEN" \
    -H 'Content-Type: application/json' \
    --data "$payload" \
    "$GARAGE_ADMIN_URL$path"
}

admin_get() {
  local path="$1"

  curl -fsS \
    -H "Authorization: Bearer $GARAGE_ADMIN_TOKEN" \
    "$GARAGE_ADMIN_URL$path"
}

get_bucket_id() {
  local bucket_name="$1"

  admin_get '/v2/ListBuckets' | json_find_bucket_id_by_alias "$bucket_name"
}

get_key_id() {
  local key_name="$1"

  admin_get '/v2/ListKeys' | json_find_key_id_by_name "$key_name"
}

get_key_info() {
  local access_key_id="$1"

  admin_get "/v2/GetKeyInfo?id=$access_key_id&showSecretKey=true"
}

create_bucket() {
  local bucket_name="$1"

  admin_post '/v2/CreateBucket' "{\"globalAlias\":\"$bucket_name\"}"
}

create_access_key() {
  local key_name="$1"

  admin_post '/v2/CreateKey' "{\"name\":\"$key_name\",\"neverExpires\":true}"
}

allow_bucket_key() {
  local bucket_id="$1"
  local access_key_id="$2"

  admin_post '/v2/AllowBucketKey' "{\"bucketId\":\"$bucket_id\",\"accessKeyId\":\"$access_key_id\",\"permissions\":{\"owner\":$S3_PERMISSION_OWNER,\"read\":$S3_PERMISSION_READ,\"write\":$S3_PERMISSION_WRITE}}"
}

bucket_id=$(get_bucket_id "$S3_BUCKET")
if [[ -z "$bucket_id" ]]; then
  bucket_response=$(create_bucket "$S3_BUCKET")
  bucket_id=$(printf '%s' "$bucket_response" | json_get 'id')
fi

access_key_id=$(get_key_id "$S3_ACCESS_KEY_NAME")
if [[ -z "$access_key_id" ]]; then
  key_response=$(create_access_key "$S3_ACCESS_KEY_NAME")
  access_key_id=$(printf '%s' "$key_response" | json_get 'accessKeyId')
  secret_access_key=$(printf '%s' "$key_response" | json_get 'secretAccessKey')
else
  key_response=$(get_key_info "$access_key_id")
  secret_access_key=$(printf '%s' "$key_response" | json_get 'secretAccessKey')
fi

allow_bucket_key "$bucket_id" "$access_key_id" >/dev/null

cat > "$S3_CONFIG_PATH" <<EOF
{
  "awsEndpoint": "$S3_ENDPOINT",
  "awsRegion": "$S3_REGION",
  "awsAccessKeyId": "$access_key_id",
  "awsSecretAccessKey": "$secret_access_key",
  "bucket": "$S3_BUCKET",
  "garageAdminUrl": "$GARAGE_ADMIN_URL",
  "garageAdminToken": "$GARAGE_ADMIN_TOKEN"
}
EOF
