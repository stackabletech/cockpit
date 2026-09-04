# shellcheck shell=bash
prerequisites::run() {
  if [ ! -d "$PROJECT_DIR/node_modules" ]; then
    log::info "Installing npm dependencies..."
    (cd "$PROJECT_DIR" && npm install)
  else
    log::info "npm dependencies already installed, skipping."
  fi

  if [[ "$SKIP_TRINO" == true ]]; then
    log::info "Installing Stackable operators (commons, listener, secret)..."
    stackablectl operator install commons listener secret
  else
    log::info "Installing Stackable operators (commons, listener, secret, trino)..."
    stackablectl operator install commons listener secret trino
  fi
}
