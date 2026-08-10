#!/usr/bin/env bash
# (Re)create the `stackable` realm in Keycloak for integrated mode. In integrated mode
# Keycloak's only OIDC client is Dex (products + Cockpit are clients of Dex, not Keycloak).
#
# NOTE: the dev Keycloak runs `start-dev` with an in-memory DB, so realm state is lost on
# every pod restart. Re-run this after any Keycloak restart. Idempotent.
set -euo pipefail

REALM=stackable
DEX_REDIRECT="https://dex.sdp.test/callback"
DEX_SECRET="dex-oidc-dev"

POD="$(kubectl get pod -l app=keycloak -o jsonpath='{.items[0].metadata.name}')"
kcadm() { kubectl exec "$POD" -- /opt/keycloak/bin/kcadm.sh "$@"; }

echo "==> waiting for Keycloak (via kcadm admin login; the container has no curl)"
until kcadm config credentials --server http://localhost:8080 --realm master --user admin --password admin >/dev/null 2>&1; do
  sleep 3
done

if kcadm get "realms/$REALM" --fields realm 2>/dev/null | grep -q "\"$REALM\""; then
  echo "==> realm '$REALM' already exists"
else
  echo "==> creating realm '$REALM'"
  kcadm create realms -s realm="$REALM" -s enabled=true
fi

if kcadm get clients -r "$REALM" --fields clientId 2>/dev/null | grep -q '"dex"'; then
  echo "==> client 'dex' already exists"
else
  echo "==> creating client 'dex'"
  kcadm create clients -r "$REALM" \
    -s clientId=dex \
    -s enabled=true \
    -s protocol=openid-connect \
    -s publicClient=false \
    -s standardFlowEnabled=true \
    -s directAccessGrantsEnabled=false \
    -s secret="$DEX_SECRET" \
    -s "redirectUris=[\"$DEX_REDIRECT\"]" \
    -s 'webOrigins=["https://dex.sdp.test"]'
fi

create_user() {
  local username=$1 password=$2 first=$3 last=$4
  if kcadm get users -r "$REALM" -q username="$username" --fields username 2>/dev/null | grep -q "\"$username\""; then
    echo "==> user '$username' already exists"; return
  fi
  echo "==> creating user '$username'"
  kcadm create users -r "$REALM" \
    -s username="$username" -s email="$username@example.com" \
    -s firstName="$first" -s lastName="$last" -s enabled=true
  kcadm set-password -r "$REALM" --username "$username" --new-password "$password"
}
create_user alice alicealice Alice Example
create_user bob   bobbob     Bob   Example

echo "==> done. Dex client secret: $DEX_SECRET  redirect: $DEX_REDIRECT"
