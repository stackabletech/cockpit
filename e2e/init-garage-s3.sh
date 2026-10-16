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
# ──────────────────────────────────────────────
# Bucket enrichment: tags, lifecycle rules, sample data
# ──────────────────────────────────────────────
echo "Enriching bucket with tags, lifecycle rules, and sample objects..."

# Export S3 env vars so the Node.js process can read them
export S3_ENDPOINT S3_REGION S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_BUCKET

node -e '
const {
  S3Client,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand
} = require("@aws-sdk/client-s3");

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || "garage",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

const bucket = process.env.S3_BUCKET;

async function enrich() {
  // Lifecycle rules (Garage supports a subset of the S3 lifecycle API)
  // Note: Garage does not implement PutBucketTagging (returns 501 Not Implemented).
  try {
    await client.send(new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: "expire-old-logs",
            Status: "Enabled",
            Filter: { Prefix: "logs/" },
            Expiration: { Days: 90 },
          },
          {
            ID: "clean-aborted-uploads",
            Status: "Enabled",
            Filter: {},
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
          },
          {
            ID: "expire-deleted-markers",
            Status: "Enabled",
            Filter: {},
            NoncurrentVersionExpiration: { NoncurrentDays: 30 },
          },
        ],
      },
    }));
    console.log("  ✓ Lifecycle rules set");
  } catch (err) {
    console.log("  ✗ Lifecycle rules failed:", err.message);
  }

  // Sample objects
  const samples = [
    { key: "logs/access.log", body: "192.168.1.1 GET /api/v1/query 200 1234\n10.0.0.1 POST /api/v1/run 201 56\n" },
    { key: "logs/error.log", body: "2026-07-09 ERROR: Connection timeout to trino-worker-3\n2026-07-09 WARN: Retry attempt 2/5\n" },
    { key: "archive/2024/transactions.csv", body: "id,amount,currency,date\nTX-001,150.00,USD,2024-01-15\nTX-002,275.50,EUR,2024-03-22\nTX-003,89.99,GBP,2024-06-01\n" },
    { key: "archive/2024/audit.log", body: "[2024-01-01] System initialized\n[2024-06-30] Scheduled maintenance completed\n" },
    { key: "README.md", body: "# Test Bucket\n\nThis bucket is used for E2E testing of the Stackable Cockpit.\n" },
    { key: "config/cluster.yaml", body: "cluster:\n  name: e2e-test\n  replicas: 3\n  storage: 100Gi\n" },
  ];

  for (const { key, body } of samples) {
    try {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
      }));
      console.log("  ✓ Uploaded:", key);
    } catch (err) {
      console.log("  ✗ Upload failed:", key, err.message);
    }
  }
}

enrich().catch((err) => {
  console.error("Fatal error during bucket enrichment:", err);
  process.exit(1);
});
'

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
