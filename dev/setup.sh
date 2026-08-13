#!/usr/bin/env bash
# Sets up the full local dev environment on a kind cluster.
# Assumes: kind cluster is running, kubectl context points to it.
set -euo pipefail

SKIP_TRINO=false
SKIP_GARAGE=false
for arg in "$@"; do
  case "$arg" in
    --skip-trino) SKIP_TRINO=true ;;
    --skip-garage) SKIP_GARAGE=true ;;
    *) echo "Unknown argument: $arg"; echo "Usage: $0 [--skip-trino] [--skip-garage]"; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env.development"

echo "=== Stackable Cockpit dev environment setup ==="
if [[ "$SKIP_TRINO" == true ]]; then
  echo "(Trino deployment skipped via --skip-trino)"
fi
if [[ "$SKIP_GARAGE" == true ]]; then
  echo "(Garage deployment skipped via --skip-garage)"
fi
echo ""

# ------------------------------------------------------------------
# 1. Install npm dependencies if needed
# ------------------------------------------------------------------
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  echo "Installing npm dependencies..."
  (cd "$PROJECT_DIR" && npm install)
else
  echo "npm dependencies already installed, skipping."
fi

# ------------------------------------------------------------------
# 2. Install Stackable operators
# ------------------------------------------------------------------
echo ""
if [[ "$SKIP_TRINO" == true ]]; then
  echo "Installing Stackable operators (commons, listener, secret)..."
  stackablectl operator install commons listener secret
else
  echo "Installing Stackable operators (commons, listener, secret, trino)..."
  stackablectl operator install commons listener secret trino
fi

# ------------------------------------------------------------------
# 3. Deploy Keycloak
# ------------------------------------------------------------------
echo ""
echo "Deploying Keycloak..."
kubectl apply -f "$SCRIPT_DIR/keycloak.yaml"

# ------------------------------------------------------------------
# 4. Wait for Keycloak and configure realm/client/users
# ------------------------------------------------------------------
echo ""
echo "Waiting for Keycloak deployment to be available..."
kubectl wait --for=condition=available deployment/keycloak --timeout=120s

POD=$(kubectl get pod -l app=keycloak -o jsonpath='{.items[0].metadata.name}')
NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
if [ -z "$NODE_IP" ]; then
  echo "ERROR: Could not detect kind node IP."
  exit 1
fi
echo "Node IP: $NODE_IP"

# ------------------------------------------------------------------
# 5. Deploy Trino (after node IP is known, trino.yaml is a template)
# ------------------------------------------------------------------
if [[ "$SKIP_TRINO" == false ]]; then
  echo ""
  echo "Deploying Trino..."
  sed "s/\${NODE_IP}/$NODE_IP/g" "$SCRIPT_DIR/trino.yaml" | kubectl apply -f -
fi

# ------------------------------------------------------------------
# 5b. Deploy Garage S3 (via Helm)
# ------------------------------------------------------------------
if [[ "$SKIP_GARAGE" == false ]]; then
  echo ""
  echo "Deploying Garage S3..."
  helm upgrade --install garage "$SCRIPT_DIR/garage" \
    --namespace default \
    --wait \
    --timeout 60s
fi

# On some local Kubernetes distributions (e.g. Rancher Desktop k3s), the node's
# InternalIP is not reachable from the host network, but NodePorts are exposed
# on localhost. Probe both and use the first reachable URL.
KEYCLOAK_BASE_URL=""
deadline=$(( $(date +%s) + 120 ))
while [ -z "$KEYCLOAK_BASE_URL" ] && [ "$(date +%s)" -lt "$deadline" ]; do
  for base in "http://${NODE_IP}:30080" "http://127.0.0.1:30080" "http://localhost:30080"; do
    if curl -sf --max-time 2 "${base}/realms/master" >/dev/null 2>&1; then
      KEYCLOAK_BASE_URL="$base"
      break
    fi
  done
  [ -z "$KEYCLOAK_BASE_URL" ] && sleep 2
done

if [ -z "$KEYCLOAK_BASE_URL" ]; then
  echo "ERROR: Could not reach Keycloak via NodePort 30080 within 120s."
  echo "Tried: http://${NODE_IP}:30080, http://127.0.0.1:30080, http://localhost:30080"
  exit 1
fi
echo "Keycloak URL: ${KEYCLOAK_BASE_URL}"

echo "Waiting for Keycloak to accept connections"
until curl -sf "${KEYCLOAK_BASE_URL}/realms/master" >/dev/null 2>&1; do
  sleep 2
done

kcadm() {
  kubectl exec "$POD" -- /opt/keycloak/bin/kcadm.sh "$@"
}

