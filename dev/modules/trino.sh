# shellcheck shell=bash
trino::deploy() {
  [[ "$SKIP_TRINO" == true ]] && return 0

  log::info "Deploying Trino..."
  k8s::template_and_apply "$SCRIPT_DIR/trino.yaml" "NODE_IP=$NODE_IP"
}

trino::probe() {
  [[ "$SKIP_TRINO" == true ]] && return 0

  TRINO_PORT=$(k8s::get_node_port trino-coordinator)
  export TRINO_BASE_URL=https://localhost:8081
}

trino::wait_for_ready() {
  [[ "$SKIP_TRINO" == true ]] && return 0

  log::info "Waiting for Trino to be ready..."
  k8s::wait_for_statefulset trino-coordinator-default 300
  log::info "Trino endpoint: https://${NODE_IP}:${TRINO_PORT}"
}

trino::forward() {
  [[ "$SKIP_TRINO" == true ]] && return 0

  local pid_file="$PROJECT_DIR/.trino-port-forward.pid"
  local log_file="$PROJECT_DIR/.trino-port-forward.log"
  local pid attempt

  if [[ -f "$pid_file" ]] && kill -0 "$(<"$pid_file")" 2>/dev/null; then
    if curl -skf --max-time 2 https://127.0.0.1:8081/v1/info >/dev/null; then
      log::info "Trino port-forward is already running on https://localhost:8081"
      return 0
    fi
    kill "$(<"$pid_file")" 2>/dev/null || true
  fi

  rm -f "$pid_file"
  log::info "Forwarding https://localhost:8081 to Trino..."
  nohup kubectl port-forward --namespace default --address 127.0.0.1 service/trino-coordinator 8081:8443 >"$log_file" 2>&1 &
  pid=$!
  printf '%s\n' "$pid" >"$pid_file"

  for ((attempt = 0; attempt < 30; attempt++)); do
    if curl -skf --max-time 2 https://127.0.0.1:8081/v1/info >/dev/null; then
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      cat "$log_file" >&2
      rm -f "$pid_file"
      log::error "Trino port-forward failed to start."
    fi
    sleep 1
  done

  kill "$pid" 2>/dev/null || true
  rm -f "$pid_file"
  log::error "Timed out waiting for Trino on https://localhost:8081."
}
