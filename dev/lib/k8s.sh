# shellcheck shell=bash
k8s::node_ip() {
  local ip
  ip=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
  if [ -z "$ip" ]; then
    log::error "Could not detect kind node IP."
  fi
  echo "$ip"
}

k8s::wait_for_deployment() {
  local name=$1 timeout=${2:-120}
  kubectl wait --for=condition=available "deployment/$name" --timeout="${timeout}s"
}

k8s::wait_for_statefulset() {
  local name=$1 timeout=${2:-300}
  kubectl rollout status "statefulset/$name" --timeout="${timeout}s"
}

k8s::wait_for_pod() {
  local label=$1 timeout=${2:-60}
  kubectl wait --for=condition=ready pod -l "$label" --timeout="${timeout}s"
}

k8s::get_pod_name() {
  local label=$1
  kubectl get pod -l "$label" -o jsonpath='{.items[0].metadata.name}'
}

k8s::get_node_port() {
  local service=$1
  kubectl get svc "$service" -o jsonpath='{.spec.ports[0].nodePort}'
}

k8s::template_and_apply() {
  local file=$1
  shift
  local sed_exprs=()
  for pair in "$@"; do
    local key="${pair%%=*}" val="${pair#*=}"
    sed_exprs+=(-e "s/\${${key}}/${val}/g")
  done
  sed "${sed_exprs[@]}" "$file" | kubectl apply -f -
}
