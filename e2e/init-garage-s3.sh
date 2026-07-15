#!/usr/bin/env bash

set -euo pipefail

: "${GARAGE_ADMIN_URL:=http://127.0.0.1:3902}"
: "${GARAGE_ADMIN_TOKEN:?GARAGE_ADMIN_TOKEN must be set}"
: "${S3_ENDPOINT:=http://127.0.0.1:3900}"
: "${S3_REGION:=garage}"
: "${S3_BUCKET:=test-bucket}"
: "${S3_CONFIG_PATH:=s3-config.json}"
: "${S3_ACCESS_KEY_ID:=E2E00000000000000001}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY must be set}"
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

json_read_field_from_file() {
  local file="$1"
  local field="$2"

  node -e '
    const fs = require("fs");
    try {
      const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const value = process.argv[2].split(".").reduce((current, key) => current?.[key], data);
      if (value !== undefined && value !== null) {
        process.stdout.write(String(value));
      }
    } catch { /* file missing or invalid JSON — emit nothing */ }
  ' "$file" "$field"
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

create_bucket() {
  local bucket_name="$1"

  admin_post '/v2/CreateBucket' "{\"globalAlias\":\"$bucket_name\"}"
}

# Creates a bucket with no global alias so it does not appear in S3 ListBuckets.
create_hidden_bucket() {
  admin_post '/v2/CreateBucket' '{}'
}

bucket_exists() {
  local bucket_id="$1"

  curl -fsS \
    -H "Authorization: Bearer $GARAGE_ADMIN_TOKEN" \
    "$GARAGE_ADMIN_URL/v2/GetBucketInfo?id=$bucket_id" >/dev/null 2>&1
}

allow_bucket_key() {
  local bucket_id="$1"
  local access_key_id="$2"

  admin_post '/v2/AllowBucketKey' "{\"bucketId\":\"$bucket_id\",\"accessKeyId\":\"$access_key_id\",\"permissions\":{\"owner\":$S3_PERMISSION_OWNER,\"read\":$S3_PERMISSION_READ,\"write\":$S3_PERMISSION_WRITE}}"
}

# Import pre-defined access key (idempotent — Garage ignores re-import of existing keys)
admin_post '/v2/ImportKey' "{\"accessKeyId\":\"$S3_ACCESS_KEY_ID\",\"secretAccessKey\":\"$S3_SECRET_ACCESS_KEY\",\"name\":\"$S3_ACCESS_KEY_NAME\",\"neverExpires\":true}" >/dev/null 2>&1 || true

bucket_id=$(get_bucket_id "$S3_BUCKET")
if [[ -z "$bucket_id" ]]; then
  bucket_response=$(create_bucket "$S3_BUCKET")
  bucket_id=$(printf '%s' "$bucket_response" | json_get 'id')
fi

allow_bucket_key "$bucket_id" "$S3_ACCESS_KEY_ID" >/dev/null

# Hidden bucket: no global alias so it is absent from S3 ListBuckets responses,
# but the access key retains read and write (not owner) access.
# Idempotent: reuse the bucket ID stored in an existing config file if the
# bucket is still present in Garage; otherwise create a new one.
hidden_bucket_id=$(json_read_field_from_file "$S3_CONFIG_PATH" 'hiddenBucketId')
if [[ -z "$hidden_bucket_id" ]] || ! bucket_exists "$hidden_bucket_id"; then
  hidden_bucket_response=$(create_hidden_bucket)
  hidden_bucket_id=$(printf '%s' "$hidden_bucket_response" | json_get 'id')
fi

admin_post '/v2/AllowBucketKey' \
  "{\"bucketId\":\"$hidden_bucket_id\",\"accessKeyId\":\"$S3_ACCESS_KEY_ID\",\"permissions\":{\"owner\":false,\"read\":true,\"write\":true}}" >/dev/null

cat > "$S3_CONFIG_PATH" <<EOF
{
  "awsEndpoint": "$S3_ENDPOINT",
  "awsRegion": "$S3_REGION",
  "awsAccessKeyId": "$S3_ACCESS_KEY_ID",
  "awsSecretAccessKey": "$S3_SECRET_ACCESS_KEY",
  "bucket": "$S3_BUCKET",
  "hiddenBucketId": "$hidden_bucket_id",
  "garageAdminUrl": "$GARAGE_ADMIN_URL",
  "garageAdminToken": "$GARAGE_ADMIN_TOKEN"
}
EOF
