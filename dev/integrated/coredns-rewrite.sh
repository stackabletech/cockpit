#!/usr/bin/env bash
# Make the PoC hostnames resolve *inside* the cluster to the ingress controller, so
# in-cluster OIDC clients can reach the public issuer URLs:
#   Trino -> https://dex.sdp.test   (JWKS/discovery/token)
#   Dex   -> https://idp.corp.test  (Keycloak discovery/token)
# The browser resolves the same names via /etc/hosts; this only covers pod-side DNS.
#
# Adds `rewrite name` rules to the kube-system/coredns Corefile pointing the names at
# ingress-nginx-controller.ingress-nginx.svc.cluster.local. Idempotent.
set -euo pipefail

TARGET="ingress-nginx-controller.ingress-nginx.svc.cluster.local"
NAMES=(cockpit.sdp.test dex.sdp.test trino.sdp.test idp.corp.test)

current="$(kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}')"
if printf '%s' "$current" | grep -q 'sdp.test'; then
  echo "CoreDNS rewrites already present; skipping."
  exit 0
fi

rules=""
for n in "${NAMES[@]}"; do
  rules+="    rewrite name ${n} ${TARGET}"$'\n'
done

# Insert the rewrite rules right after the `.:53 {` server-block opening line.
new="$(printf '%s' "$current" | awk -v rules="$rules" '
  /^\.:53 \{/ && !done { print; printf "%s", rules; done=1; next }
  { print }
')"

kubectl -n kube-system create configmap coredns \
  --from-literal=Corefile="$new" --dry-run=client -o yaml | kubectl apply -f -

kubectl -n kube-system rollout restart deployment coredns
kubectl -n kube-system rollout status deployment coredns --timeout=90s
echo "CoreDNS rewrites applied for: ${NAMES[*]}"
