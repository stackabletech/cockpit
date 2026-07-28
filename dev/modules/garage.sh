# shellcheck shell=bash
garage::deploy() {
  [[ "$SKIP_GARAGE" == true ]] && return 0

  log::info "Deploying Garage S3..."
  helm upgrade --install garage "$SCRIPT_DIR/garage" \
    --namespace default \
    --wait \
    --timeout 60s
}

garage::init() {
  [[ "$SKIP_GARAGE" == true ]] && return 0

  log::info "Initialising Garage S3..."

  local garage_admin_port=30902 garage_s3_port=30900
  local garage_base_url

  if ! garage_base_url=$(probe::url "$garage_admin_port" /v2/ListBuckets http 60 \
    -H "Authorization: Bearer stackable-cockpit-e2e-admin-token"); then
    log::error "Could not reach Garage admin API via NodePort ${garage_admin_port} within 60s."
  fi

  local garage_host
  garage_host=$(echo "$garage_base_url" | sed 's|http://||; s|:[0-9]*$||')
  GARAGE_S3_URL="http://${garage_host}:${garage_s3_port}"
  GARAGE_ADMIN_URL="$garage_base_url"

  S3_SECRET_ACCESS_KEY=$(openssl rand -hex 32) \
    GARAGE_ADMIN_TOKEN=stackable-cockpit-e2e-admin-token \
    S3_ENDPOINT="$GARAGE_S3_URL" \
    GARAGE_ADMIN_URL="$GARAGE_ADMIN_URL" \
    S3_CONFIG_PATH="$PROJECT_DIR/s3-config.json" \
    "$SCRIPT_DIR/../e2e/init-garage-s3.sh"

  log::info "Wrote s3-config.json (S3 endpoint: ${GARAGE_S3_URL})"
}
