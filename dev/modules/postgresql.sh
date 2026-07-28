# shellcheck shell=bash
postgresql::deploy() {
  [[ "$SKIP_POSTGRESQL" == true ]] && return 0

  log::info "Deploying PostgreSQL 18..."
  helm upgrade --install postgresql "$SCRIPT_DIR/postgresql" \
    --namespace default \
    --wait \
    --timeout 60s
}

postgresql::migrate() {
  [[ "$SKIP_POSTGRESQL" == true ]] && return 0

  log::info "Waiting for PostgreSQL to be ready..."
  k8s::wait_for_pod app=postgresql 60

  log::info "Running database migrations..."
  (
    cd "$PROJECT_DIR" &&
    DATABASE_HOST=localhost \
      DATABASE_PORT=31432 \
      DATABASE_NAME=cockpit \
      DATABASE_USER=cockpit \
      DATABASE_PASSWORD=cockpit-dev-password \
      npx tsx src/lib/server/migrate.ts
  )
}
