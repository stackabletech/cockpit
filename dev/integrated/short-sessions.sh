#!/usr/bin/env bash
# Item 2 (iframe-spike §4.7): make "session expiry with the frame open" testable in ~1 minute by
# shortening Keycloak's SSO session (the upstream IdP clock). When the upstream session has lapsed
# and something in the frame re-authenticates, the IdP must RENDER a login inside the frame — and
# Keycloak sends X-Frame-Options: SAMEORIGIN, so that render is blocked. That is the escape hatch.
#
# NB: we do NOT touch Trino's session here. `web-ui.session-timeout` is form-auth-only and Trino
# hard-fails startup on it under oauth2 ("Configuration property ... was not used"). Under oauth2
# Trino's UI session is bounded by the OIDC token; to force an in-frame re-auth on demand, delete
# the `__Secure-Trino-*` cookie for trino.sdp.test in devtools and refresh the frame (see below).
#
#   dev/integrated/short-sessions.sh            # apply short Keycloak SSO session (test mode)
#   dev/integrated/short-sessions.sh --restore  # restore normal lifetimes
set -euo pipefail

RESTORE=false
[ "${1:-}" = "--restore" ] && RESTORE=true

POD="$(kubectl get pod -l app=keycloak -o jsonpath='{.items[0].metadata.name}')"
kcadm() { kubectl exec "$POD" -- /opt/keycloak/bin/kcadm.sh "$@"; }
until kcadm config credentials --server http://localhost:8080 --realm master --user admin --password admin >/dev/null 2>&1; do sleep 3; done

if [ "$RESTORE" = true ]; then
  echo "==> restoring normal Keycloak SSO session lifetimes"
  kcadm update realms/stackable \
    -s ssoSessionIdleTimeout=1800 -s ssoSessionMaxLifespan=36000 -s accessTokenLifespan=300
  echo "Restored."
else
  echo "==> Keycloak SSO session: idle 60s / max 120s"
  kcadm update realms/stackable \
    -s ssoSessionIdleTimeout=60 -s ssoSessionMaxLifespan=120 -s accessTokenLifespan=60
  cat <<'EOF'

Short Keycloak session applied. To observe the §4.7 escape hatch (fresh private/incognito window):
  1. Log in to https://cockpit.sdp.test and open Trino Console (Trino renders in-frame).
  2. Wait ~70s WITHOUT interacting, so Keycloak's SSO session idles out.
  3. Force Trino to re-authenticate in-frame: open devtools on the Trino frame, delete the
     `__Secure-Trino-*` cookie(s) for trino.sdp.test, then reload the iframe.
       -> Trino has no session -> 303 to Dex -> Keycloak (session gone) must render a login
          INSIDE the frame -> Keycloak's X-Frame-Options: SAMEORIGIN blocks it -> blank frame +
          a console error. That is the escape hatch: a product must NOT 302-to-IdP in a frame;
          it needs to signal the parent to re-auth at top level (Trino does not do this today).
  Revert with:  dev/integrated/short-sessions.sh --restore
EOF
fi
