# shellcheck shell=bash
probe::url() {
  local port=$1 path=$2
  local scheme=${3:-http}
  local timeout=${4:-120}
  shift 4

  local deadline url candidate
  deadline=$(( $(date +%s) + timeout ))
  url=""
  while [ -z "$url" ] && [ "$(date +%s)" -lt "$deadline" ]; do
    for candidate in "${scheme}://${NODE_IP}:${port}" "${scheme}://127.0.0.1:${port}" "${scheme}://localhost:${port}"; do
      if curl -sf --max-time 2 "$@" "${candidate}${path}" >/dev/null 2>&1; then
        url="$candidate"
        break
      fi
    done
    [ -z "$url" ] && sleep 2
  done

  if [ -z "$url" ]; then
    return 1
  fi
  echo "$url"
}