# The shared dex broker (airflow-kc stack, http://localhost:5556) uses this
# client to reach the stackable realm as its "customer" OIDC provider. Create it
# idempotently — the realm may already exist from a previous run.
create_dex_client() {
  if kcadm get clients -r stackable --fields clientId 2>/dev/null | grep -q '"dex"'; then
    echo "Client 'dex' already exists, skipping."
    return
  fi
  echo "Creating client 'dex' (for the shared dex SSO broker)..."
  kcadm create clients \
    -r stackable \
    -s clientId=dex \
    -s enabled=true \
    -s protocol=openid-connect \
    -s publicClient=false \
    -s standardFlowEnabled=true \
    -s directAccessGrantsEnabled=false \
    -s secret=dex-secret \
    -s 'redirectUris=["http://localhost:5556/callback"]' \
    -s 'webOrigins=["*"]'
}

# Check if realm already exists
if kcadm get realms/stackable --fields realm 2>/dev/null | grep -q '"stackable"'; then
  echo "Realm 'stackable' already exists, skipping Keycloak configuration."
  create_dex_client
  # Still need to fetch the client secret
  CLIENT_UUID=$(kcadm get clients -r stackable --fields id,clientId \
    | grep -B1 '"stackable-cockpit"' | grep '"id"' | sed 's/.*: *"\(.*\)".*/\1/')
  SECRET=$(kcadm get clients/"$CLIENT_UUID"/client-secret -r stackable --fields value \
    | grep '"value"' | sed 's/.*: *"\(.*\)".*/\1/')
else
  echo "Logging into Keycloak admin CLI..."
  kcadm config credentials \
    --server http://localhost:8080 \
    --realm master \
    --user admin \
    --password admin

  echo "Creating realm 'stackable'..."
  kcadm create realms \
    -s realm=stackable \
    -s enabled=true

  echo "Creating client 'stackable-cockpit'..."
  CLIENT_UUID=$(kcadm create clients \
    -r stackable \
    -s clientId=stackable-cockpit \
    -s enabled=true \
    -s protocol=openid-connect \
    -s publicClient=false \
    -s standardFlowEnabled=true \
    -s directAccessGrantsEnabled=false \
    -s 'redirectUris=["*"]' \
    -s 'webOrigins=["*"]' \
    -i)

  echo "Creating client 'trino'..."
  kcadm create clients \
    -r stackable \
    -s clientId=trino \
    -s enabled=true \
    -s protocol=openid-connect \
    -s publicClient=false \
    -s standardFlowEnabled=true \
    -s directAccessGrantsEnabled=false \
    -s secret=trino-oidc-dev \
    -s 'redirectUris=["*"]' \
    -s 'webOrigins=["*"]'

  create_dex_client

  create_user() {
    local username=$1 password=$2 first=$3 last=$4
    echo "Creating user '$username'..."
    kcadm create users \
      -r stackable \
      -s username="$username" \
      -s email="$username@example.com" \
      -s emailVerified=true \
      -s firstName="$first" \
      -s lastName="$last" \
      -s enabled=true
    kcadm set-password \
      -r stackable \
      --username "$username" \
      --new-password "$password"
  }

  create_user alice alicealice Alice Example
  create_user bob   bobbob    Bob   Example

  echo "Fetching client secret..."
  SECRET=$(kcadm get clients/"$CLIENT_UUID"/client-secret -r stackable --fields value \
    | grep '"value"' | sed 's/.*: *"\(.*\)".*/\1/')
fi

# ------------------------------------------------------------------
# 7. Initialise Garage S3 (create bucket + access key, write s3-config.json)
# ------------------------------------------------------------------
if [[ "$SKIP_GARAGE" == false ]]; then
  echo ""
  echo "Initialising Garage S3..."

  GARAGE_ADMIN_PORT=30902
  GARAGE_S3_PORT=30900
  GARAGE_BASE_URL=""
  deadline=$(( $(date +%s) + 60 ))
  while [ -z "$GARAGE_BASE_URL" ] && [ "$(date +%s)" -lt "$deadline" ]; do
    for base in "http://${NODE_IP}:${GARAGE_ADMIN_PORT}" "http://127.0.0.1:${GARAGE_ADMIN_PORT}" "http://localhost:${GARAGE_ADMIN_PORT}"; do
      if curl -sf --max-time 2 -H "Authorization: Bearer stackable-cockpit-e2e-admin-token" "${base}/v2/ListBuckets" >/dev/null 2>&1; then
        GARAGE_BASE_URL="$base"
        break
      fi
    done
    [ -z "$GARAGE_BASE_URL" ] && sleep 2
  done

  if [ -z "$GARAGE_BASE_URL" ]; then
    echo "ERROR: Could not reach Garage admin API via NodePort ${GARAGE_ADMIN_PORT} within 60s."
    echo "Tried: http://${NODE_IP}:${GARAGE_ADMIN_PORT}, http://127.0.0.1:${GARAGE_ADMIN_PORT}, http://localhost:${GARAGE_ADMIN_PORT}"
    exit 1
  fi

  # Derive the matching S3 base URL from the same host
  GARAGE_HOST=$(echo "$GARAGE_BASE_URL" | sed 's|http://||; s|:[0-9]*$||')
  GARAGE_S3_URL="http://${GARAGE_HOST}:${GARAGE_S3_PORT}"

  S3_SECRET_ACCESS_KEY=$(openssl rand -hex 32) \
    GARAGE_ADMIN_TOKEN=stackable-cockpit-e2e-admin-token \
    S3_ENDPOINT="$GARAGE_S3_URL" \
    GARAGE_ADMIN_URL="$GARAGE_BASE_URL" \
    S3_CONFIG_PATH="$PROJECT_DIR/s3-config.json" \
    "$SCRIPT_DIR/../e2e/init-garage-s3.sh"

  echo "Wrote s3-config.json (S3 endpoint: ${GARAGE_S3_URL})"
