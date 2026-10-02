# shellcheck shell=bash
secret::create() {
  log::info "Creating stackable-cockpit-credentials Secret..."
  kubectl delete secret stackable-cockpit-credentials --ignore-not-found
  kubectl create secret generic stackable-cockpit-credentials \
    --from-literal=oidc-client-secret="$OIDC_CLIENT_SECRET" \
    --from-literal=trino-auth-password=stackable-cockpit-dev
}
