#!/usr/bin/env bash
# Sets up the full local dev environment on a kind cluster.
# Assumes: kind cluster is running, kubectl context points to it.
set -euo pipefail

SKIP_TRINO=false
SKIP_GARAGE=false
SKIP_AIRFLOW=false
for arg in "$@"; do
  case "$arg" in
    --skip-trino) SKIP_TRINO=true ;;
    --skip-garage) SKIP_GARAGE=true ;;
    --skip-airflow) SKIP_AIRFLOW=true ;;
    *) echo "Unknown argument: $arg"; echo "Usage: $0 [--skip-trino] [--skip-garage] [--skip-airflow]"; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env.development"
PROXY_DIR="$SCRIPT_DIR/.proxy"
PROXY_CONTAINER_NAME=stackable-cockpit-dev-proxy
DEV_PROXY_HOST=localhost
DEV_PROXY_URL="https://${DEV_PROXY_HOST}:8443"
EXTERNAL_AIRFLOW_URL="${DEV_AIRFLOW_URL:-}"
EXTERNAL_KEYCLOAK_URL="${DEV_AIRFLOW_KEYCLOAK_URL:-}"
AIRFLOW_KEYCLOAK_TLS_INSECURE=""
read -r VITE_PROXY_HOST _ <<< "$(hostname -I)"
if [ -z "$VITE_PROXY_HOST" ]; then
  echo "ERROR: Could not detect a host address reachable from the nginx container."
  exit 1
fi

docker_proxy() {
  local docker_config_dir="$PROXY_DIR/docker-config"
  mkdir -p "$docker_config_dir"
  if [[ ! -f "$docker_config_dir/config.json" ]]; then
    printf '{"auths":{}}' > "$docker_config_dir/config.json"
  fi
  DOCKER_CONFIG="$docker_config_dir" docker "$@"
}

echo "=== Stackable Cockpit dev environment setup ==="
if [[ "$SKIP_TRINO" == true ]]; then
  echo "(Trino deployment skipped via --skip-trino)"
fi
if [[ "$SKIP_GARAGE" == true ]]; then
  echo "(Garage deployment skipped via --skip-garage)"
fi
if [[ "$SKIP_AIRFLOW" == true ]]; then
  echo "(Airflow and HTTPS proxy deployment skipped via --skip-airflow)"
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
    if curl -sf --max-time 2 "${base}/keycloak/realms/master" >/dev/null 2>&1; then
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
echo "Keycloak URL: ${KEYCLOAK_BASE_URL}/keycloak"

echo "Waiting for Keycloak to accept connections"
until curl -sf "${KEYCLOAK_BASE_URL}/keycloak/realms/master" >/dev/null 2>&1; do
  sleep 2
done

kcadm() {
  kubectl exec "$POD" -- /opt/keycloak/bin/kcadm.sh "$@"
}

echo "Logging into Keycloak admin CLI..."
kcadm config credentials \
  --server http://localhost:8080/keycloak \
  --realm master \
  --user admin \
  --password admin

# Check if realm already exists
if kcadm get realms/stackable --fields realm 2>/dev/null | grep -q '"stackable"'; then
  echo "Realm 'stackable' already exists, skipping Keycloak configuration."
  # Still need to fetch the client secret
  CLIENT_UUID=$(kcadm get clients -r stackable --fields id,clientId \
    | grep -B1 '"stackable-cockpit"' | grep '"id"' | sed 's/.*: *"\(.*\)".*/\1/')
  SECRET=$(kcadm get clients/"$CLIENT_UUID"/client-secret -r stackable --fields value \
    | grep '"value"' | sed 's/.*: *"\(.*\)".*/\1/')
else
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

  echo "Creating client 'airflow'..."
  kcadm create clients \
    -r stackable \
    -s clientId=airflow \
    -s enabled=true \
    -s protocol=openid-connect \
    -s publicClient=false \
    -s standardFlowEnabled=true \
    -s directAccessGrantsEnabled=false \
    -s secret=airflow-oidc-dev \
    -s 'redirectUris=["https://localhost:8443/airflow/*"]' \
    -s 'webOrigins=["https://localhost:8443"]'

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
  create_user admin adminadmin Admin Example

  echo "Fetching client secret..."
  SECRET=$(kcadm get clients/"$CLIENT_UUID"/client-secret -r stackable --fields value \
    | grep '"value"' | sed 's/.*: *"\(.*\)".*/\1/')
fi

