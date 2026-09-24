# shellcheck shell=bash
log::info() {
  echo "  [INFO] $*"
}

log::warn() {
  echo "  [WARN] $*" >&2
}

log::error() {
  echo "  [ERROR] $*" >&2
  exit 1
}

log::ok() {
  echo "  [OK] $*"
}