fi

# ------------------------------------------------------------------
# 8. Write .env.development
# ------------------------------------------------------------------
echo ""
SESSION_SECRET=$(openssl rand -hex 32)

# When the shared dex broker (airflow-kc stack, http://localhost:5556) is
# reachable, use it as the cockpit's OIDC provider so the cockpit and Airflow
# share one identity broker (SSO). Otherwise fall back to the kind-cluster
# Keycloak deployed above.
DEX_DISCOVERY_URL=""
if curl -sf --max-time 2 "http://localhost:5556/.well-known/openid-configuration" >/dev/null 2>&1; then
  DEX_DISCOVERY_URL="http://localhost:5556/.well-known/openid-configuration"
fi

if [ -n "$DEX_DISCOVERY_URL" ]; then
  OIDC_DISCOVERY_URL="$DEX_DISCOVERY_URL"
  OIDC_CLIENT_SECRET="lY7rCsg4Ae0Gj1L119CRt1sGw2Z2yEBT"
  echo "Using shared dex broker (http://localhost:5556) as OIDC provider."
  echo "  (airflow-kc docker-compose must be running; users live in the 'stackable' realm: alice/bob)"
else
  OIDC_DISCOVERY_URL="${KEYCLOAK_BASE_URL}/realms/stackable/.well-known/openid-configuration"
  OIDC_CLIENT_SECRET="${SECRET}"
  echo "Shared dex broker not reachable at http://localhost:5556; falling back to kind-cluster Keycloak."
fi

if [ -f "$ENV_FILE" ]; then
  echo "Backing up existing .env.development to .env.development.bak"
  cp "$ENV_FILE" "$ENV_FILE.bak"
fi

if [[ "$SKIP_TRINO" == false ]]; then
  TRINO_PORT=$(kubectl get svc trino-coordinator -o jsonpath='{.spec.ports[0].nodePort}')

  # Probe Trino reachability the same way we did for Keycloak.
  TRINO_BASE_URL=""
  for base in "https://${NODE_IP}:${TRINO_PORT}" "https://127.0.0.1:${TRINO_PORT}" "https://localhost:${TRINO_PORT}"; do
    if curl -sfk --max-time 2 "${base}/v1/info" >/dev/null 2>&1; then
      TRINO_BASE_URL="$base"
      break
    fi
  done
  # Fall back to NODE_IP if none respond yet (Trino may still be starting).
  TRINO_BASE_URL="${TRINO_BASE_URL:-https://${NODE_IP}:${TRINO_PORT}}"
fi

if [[ "$SKIP_TRINO" == false ]]; then
  cat > "$ENV_FILE" <<EOF
STACKABLE_COCKPIT_OIDC_DISCOVERY_URL=${OIDC_DISCOVERY_URL}
STACKABLE_COCKPIT_OIDC_CLIENT_ID=stackable-cockpit
STACKABLE_COCKPIT_OIDC_CLIENT_SECRET=${OIDC_CLIENT_SECRET}
STACKABLE_COCKPIT_SESSION_SECRET=${SESSION_SECRET}
STACKABLE_COCKPIT_BASE_URL=http://localhost:5173
STACKABLE_COCKPIT_AIRFLOW_URL=http://localhost:8089
STACKABLE_COCKPIT_AIRFLOW_AUTH_MODE=all-admins
STACKABLE_COCKPIT_TRINO_URL=${TRINO_BASE_URL}
STACKABLE_COCKPIT_TRINO_AUTH_TYPE=basic
STACKABLE_COCKPIT_TRINO_AUTH_USERNAME=stackable-cockpit
STACKABLE_COCKPIT_TRINO_AUTH_PASSWORD=stackable-cockpit-dev
STACKABLE_COCKPIT_TRINO_TLS_INSECURE=true
STACKABLE_COCKPIT_STORAGE_BROWSER_ENABLED=true
STACKABLE_COCKPIT_TEXT_PREVIEW_BYTES=262144
STACKABLE_COCKPIT_IMAGE_PREVIEW_BYTES=5242880
STACKABLE_COCKPIT_PDF_PREVIEW_BYTES=26214400
STACKABLE_COCKPIT_FILE_PREVIEW_ROWS=250
STACKABLE_COCKPIT_FILE_PREVIEW_COLUMNS=50
PUBLIC_STACKABLE_COCKPIT_STORAGE_AUTO_CONNECT=true
PUBLIC_STACKABLE_COCKPIT_PAGE_SIZES=25,50,100
PUBLIC_STACKABLE_COCKPIT_DEFAULT_PAGE_SIZE=25
PUBLIC_STACKABLE_COCKPIT_MAX_RECENT_FILES=15
PUBLIC_STACKABLE_COCKPIT_UPLOAD_CONCURRENCY=3
EOF
else
  cat > "$ENV_FILE" <<EOF