# Ensure the Airflow client exists when rerunning setup against an existing realm
# created before Airflow embedding was added.
if ! kcadm get clients -r stackable -q clientId=airflow --fields clientId | grep -q '"airflow"'; then
  echo "Creating missing client 'airflow'..."
  kcadm create clients \
    -r stackable \
    -s clientId=airflow \
    -s enabled=true \
    -s protocol=openid-connect \
    -s publicClient=false \
    -s standardFlowEnabled=true \
    -s directAccessGrantsEnabled=false \
    -s secret=airflow-oidc-dev \
    -s 'redirectUris=["https://localhost:8443/airflow/*"]' \
    -s 'webOrigins=["https://localhost:8443"]'
fi

if ! kcadm get users -r stackable -q username=admin | grep -q '"username"[[:space:]]*:[[:space:]]*"admin"'; then
  echo "Creating missing user 'admin'..."
  kcadm create users \
    -r stackable \
    -s username=admin \
    -s email=admin@example.com \
    -s firstName=Admin \
    -s lastName=Example \
    -s enabled=true
  kcadm set-password \
    -r stackable \
    --username admin \
    --new-password adminadmin
fi

COCKPIT_BASE_URL=http://localhost:5173
OIDC_DISCOVERY_URL="${KEYCLOAK_BASE_URL}/keycloak/realms/stackable/.well-known/openid-configuration"
if [[ "$SKIP_AIRFLOW" == true ]]; then
  docker_proxy rm -f "$PROXY_CONTAINER_NAME" >/dev/null 2>&1 || true
fi

