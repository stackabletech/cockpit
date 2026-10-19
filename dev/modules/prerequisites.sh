# shellcheck shell=bash
prerequisites::run() {
  log::info "Installing npm dependencies..."
  (cd "$PROJECT_DIR" && npm install)

  if [[ "$SKIP_TRINO" == true ]]; then
    log::info "Installing Stackable operators (commons, listener, secret)..."
    stackablectl operator install commons listener secret
  else
    log::info "Installing Stackable operators (commons, listener, secret, trino)..."
    stackablectl operator install commons listener secret trino
  fi
}
