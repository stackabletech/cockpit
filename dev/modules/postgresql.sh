# shellcheck shell=bash
postgresql::deploy() {
  [[ "$SKIP_POSTGRESQL" == true ]] && return 0

  log::info "Deploying PostgreSQL 18..."
  helm upgrade --install postgresql "$SCRIPT_DIR/postgresql" \
    --namespace default \
    --wait \
    --timeout 60s

  # Helm does not recreate an unchanged workload deleted outside Helm.
  # Applying the rendered chart restores it on subsequent development setup runs.
  helm template postgresql "$SCRIPT_DIR/postgresql" \
    --namespace default | kubectl apply -f -
}

postgresql::migrate() {
  [[ "$SKIP_POSTGRESQL" == true ]] && return 0

  log::info "Waiting for PostgreSQL to be ready..."
  k8s::wait_for_pod app=postgresql 60

  local postgresql_host
  if ! postgresql_host=$(probe::tcp_host 31432 60); then
    log::error "Could not reach PostgreSQL via NodePort 31432 within 60s."
  fi
  export POSTGRESQL_HOST="$postgresql_host"

  log::info "Running database migrations..."
  (
    cd "$PROJECT_DIR" &&
    DATABASE_HOST="$POSTGRESQL_HOST" \
      DATABASE_PORT=31432 \
      DATABASE_NAME=cockpit \
      DATABASE_USER=cockpit \
      DATABASE_PASSWORD=cockpit-dev-password \
      npx tsx src/lib/server/migrate.ts
  )
}
