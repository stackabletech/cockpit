#!/usr/bin/env bash
# Sets up the full local dev environment on a kind cluster.
# Assumes: kind cluster is running, kubectl context points to it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env.development"

echo "=== Stackable UI dev environment setup ==="
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
echo "Installing Stackable operators (commons, listener, secret, trino)..."
stackablectl operator install commons listener secret trino

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
echo ""
echo "Deploying Trino..."
sed "s/\${NODE_IP}/$NODE_IP/g" "$SCRIPT_DIR/trino.yaml" | kubectl apply -f -

echo "Waiting for Keycloak to accept connections"
until curl -sf "http://${NODE_IP}:30080/realms/master" >/dev/null 2>&1; do
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

TRINO_PORT=$(kubectl get svc trino-coordinator -o jsonpath='{.spec.ports[0].nodePort}')

cat > "$ENV_FILE" <<EOF
STACKABLE_UI_OIDC_DISCOVERY_URL=http://${NODE_IP}:30080/realms/stackable/.well-known/openid-configuration
STACKABLE_UI_OIDC_CLIENT_ID=stackable-cockpit
STACKABLE_UI_OIDC_CLIENT_SECRET=${SECRET}
STACKABLE_UI_SESSION_SECRET=${SESSION_SECRET}
STACKABLE_UI_BASE_URL=http://localhost:5173
STACKABLE_UI_TRINO_URL=https://${NODE_IP}:${TRINO_PORT}
STACKABLE_UI_TRINO_AUTH_TYPE=basic
STACKABLE_UI_TRINO_AUTH_USERNAME=stackable-cockpit
STACKABLE_UI_TRINO_AUTH_PASSWORD=stackable-cockpit-dev
STACKABLE_UI_TRINO_TLS_INSECURE=true
EOF

echo "Wrote $ENV_FILE"

# ------------------------------------------------------------------
# 8. Wait for Trino to be ready
# ------------------------------------------------------------------
echo ""
echo "Waiting for Trino to be ready..."
kubectl rollout status statefulset/trino-coordinator-default --timeout=300s

echo "Trino endpoint: https://${NODE_IP}:${TRINO_PORT}"

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
echo "Trino endpoint: https://${NODE_IP}:${TRINO_PORT}"
echo ""
echo "Trino connection is pre-configured via STACKABLE_UI_TRINO_* env vars."
echo ""
echo "Test users (OIDC):"
echo "  alice / alicealice"
echo "  bob   / bobbob"
