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

probe::tcp_host() {
  local port=$1 timeout=${2:-60}
  local deadline host
  deadline=$(( $(date +%s) + timeout ))

  while [ "$(date +%s)" -lt "$deadline" ]; do
    for host in "$NODE_IP" 127.0.0.1 localhost; do
      if timeout 2 bash -c "</dev/tcp/$host/$port" >/dev/null 2>&1; then
        echo "$host"
        return 0
      fi
    done
    sleep 2
  done

  return 1
}
