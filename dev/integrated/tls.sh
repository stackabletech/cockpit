#!/usr/bin/env bash
# Layer 1 TLS for the integrated Cockpit PoC.
#
# Produces one wildcard cert covering the SDP platform domain and the stand-in
# "customer IdP" domain, and loads it into the kind cluster so ingress-nginx can
# terminate TLS for:
#   cockpit.sdp.test  dex.sdp.test  trino.sdp.test   (SDP platform, same-site)
#   idp.corp.test                                    (Keycloak = customer IdP, cross-site)
#
# Two modes:
#   * mkcert present  -> cert is trusted by your browsers (mkcert -install). Use this for the
#                        real same-site/browser verification. RUN ON THE HOST (touches trust store).
#   * mkcert absent   -> openssl self-signed CA fallback. Functional for server-to-server flows
#                        (Trino->Dex->Keycloak) but NOT browser-trusted. Fine for building/testing.
#
# Safe to re-run. Prints an /etc/hosts line for you to add with sudo.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="$SCRIPT_DIR/certs"
NS="default"
HOSTS=(cockpit.sdp.test dex.sdp.test trino.sdp.test idp.corp.test)
mkdir -p "$CERT_DIR"

if command -v mkcert >/dev/null 2>&1; then
  echo "==> mkcert found: generating a browser-trusted cert"
  mkcert -install
  mkcert -cert-file "$CERT_DIR/sdp.crt" -key-file "$CERT_DIR/sdp.key" \
    "*.sdp.test" "sdp.test" "*.corp.test" "corp.test"
  # Stage the mkcert CA into certs/ so downstream (sdp-ca configmap AND the Trino SecretClass
  # keypair in up.sh) reference one consistent path regardless of mkcert vs openssl.
  cp "$(mkcert -CAROOT)/rootCA.pem" "$CERT_DIR/rootCA.pem"
  cp "$(mkcert -CAROOT)/rootCA-key.pem" "$CERT_DIR/rootCA.key"
  CA_FILE="$CERT_DIR/rootCA.pem"
  TRUST="browser-trusted (mkcert)"
else
  echo "==> mkcert NOT found: openssl self-signed fallback (server-side only, not browser-trusted)"
  echo "    For browser verification, install mkcert (+ libnss3-tools) and re-run."
  if [ ! -f "$CERT_DIR/rootCA.pem" ]; then
    openssl genrsa -out "$CERT_DIR/rootCA.key" 2048
    openssl req -x509 -new -nodes -key "$CERT_DIR/rootCA.key" -sha256 -days 825 \
      -subj "/CN=SDP PoC local CA" \
      -addext "basicConstraints=critical,CA:TRUE" \
      -addext "keyUsage=critical,keyCertSign,cRLSign" \
      -out "$CERT_DIR/rootCA.pem"
  fi
  openssl genrsa -out "$CERT_DIR/sdp.key" 2048
  openssl req -new -key "$CERT_DIR/sdp.key" -subj "/CN=*.sdp.test" -out "$CERT_DIR/sdp.csr"
  openssl x509 -req -in "$CERT_DIR/sdp.csr" \
    -CA "$CERT_DIR/rootCA.pem" -CAkey "$CERT_DIR/rootCA.key" -CAcreateserial \
    -days 825 -sha256 \
    -extfile <(printf 'subjectAltName=DNS:*.sdp.test,DNS:sdp.test,DNS:*.corp.test,DNS:corp.test\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n') \
    -out "$CERT_DIR/sdp.crt"
  CA_FILE="$CERT_DIR/rootCA.pem"
  TRUST="self-signed (openssl) — NOT browser-trusted"
fi

echo "==> loading cert into the cluster as secret/${NS}/sdp-wildcard-tls  [${TRUST}]"
kubectl create secret tls sdp-wildcard-tls \
  --cert="$CERT_DIR/sdp.crt" --key="$CERT_DIR/sdp.key" \
  -n "$NS" --dry-run=client -o yaml | kubectl apply -f -

echo "==> publishing the CA as configmap/${NS}/sdp-ca (in-cluster TLS trust: Trino->Dex, Dex->Keycloak)"
kubectl create configmap sdp-ca \
  --from-file=ca.crt="$CA_FILE" \
  -n "$NS" --dry-run=client -o yaml | kubectl apply -f -

cat <<EOF

Done — cert loaded (${TRUST}).

Host step (needs sudo), add to /etc/hosts so browser + host tools resolve to the local ingress:

    127.0.0.1 ${HOSTS[*]}

EOF
