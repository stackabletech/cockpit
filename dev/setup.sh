#!/usr/bin/env bash
# Sets up the local HTTPS Cockpit and Garage environment on a Kubernetes cluster.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CERT_DIR="$(mktemp -d)"
GARAGE_PORT_FORWARD_PID=""

cleanup() {
  if [[ -n "$GARAGE_PORT_FORWARD_PID" ]]; then
    kill "$GARAGE_PORT_FORWARD_PID" 2>/dev/null || true
    wait "$GARAGE_PORT_FORWARD_PID" 2>/dev/null || true
  fi
  rm -rf "$CERT_DIR"
}
trap cleanup EXIT

echo "=== Stackable Cockpit local HTTPS setup ==="

echo "Creating a local TLS certificate..."
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 365 \
  -keyout "$CERT_DIR/tls.key" \
  -out "$CERT_DIR/tls.crt" \
  -subj '/CN=cockpit.localhost' \
  -addext 'subjectAltName=DNS:cockpit.localhost,DNS:garage.localhost'
kubectl create secret tls local-dev-tls \
  --cert="$CERT_DIR/tls.crt" \
  --key="$CERT_DIR/tls.key" \
  --dry-run=client \
  -o yaml | kubectl apply -f -

echo "Deploying Garage..."
helm upgrade --install garage "$SCRIPT_DIR/garage" \
  --namespace default \
  --wait \
  --timeout 60s

echo "Initialising Garage S3..."
kubectl port-forward service/garage 3902:3902 >/dev/null 2>&1 &
GARAGE_PORT_FORWARD_PID=$!
for _ in {1..30}; do
  if curl -sf --max-time 2 \
    -H 'Authorization: Bearer stackable-cockpit-e2e-admin-token' \
    'http://127.0.0.1:3902/v2/ListBuckets' >/dev/null; then
    break
  fi
  sleep 1
done

if ! curl -sf --max-time 2 \
  -H 'Authorization: Bearer stackable-cockpit-e2e-admin-token' \
  'http://127.0.0.1:3902/v2/ListBuckets' >/dev/null; then
  echo 'ERROR: Could not reach the Garage admin API.'
  exit 1
fi

GARAGE_ADMIN_TOKEN=stackable-cockpit-e2e-admin-token \
S3_ENDPOINT='https://garage.localhost' \
S3_ACCESS_KEY_ID='E2E00000000000000001' \
S3_SECRET_ACCESS_KEY='stackable-cockpit-local-garage-secret' \
S3_CONFIG_PATH="$PROJECT_DIR/s3-config.json" \
"$SCRIPT_DIR/../e2e/init-garage-s3.sh"

echo "Deploying Cockpit..."
TRAEFIK_CLUSTER_IP=$(kubectl get service traefik --namespace kube-system \
  --output jsonpath='{.spec.clusterIP}')
if [[ -z "$TRAEFIK_CLUSTER_IP" ]]; then
  echo 'ERROR: Could not determine the Traefik service cluster IP.'
  exit 1
fi
docker build "$PROJECT_DIR" -f "$PROJECT_DIR/docker/Dockerfile" -t stackable-cockpit:local
helm upgrade --install cockpit "$PROJECT_DIR/deploy/helm/cockpit" \
  --namespace default \
  --values "$SCRIPT_DIR/helm/values.yaml" \
  --set "hostAliases[0].ip=$TRAEFIK_CLUSTER_IP" \
  --set 'hostAliases[0].hostnames[0]=garage.localhost' \
  --wait \
  --timeout 120s

S3_SECRET_ACCESS_KEY=$(node -e "process.stdout.write(require('$PROJECT_DIR/s3-config.json').awsSecretAccessKey)")

echo ''
echo '=== Setup complete ==='
echo 'Cockpit: https://cockpit.localhost'
echo 'Garage endpoint: https://garage.localhost'
echo 'Garage region: garage'
echo 'Garage access key ID: E2E00000000000000001'
echo "Garage secret access key: $S3_SECRET_ACCESS_KEY"
echo 'Garage bucket: test-bucket'
echo 'Use path-style access, enable TLS, and disable certificate verification for the local certificate.'
