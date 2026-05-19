#!/usr/bin/env bash
# Sets up the full local dev environment on a kind cluster.
# Assumes: kind cluster is running, kubectl context points to it.
set -euo pipefail

SKIP_TRINO=false
for arg in "$@"; do
  case "$arg" in
    --skip-trino) SKIP_TRINO=true ;;
    *) echo "Unknown argument: $arg"; echo "Usage: $0 [--skip-trino]"; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env.development"

echo "=== Stackable UI dev environment setup ==="
if [[ "$SKIP_TRINO" == true ]]; then
  echo "(Trino deployment skipped via --skip-trino)"
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

# On some local Kubernetes distributions (e.g. Rancher Desktop k3s), the node's
# InternalIP is not reachable from the host network, but NodePorts are exposed
# on localhost. Probe both and use the first reachable URL.
KEYCLOAK_BASE_URL=""
for base in "http://${NODE_IP}:30080" "http://127.0.0.1:30080" "http://localhost:30080"; do
  if curl -sf --max-time 2 "${base}/realms/master" >/dev/null 2>&1; then
    KEYCLOAK_BASE_URL="$base"
    break
  fi
done

if [ -z "$KEYCLOAK_BASE_URL" ]; then
  echo "ERROR: Could not reach Keycloak via NodePort 30080."
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

# Check if realm already exists
if kcadm get realms/stackable --fields realm 2>/dev/null | grep -q '"stackable"'; then
  echo "Realm 'stackable' already exists, skipping Keycloak configuration."
  # Still need to fetch the client secret
  CLIENT_UUID=$(kcadm get clients -r stackable --fields id,clientId \
    | grep -B1 '"stackable-ui"' | grep '"id"' | sed 's/.*: *"\(.*\)".*/\1/')
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

  echo "Creating client 'stackable-ui'..."
  CLIENT_UUID=$(kcadm create clients \
    -r stackable \
    -s clientId=stackable-ui \
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

  create_user() {
    local username=$1 password=$2 first=$3 last=$4
    echo "Creating user '$username'..."
    kcadm create users \
      -r stackable \
      -s username="$username" \
      -s email="$username@example.com" \
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
# 7. Write .env.development
# ------------------------------------------------------------------
echo ""
SESSION_SECRET=$(openssl rand -hex 32)

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
STACKABLE_UI_OIDC_DISCOVERY_URL=${KEYCLOAK_BASE_URL}/realms/stackable/.well-known/openid-configuration
STACKABLE_UI_OIDC_CLIENT_ID=stackable-ui
STACKABLE_UI_OIDC_CLIENT_SECRET=${SECRET}
STACKABLE_UI_SESSION_SECRET=${SESSION_SECRET}
STACKABLE_UI_BASE_URL=http://localhost:5173
STACKABLE_UI_TRINO_URL=${TRINO_BASE_URL}
STACKABLE_UI_TRINO_AUTH_TYPE=basic
STACKABLE_UI_TRINO_AUTH_USERNAME=stackable-ui
STACKABLE_UI_TRINO_AUTH_PASSWORD=stackable-ui-dev
STACKABLE_UI_TRINO_TLS_INSECURE=true
STACKABLE_UI_STORAGE_BROWSER_ENABLED=true
PUBLIC_STACKABLE_UI_STORAGE_AUTO_CONNECT=true
EOF
else
  cat > "$ENV_FILE" <<EOF
STACKABLE_UI_OIDC_DISCOVERY_URL=${KEYCLOAK_BASE_URL}/realms/stackable/.well-known/openid-configuration
STACKABLE_UI_OIDC_CLIENT_ID=stackable-ui
STACKABLE_UI_OIDC_CLIENT_SECRET=${SECRET}
STACKABLE_UI_SESSION_SECRET=${SESSION_SECRET}
STACKABLE_UI_BASE_URL=http://localhost:5173
STACKABLE_UI_STORAGE_BROWSER_ENABLED=true
PUBLIC_STACKABLE_UI_STORAGE_AUTO_CONNECT=true
EOF
fi

echo "Wrote $ENV_FILE"

# ------------------------------------------------------------------
# 8. Wait for Trino to be ready
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
  echo "Trino connection is pre-configured via STACKABLE_UI_TRINO_* env vars."
  echo ""
else
  echo "Trino was skipped. Add STACKABLE_UI_TRINO_* vars to $ENV_FILE manually when ready."
  echo ""
fi
echo "Test users (OIDC):"
echo "  alice / alicealice"
echo "  bob   / bobbob"