# ------------------------------------------------------------------
# 6. Deploy Airflow and start the same-origin HTTPS proxy
# ------------------------------------------------------------------
if [[ "$SKIP_AIRFLOW" == false ]]; then
  if [[ -z "$EXTERNAL_AIRFLOW_URL" ]]; then
    echo ""
    echo "Deploying Airflow..."
    kubectl apply -f "$SCRIPT_DIR/airflow.yaml"
    kubectl rollout status deployment/airflow --timeout=300s
  fi

  if [[ -n "$EXTERNAL_AIRFLOW_URL" ]]; then
    if [[ -z "$EXTERNAL_KEYCLOAK_URL" ]]; then
      echo "ERROR: DEV_AIRFLOW_KEYCLOAK_URL is required with DEV_AIRFLOW_URL."
      exit 1
    fi
    AIRFLOW_BASE_URL="${EXTERNAL_AIRFLOW_URL%/}"
    AIRFLOW_PROXY_PASS="${AIRFLOW_BASE_URL}/"
    AIRFLOW_KEYCLOAK_BASE_URL="${EXTERNAL_KEYCLOAK_URL%/}"
    AIRFLOW_KEYCLOAK_PROXY_PASS="${AIRFLOW_KEYCLOAK_BASE_URL}/"
    if [[ "${DEV_AIRFLOW_KEYCLOAK_TLS_INSECURE:-false}" == true ]]; then
      AIRFLOW_KEYCLOAK_TLS_INSECURE='proxy_ssl_verify off;'
    fi
  else
    AIRFLOW_PORT=$(kubectl get svc airflow -o jsonpath='{.spec.ports[0].nodePort}')
    AIRFLOW_BASE_URL=""
    deadline=$(( $(date +%s) + 120 ))
    while [ -z "$AIRFLOW_BASE_URL" ] && [ "$(date +%s)" -lt "$deadline" ]; do
      for base in "http://${NODE_IP}:${AIRFLOW_PORT}" "http://127.0.0.1:${AIRFLOW_PORT}" "http://localhost:${AIRFLOW_PORT}"; do
        status=$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' "${base}/airflow/" || true)
        if [[ "$status" =~ ^[23][0-9]{2}$ ]]; then
          AIRFLOW_BASE_URL="$base"
          break
        fi
      done
      [ -z "$AIRFLOW_BASE_URL" ] && sleep 2
    done

    if [ -z "$AIRFLOW_BASE_URL" ]; then
      echo "ERROR: Could not reach Airflow via NodePort ${AIRFLOW_PORT} within 120s."
      exit 1
    fi
    AIRFLOW_PROXY_PASS="$AIRFLOW_BASE_URL"
    AIRFLOW_KEYCLOAK_BASE_URL="$KEYCLOAK_BASE_URL"
    AIRFLOW_KEYCLOAK_PROXY_PASS="$KEYCLOAK_BASE_URL"
  fi
  CERT_FILE="${DEV_PROXY_CERT_FILE:-$PROXY_DIR/tls.crt}"
  KEY_FILE="${DEV_PROXY_KEY_FILE:-$PROXY_DIR/tls.key}"
  if [[ -n "${DEV_PROXY_CERT_FILE:-}" || -n "${DEV_PROXY_KEY_FILE:-}" ]]; then
    if [[ -z "${DEV_PROXY_CERT_FILE:-}" || -z "${DEV_PROXY_KEY_FILE:-}" ]]; then
      echo "ERROR: Set both DEV_PROXY_CERT_FILE and DEV_PROXY_KEY_FILE."
      exit 1
    fi
    cp "$DEV_PROXY_CERT_FILE" "$PROXY_DIR/tls.crt"
    cp "$DEV_PROXY_KEY_FILE" "$PROXY_DIR/tls.key"
  elif [[ ! -f "$CERT_FILE" || ! -f "$KEY_FILE" ]]; then
    echo "Generating localhost TLS certificate for the development proxy..."
    openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 365 \
      -subj '/CN=localhost' \
      -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' \
      -keyout "$KEY_FILE" \
      -out "$CERT_FILE" >/dev/null 2>&1
  fi
  chmod 600 "$PROXY_DIR/tls.key"

  docker_proxy rm -f "$PROXY_CONTAINER_NAME" >/dev/null 2>&1 || true
  echo "Starting same-origin HTTPS proxy at ${DEV_PROXY_URL}..."
  docker_proxy run -d --rm \
    --name "$PROXY_CONTAINER_NAME" \
    --network host \
    -e DEV_PROXY_HOST="$DEV_PROXY_HOST" \
    -e VITE_PROXY_HOST="$VITE_PROXY_HOST" \
    -e AIRFLOW_BASE_URL="$AIRFLOW_BASE_URL" \
    -e KEYCLOAK_BASE_URL="$KEYCLOAK_BASE_URL" \
    -e AIRFLOW_PROXY_PASS="$AIRFLOW_PROXY_PASS" \
    -e AIRFLOW_KEYCLOAK_BASE_URL="$AIRFLOW_KEYCLOAK_BASE_URL" \
    -e AIRFLOW_KEYCLOAK_PROXY_PASS="$AIRFLOW_KEYCLOAK_PROXY_PASS" \
    -e AIRFLOW_KEYCLOAK_TLS_INSECURE="$AIRFLOW_KEYCLOAK_TLS_INSECURE" \
    -v "$SCRIPT_DIR/nginx.conf.template:/etc/nginx/templates/default.conf.template:ro" \
    -v "$PROXY_DIR/tls.crt:/etc/nginx/certs/tls.crt:ro" \
    -v "$PROXY_DIR/tls.key:/etc/nginx/certs/tls.key:ro" \
    nginx:1.29-alpine >/dev/null

  deadline=$(( $(date +%s) + 30 ))
  until curl -skf --max-time 2 "${DEV_PROXY_URL}/keycloak/realms/master" >/dev/null 2>&1; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "ERROR: The local HTTPS proxy did not become ready."
      docker_proxy logs "$PROXY_CONTAINER_NAME" >&2 || true
      exit 1
    fi
    sleep 1
  done

  COCKPIT_BASE_URL="$DEV_PROXY_URL"
  OIDC_DISCOVERY_URL="${DEV_PROXY_URL}/keycloak/realms/stackable/.well-known/openid-configuration"
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
STACKABLE_COCKPIT_OIDC_CLIENT_SECRET=${SECRET}
STACKABLE_COCKPIT_SESSION_SECRET=${SESSION_SECRET}
STACKABLE_COCKPIT_BASE_URL=${COCKPIT_BASE_URL}
ORIGIN=${COCKPIT_BASE_URL}
PROTOCOL_HEADER=x-forwarded-proto
HOST_HEADER=x-forwarded-host
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
STACKABLE_COCKPIT_OIDC_CLIENT_SECRET=${SECRET}
STACKABLE_COCKPIT_SESSION_SECRET=${SESSION_SECRET}
STACKABLE_COCKPIT_BASE_URL=${COCKPIT_BASE_URL}
ORIGIN=${COCKPIT_BASE_URL}
PROTOCOL_HEADER=x-forwarded-proto
HOST_HEADER=x-forwarded-host
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
echo "Start or restart the dev server with:  npm run dev"
echo "  Restart it after every setup run so it reloads .env.development."
if [[ "$SKIP_AIRFLOW" == false ]]; then
  echo "Open Cockpit through:      ${DEV_PROXY_URL}"
  echo "Airflow bookmark URL:      ${DEV_PROXY_URL}/airflow/"
  echo "Airflow user:              admin / adminadmin"
  echo ""
fi
echo ""
echo "Keycloak:       ${DEV_PROXY_URL}/keycloak/"
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
