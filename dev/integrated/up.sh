#!/usr/bin/env bash
# Bring up the integrated-Cockpit PoC (iframe-spike Layer 1) on top of the baseline.
#
# Prerequisites:
#   1. kind cluster created from dev/integrated/kind-config.yaml (pinned apiserver 6443, 80/443).
#   2. Baseline deployed: dev/setup.sh --skip-garage   (operators + Keycloak + Trino + .env.development)
#
# This script is idempotent. It installs ingress-nginx, wires Dex as a broker, repoints Trino +
# Cockpit at Dex, and exposes everything behind the ingress over TLS on *.sdp.test / idp.corp.test.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
PROJECT_DIR="$(cd ../.. && pwd)"
ENV_FILE="$PROJECT_DIR/.env.development"

INGRESS_NGINX_VERSION="controller-v1.15.1"
echo "### 0/8 ingress-nginx (${INGRESS_NGINX_VERSION}, kind provider)"
kubectl apply -f "https://raw.githubusercontent.com/kubernetes/ingress-nginx/${INGRESS_NGINX_VERSION}/deploy/static/provider/kind/deploy.yaml" >/dev/null
kubectl -n ingress-nginx wait --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller --timeout=180s

echo "### 1/8 TLS (wildcard cert + CA into the cluster)"
bash ./tls.sh

echo "### 2/8 import the CA as a SecretClass keypair (for Trino OIDC verification)"
kubectl create secret generic sdp-oidc-ca-keypair \
  --from-file=0.ca.crt=certs/rootCA.pem --from-file=0.ca.key=certs/rootCA.key \
  -n default --dry-run=client -o yaml | kubectl apply -f - >/dev/null

echo "### 3/8 CoreDNS rewrites (in-cluster resolution of the public hostnames)"
bash ./coredns-rewrite.sh

echo "### 4/8 Keycloak: stable issuer at idp.corp.test + realm/clients (restart wipes the dev DB, so patch THEN configure)"
kubectl patch deployment keycloak --type strategic --patch-file keycloak-patch.yaml >/dev/null
kubectl rollout status deployment/keycloak --timeout=120s
bash ./keycloak-config.sh

echo "### 5/8 Dex broker (restart so it reloads the CA + any config on re-runs)"
kubectl apply -f dex.yaml >/dev/null
kubectl rollout restart deploy/dex >/dev/null
kubectl rollout status deploy/dex --timeout=120s

echo "### 6/8 Chrome proxy (injects the in-frame script) + ingress routes"
kubectl apply -f trino-chrome-proxy.yaml >/dev/null
kubectl rollout status deploy/trino-chrome --timeout=90s
kubectl apply -f ingress.yaml >/dev/null

echo "### 7/8 Repoint Trino OIDC at Dex + force a reconcile"
kubectl apply -f trino-oidc-dex.yaml >/dev/null
# process-forwarded so Trino builds https://trino.sdp.test/oauth2/callback behind the ingress;
# patching also forces the operator to re-render config from the updated AuthenticationClass.
kubectl patch trinocluster trino --type merge \
  -p '{"spec":{"coordinators":{"configOverrides":{"config.properties":{"http-server.process-forwarded":"true"}}}}}' >/dev/null
# Explicit restart so a re-run picks up a changed CA (e.g. after switching openssl -> mkcert),
# since an unchanged patch does not trigger operator reconcile.
kubectl rollout restart statefulset/trino-coordinator-default >/dev/null 2>&1 || true
kubectl rollout status statefulset/trino-coordinator-default --timeout=300s || true

echo "### 8/8 Cockpit: dev-server Service + integrated OIDC env"
kubectl apply -f cockpit-devserver.yaml >/dev/null
cp "$ENV_FILE" "$ENV_FILE.pre-integrated.bak" 2>/dev/null || true
set_env() { # key value  -> replace the line or append
  local k=$1 v=$2
  if grep -q "^${k}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s#^${k}=.*#${k}=${v}#" "$ENV_FILE"
  else
    printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"
  fi
}
set_env STACKABLE_COCKPIT_OIDC_DISCOVERY_URL https://dex.sdp.test/.well-known/openid-configuration
set_env STACKABLE_COCKPIT_OIDC_CLIENT_ID cockpit
set_env STACKABLE_COCKPIT_OIDC_CLIENT_SECRET cockpit-oidc-dev
set_env STACKABLE_COCKPIT_BASE_URL https://cockpit.sdp.test
set_env STACKABLE_COCKPIT_INTEGRATED_HOST cockpit.sdp.test

cat <<EOF

=== Integrated PoC is up (server-side) ===

Host steps still required for the browser (the sandboxed agent cannot do these):
  1. /etc/hosts:  127.0.0.1 cockpit.sdp.test dex.sdp.test trino.sdp.test idp.corp.test
  2. Browser-trusted TLS: install mkcert (+ libnss3-tools), then re-run  dev/integrated/tls.sh

Then start Cockpit (binds 0.0.0.0 so the ingress can reach it):
  npm run dev

Open:  https://cockpit.sdp.test   (login: alice / alicealice)
Trino UI full-page:  https://trino.sdp.test/ui/
EOF
