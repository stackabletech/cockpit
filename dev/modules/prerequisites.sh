# shellcheck shell=bash
prerequisites::run() {
  if [ ! -d "$PROJECT_DIR/node_modules" ]; then
    log::info "Installing npm dependencies..."
    (cd "$PROJECT_DIR" && npm install)
  else
    log::info "npm dependencies already installed, skipping."
  fi

  local operators=(commons listener secret)
  [[ "$SKIP_TRINO" == true ]] || operators+=(trino)
  [[ "$SKIP_HDFS" == true ]] || operators+=(zookeeper hdfs)
  log::info "Installing Stackable operators (${operators[*]})..."
  stackablectl operator install "${operators[@]}"
}
