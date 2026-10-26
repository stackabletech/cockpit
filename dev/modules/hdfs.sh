# shellcheck shell=bash
hdfs::deploy() {
  [[ "$SKIP_HDFS" == true ]] && return 0

  log::info "Deploying HDFS (simple auth)..."
  kubectl apply -f "$SCRIPT_DIR/hdfs.yaml"

  log::info "Deploying Kerberos KDC..."
  kubectl apply -f "$SCRIPT_DIR/kdc.yaml"
  k8s::wait_for_statefulset krb5-kdc 300
  hdfs::create_admin_keytab_secret

  log::info "Deploying HDFS (Kerberos + TLS)..."
  kubectl apply -f "$SCRIPT_DIR/hdfs-secure.yaml"
}

# The secret-operator provisions keytabs through kadmin with this admin keytab.
hdfs::create_admin_keytab_secret() {
  kubectl get secret secret-operator-keytab >/dev/null 2>&1 && return 0

  local keytab
  keytab=$(mktemp)
  kubectl exec krb5-kdc-0 -c kdc -- sh -c \
    'KRB5_CONFIG=/stackable/config/krb5.conf kadmin.local ktadd -k /tmp/admin.keytab -norandkey stackable-secret-operator >/dev/null && base64 -w0 /tmp/admin.keytab' |
    base64 -d >"$keytab"
  kubectl create secret generic secret-operator-keytab --from-file=keytab="$keytab"
  rm -f "$keytab"
}

hdfs::wait_for_ready() {
  [[ "$SKIP_HDFS" == true ]] && return 0

  log::info "Waiting for HDFS to be ready..."
  kubectl wait --for=condition=available hdfscluster/hdfs --timeout=600s
  kubectl wait --for=condition=available hdfscluster/hdfs-secure --timeout=600s

  # Home directories for the Keycloak test users, who connect as their SSO username.
  log::info "Creating HDFS home directories for test users..."
  # shellcheck disable=SC2016 # $user expands inside the NameNode pod
  kubectl exec hdfs-namenode-default-0 -c namenode -- bash -c '
    for user in alice bob; do
      hdfs dfs -mkdir -p "/user/$user" && hdfs dfs -chown "$user" "/user/$user"
    done' >/dev/null
  # The secure cluster needs a Kerberos ticket: use the NameNode's own principal.
  # shellcheck disable=SC2016 # variables expand inside the NameNode pod
  kubectl exec hdfs-secure-namenode-default-0 -c namenode -- bash -c '
    export KERBEROS_REALM=CLUSTER.LOCAL KRB5_CONFIG=/stackable/kerberos/krb5.conf KRB5CCNAME=FILE:/tmp/dev-setup-cc
    kinit -kt /stackable/kerberos/keytab "nn/hdfs-secure.default.svc.cluster.local@$KERBEROS_REALM"
    for user in alice bob; do
      hdfs dfs -mkdir -p "/user/$user" && hdfs dfs -chown "$user" "/user/$user"
    done' >/dev/null

  HDFS_NAMENODE_0_PORT=$(k8s::get_node_port listener-hdfs-namenode-default-0)
  HDFS_NAMENODE_1_PORT=$(k8s::get_node_port listener-hdfs-namenode-default-1)
  export HDFS_NAMENODE_0_PORT HDFS_NAMENODE_1_PORT
}