STACKABLE_COCKPIT_OIDC_DISCOVERY_URL=${OIDC_DISCOVERY_URL}
STACKABLE_COCKPIT_OIDC_CLIENT_ID=stackable-cockpit
STACKABLE_COCKPIT_OIDC_CLIENT_SECRET=${OIDC_CLIENT_SECRET}
STACKABLE_COCKPIT_SESSION_SECRET=${SESSION_SECRET}
STACKABLE_COCKPIT_BASE_URL=http://localhost:5173
STACKABLE_COCKPIT_AIRFLOW_URL=http://localhost:8089
STACKABLE_COCKPIT_AIRFLOW_AUTH_MODE=all-admins
STACKABLE_COCKPIT_STORAGE_BROWSER_ENABLED=true
STACKABLE_COCKPIT_TEXT_PREVIEW_BYTES=262144
STACKABLE_COCKPIT_IMAGE_PREVIEW_BYTES=5242880
STACKABLE_COCKPIT_PDF_PREVIEW_BYTES=26214400
STACKABLE_COCKPIT_FILE_PREVIEW_ROWS=250
STACKABLE_COCKPIT_FILE_PREVIEW_COLUMNS=50
PUBLIC_STACKABLE_COCKPIT_STORAGE_AUTO_CONNECT=true
PUBLIC_STACKABLE_COCKPIT_PAGE_SIZES=25,50,100
PUBLIC_STACKABLE_COCKPIT_DEFAULT_PAGE_SIZE=25
PUBLIC_STACKABLE_COCKPIT_MAX_RECENT_FILES=15
PUBLIC_STACKABLE_COCKPIT_UPLOAD_CONCURRENCY=3
EOF
fi

echo "Wrote $ENV_FILE"

# ------------------------------------------------------------------
# 9. Create Kubernetes Secret for the Helm chart
# ------------------------------------------------------------------
echo ""
echo "Creating stackable-cockpit-credentials Secret..."
kubectl delete secret stackable-cockpit-credentials --ignore-not-found
kubectl create secret generic stackable-cockpit-credentials \
  --from-literal=oidc-client-secret="$SECRET" \
  --from-literal=trino-auth-password=stackable-cockpit-dev

# ------------------------------------------------------------------
# 10. Wait for Trino to be ready
# ------------------------------------------------------------------
if [[ "$SKIP_TRINO" == false ]]; then
  echo ""
  echo "Waiting for Trino to be ready..."
  kubectl rollout status statefulset/trino-coordinator-default --timeout=300s

  echo "Trino endpoint: https://${NODE_IP}:${TRINO_PORT}"
fi

# ------------------------------------------------------------------
# Done
# ------------------------------------------------------------------
echo ""
echo "=== Setup complete ==="
echo ""
echo "Start the dev server with:  npm run dev"
echo ""
echo "Keycloak:       http://${NODE_IP}:30080"
echo "  Admin:        admin / admin"
echo ""
if [[ "$SKIP_TRINO" == false ]]; then
  echo "Trino endpoint: https://${NODE_IP}:${TRINO_PORT}"
  echo ""
  echo "Trino connection is pre-configured via STACKABLE_COCKPIT_TRINO_* env vars."
  echo ""
else
  echo "Trino was skipped. Add STACKABLE_COCKPIT_TRINO_* vars to $ENV_FILE manually when ready."
  echo ""
fi
if [[ "$SKIP_GARAGE" == false ]]; then
  echo "Garage S3:      http://${NODE_IP}:30900  (admin: http://${NODE_IP}:30902)"
  echo "  Credentials written to s3-config.json for E2E tests."
  echo ""
fi
echo "Test users (OIDC):"
echo "  alice / alicealice"
echo "  bob   / bobbob"
