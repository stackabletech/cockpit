# shellcheck shell=bash
trino::deploy() {
  [[ "$SKIP_TRINO" == true ]] && return 0

  log::info "Deploying Trino..."
  k8s::template_and_apply "$SCRIPT_DIR/trino.yaml" "NODE_IP=$NODE_IP"
}

trino::probe() {
  [[ "$SKIP_TRINO" == true ]] && return 0

  TRINO_PORT=$(k8s::get_node_port trino-coordinator)

  local trino_url
  trino_url=$(probe::url "$TRINO_PORT" /v1/info https 30 -sk || true)
  export TRINO_BASE_URL="${trino_url:-https://${NODE_IP}:${TRINO_PORT}}"
}

trino::wait_for_ready() {
  [[ "$SKIP_TRINO" == true ]] && return 0

  log::info "Waiting for Trino to be ready..."
  k8s::wait_for_statefulset trino-coordinator-default 300
  log::info "Trino endpoint: https://${NODE_IP}:${TRINO_PORT}"
}
