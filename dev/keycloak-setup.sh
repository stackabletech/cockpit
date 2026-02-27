#!/usr/bin/env bash
# Sets up a local Keycloak realm and client for development OIDC testing.
# Keycloak is expected to be running via dev/keycloak.yaml on a kind cluster.
set -euo pipefail

echo "Waiting for Keycloak to be ready..."
kubectl wait --for=condition=available deployment/keycloak --timeout=120s

POD=$(kubectl get pod -l app=keycloak -o jsonpath='{.items[0].metadata.name}')

kcadm() {
  kubectl exec "$POD" -- /opt/keycloak/bin/kcadm.sh "$@"
}

echo "Logging in..."
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
  -s 'redirectUris=["http://localhost:5173/*"]' \
  -s 'webOrigins=["http://localhost:5173"]' \
  -i)

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

echo ""
echo "Done. Add to .env.development:"
echo ""
echo "STACKABLE_UI_OIDC_DISCOVERY_URL=http://172.18.0.2:30080/realms/stackable/.well-known/openid-configuration"
echo "STACKABLE_UI_OIDC_CLIENT_ID=stackable-ui"
echo "STACKABLE_UI_OIDC_CLIENT_SECRET=$SECRET"
echo "STACKABLE_UI_SESSION_SECRET=$(openssl rand -hex 32)"
echo "STACKABLE_UI_BASE_URL=http://localhost:5173"
echo ""
echo "Test users: alice/alicealice  bob/bobbob"
