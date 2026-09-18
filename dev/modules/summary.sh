# shellcheck shell=bash
summary::print() {
  echo ""
  log::ok "Setup complete"
  echo ""
  echo "Start the dev server with:  npm run dev"
  echo ""
  echo "Keycloak:       http://${NODE_IP}:30080"
  echo "  Admin:        admin / admin"
  echo ""
  if [[ "$SKIP_TRINO" == false ]]; then
    echo "Trino endpoint: https://${NODE_IP}:${TRINO_PORT}"
    echo ""
    echo "Trino connection is pre-configured via STACKABLE_COCKPIT_TRINO_* env vars."
    echo ""
  else
    echo "Trino was skipped. Add STACKABLE_COCKPIT_TRINO_* vars to $ENV_FILE manually when ready."
    echo ""
  fi
  if [[ "$SKIP_GARAGE" == false ]]; then
    echo "Garage S3:      http://${NODE_IP}:30900  (admin: http://${NODE_IP}:30902)"
    echo "  Credentials written to s3-config.json for E2E tests."
    echo ""
  fi
  if [[ "$SKIP_POSTGRESQL" == false ]]; then
    echo "PostgreSQL:     localhost:31432"
    echo "  Database:     cockpit"
    echo "  User:         cockpit"
    echo "  Password:     cockpit-dev-password"
    echo "  Environment:  DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD"
    echo ""
  fi
  echo "Test users (OIDC):"
  echo "  alice / alicealice"
  echo "  bob   / bobbob"
}
