#!/usr/bin/env bash
# Sets up the full local dev environment on a kind cluster.
# Assumes: kind cluster is running, kubectl context points to it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env.development"
export ENV_FILE

# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/logging.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/k8s.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/probe.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/modules/prerequisites.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/modules/keycloak.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/modules/trino.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/modules/garage.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/modules/postgresql.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/modules/env.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/modules/secret.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/modules/summary.sh"

SKIP_TRINO=false; SKIP_GARAGE=false; SKIP_POSTGRESQL=false
for arg in "$@"; do
  case "$arg" in
    --skip-trino) SKIP_TRINO=true ;;
    --skip-garage) SKIP_GARAGE=true ;;
    --skip-postgresql) SKIP_POSTGRESQL=true ;;
    *) echo "Unknown argument: $arg"; echo "Usage: $0 [--skip-trino] [--skip-garage] [--skip-postgresql]"; exit 1 ;;
  esac
done
export SKIP_TRINO SKIP_GARAGE SKIP_POSTGRESQL

log::info "Stackable Cockpit dev environment setup"
[[ "$SKIP_TRINO" == true ]] && echo "  (Trino deployment skipped)"
[[ "$SKIP_GARAGE" == true ]] && echo "  (Garage deployment skipped)"
[[ "$SKIP_POSTGRESQL" == true ]] && echo "  (PostgreSQL deployment skipped)"
echo ""

# ── Phase 1: Bootstrap ──
prerequisites::run
NODE_IP=$(k8s::node_ip)
export NODE_IP

# ── Phase 2: Deploy services ──
keycloak::deploy
trino::deploy
garage::deploy
postgresql::deploy

# ── Phase 3: Configure services ──
keycloak::configure
garage::init
postgresql::migrate
trino::probe

# ── Phase 4: Finalise ──
env::write
secret::create
trino::wait_for_ready
trino::forward
summary::print
