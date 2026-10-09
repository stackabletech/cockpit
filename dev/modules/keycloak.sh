# shellcheck shell=bash
keycloak::deploy() {
  log::info "Deploying Keycloak..."
  kubectl apply -f "$SCRIPT_DIR/keycloak.yaml"
  k8s::wait_for_deployment keycloak 120
}

keycloak::configure() {
  log::info "Configuring Keycloak..."

  local pod
  pod=$(k8s::get_pod_name app=keycloak)

  local keycloak_url
  if ! keycloak_url=$(probe::url 30080 /realms/master); then
    log::error "Could not reach Keycloak via NodePort 30080 within 120s."
  fi
  KEYCLOAK_BASE_URL="$keycloak_url"
  log::info "Keycloak URL: ${KEYCLOAK_BASE_URL}"

  log::info "Waiting for Keycloak to accept connections..."
  until curl -sf "${KEYCLOAK_BASE_URL}/realms/master" >/dev/null 2>&1; do
    sleep 2
  done

  kcadm() {
    kubectl exec "$pod" -- /opt/keycloak/bin/kcadm.sh "$@"
  }

  if kcadm get realms/stackable --fields realm 2>/dev/null | grep -q '"stackable"'; then
    log::info "Realm 'stackable' already exists, skipping Keycloak configuration."
    local client_uuid
    client_uuid=$(kcadm get clients -r stackable --fields id,clientId \
      | grep -B1 '"stackable-cockpit"' | grep '"id"' | sed 's/.*: *"\(.*\)".*/\1/')
    local client_secret
    client_secret=$(kcadm get clients/"$client_uuid"/client-secret -r stackable --fields value \
      | grep '"value"' | sed 's/.*: *"\(.*\)".*/\1/')
    export OIDC_CLIENT_SECRET="$client_secret"
    return
  fi

  log::info "Logging into Keycloak admin CLI..."
  kcadm config credentials \
    --server http://localhost:8080 \
    --realm master \
    --user admin \
    --password admin

  log::info "Creating realm 'stackable'..."
  kcadm create realms -s realm=stackable -s enabled=true

  log::info "Creating client 'stackable-cockpit'..."
  local client_uuid
  client_uuid=$(kcadm create clients -r stackable \
    -s clientId=stackable-cockpit \
    -s enabled=true \
    -s protocol=openid-connect \
    -s publicClient=false \
    -s standardFlowEnabled=true \
    -s directAccessGrantsEnabled=false \
    -s 'redirectUris=["*"]' \
    -s 'webOrigins=["*"]' \
    -i)

  log::info "Creating client 'trino'..."
  kcadm create clients -r stackable \
    -s clientId=trino \
    -s enabled=true \
    -s protocol=openid-connect \
    -s publicClient=false \
    -s standardFlowEnabled=true \
    -s directAccessGrantsEnabled=false \
    -s secret=trino-oidc-dev \
    -s 'redirectUris=["*"]' \
    -s 'webOrigins=["*"]'

  __keycloak_create_user alice alicealice Alice Example
  __keycloak_create_user bob bobbob Bob Example

  log::info "Fetching client secret..."
  local client_secret
  client_secret=$(kcadm get clients/"$client_uuid"/client-secret -r stackable --fields value \
    | grep '"value"' | sed 's/.*: *"\(.*\)".*/\1/')
  export OIDC_CLIENT_SECRET="$client_secret"
}

__keycloak_create_user() {
  local username=$1 password=$2 first=$3 last=$4
  log::info "Creating user '$username'..."
  kcadm create users -r stackable \
    -s username="$username" \
    -s email="$username@example.com" \
    -s firstName="$first" \
    -s lastName="$last" \
    -s enabled=true
  kcadm set-password -r stackable --username "$username" --new-password "$password"
}
