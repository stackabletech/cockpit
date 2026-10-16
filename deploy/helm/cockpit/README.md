# Cockpit Helm Chart

This Helm chart deploys the Stackable Data Platform (SDP) Cockpit UI on Kubernetes.

## Requirements

- A Kubernetes cluster
- [Helm](https://helm.sh/docs/intro/install/) installed
- A PostgreSQL database. The chart does not deploy one. See [Database Parameters](#database-parameters).

## Installing the Chart

### Basic Installation

```bash
kubectl create secret generic cockpit-database --from-literal=database-password='<password>'

helm install cockpit ./deploy/helm/cockpit \
  --set database.host=postgresql.example.svc \
  --set database.password.secretKeyRef.name=cockpit-database
```

OIDC is enabled by default, so also set the `auth.oidc.*` values or disable it (see [Authentication Parameters](#authentication-parameters)).

### Installation with Custom Values

```bash
helm install cockpit ./deploy/helm/cockpit \
  --set image.tag=0.0.0-dev
```

### Installation with Values File

```bash
helm install cockpit ./deploy/helm/cockpit \
  -f my-values.yaml
```

### Upgrading

New chart versions can add values. `helm upgrade --reuse-values` doesn't merge their defaults, so templates that read them fail to render. Use `--reset-then-reuse-values` instead.

## Uninstalling the Chart

```bash
helm uninstall cockpit
```

## Configuration

The following table lists the configurable parameters of the Cockpit chart and their default values.

### Global Parameters

| Parameter | Description | Default |
| --- | --- | --- |
| `replicaCount` | Number of replicas | `1` |
| `image.registry` | Container image registry | `oci.stackable.tech` |
| `image.repository` | Container image repository | `sdp/cockpit` |
| `image.pullPolicy` | Image pull policy | `IfNotPresent` |
| `image.tag` | Image tag (overrides appVersion) | `""` |
| `nameOverride` | String to partially override fullname | `""` |
| `fullnameOverride` | String to fully override fullname | `""` |

### Service Parameters

| Parameter | Description | Default |
| --- | --- | --- |
| `service.type` | Kubernetes service type | `ClusterIP` |
| `service.port` | Service port | `3000` |
| `service.targetPort` | Container port | `3000` |
| `service.annotations` | Service annotations | `{}` |

### Ingress Parameters

| Parameter | Description | Default |
| --- | --- | --- |
| `ingress.enabled` | Enable ingress controller resource | `false` |
| `ingress.className` | Ingress class name | `""` |
| `ingress.annotations` | Ingress annotations | `{}` |
| `ingress.hosts` | Ingress hosts configuration | See values.yaml |
| `ingress.tls` | Ingress TLS configuration | `[]` |

### Reverse Proxy Parameters

| Parameter | Description | Default |
| --- | --- | --- |
| `origin` | Public origin for SvelteKit CSRF check. Leave empty when relying on forwarded headers. | `http://localhost:3000` |
| `proxy.protocolHeader` | Trusted forwarded protocol header (e.g. `x-forwarded-proto`). | `""` |
| `proxy.hostHeader` | Trusted forwarded host header (e.g. `x-forwarded-host`). | `""` |

### Application Configuration

| Parameter | Description | Default |
| --- | --- | --- |
| `config.nodeEnv` | Node.js environment | `production` |
| `config.bodySizeLimit` | Sets `BODY_SIZE_LIMIT`, the maximum request body size (e.g. `12M`). Must be at least the editable file size limit (`PUBLIC_STACKABLE_COCKPIT_MAX_EDITABLE_FILE_SIZE`, 5 MiB by default), otherwise saving larger files in the text editor fails. | `""` (image default `6M`) |
| `config.archiveCacheMaxMb` | Sets `STACKABLE_COCKPIT_ARCHIVE_CACHE_MAX_MB`, the maximum total size in MB of the archive preview cache in `/tmp`. Keep it below `tmp.sizeLimit`. | `""` (app default `512`) |
| `tmp.sizeLimit` | Size limit of the `/tmp` emptyDir. The kubelet evicts the pod when it is exceeded. Keep it above `config.archiveCacheMaxMb`. Empty means no limit. | `1Gi` |

### Database Parameters

Cockpit stores sessions, users and storage connections in PostgreSQL. Migrations run automatically at startup.

| Parameter | Description | Default |
| --- | --- | --- |
| `database.host` | PostgreSQL host. Required. | `""` |
| `database.port` | PostgreSQL port. | `5432` |
| `database.name` | Database name. | `cockpit` |
| `database.user` | Database user. | `cockpit` |
| `database.password.secretKeyRef.name` | Name of the Secret holding the database password. Required. | `""` |
| `database.password.secretKeyRef.key` | Key inside the Secret. | `database-password` |
| `database.tls.mode` | `verify-full` (verify certificate and host name), `require` (encrypt without verification) or `disable`. | `""` (application default: `verify-full` when `config.nodeEnv` is `production`, otherwise `disable`) |
| `database.tls.caCert` | Path to a CA certificate file inside the container, e.g. mounted via `extraVolumes`. Requires mode `verify-full`. Mutually exclusive with `secretClass`. | `""` |
| `database.tls.secretClass` | Stackable SecretClass that provides the database CA certificate. Requires mode `verify-full`. Mutually exclusive with `caCert`. | `""` |

### Feature Parameters

All feature parameters are optional. Omit them to use the application defaults.

| Parameter | Description | Default |
| --- | --- | --- |
| `features.trino.completion.enabled` | Enable SQL code completion. | `true` (application default) |
| `features.storage.enabled` | Show the S3/HDFS file browser and enable routes under `/storage`. | `false` (application default) |
| `features.storage.pageSizes` | Comma-separated page size options. | `25,50,100` (application default) |
| `features.storage.defaultPageSize` | Default page size; must be included in `pageSizes`. | First configured page size (application default) |
| `features.storage.maxRecentFiles` | Number of recently visited storage locations retained locally. | `15` (application default) |
| `features.storage.uploadConcurrency` | Maximum parallel requests for file uploads. | `3` (application default) |
| `features.storage.textPreviewBytes` | Maximum bytes fetched for text, TSV, and JSON previews. Editable text files (text types except CSV/TSV, up to the editable file size limit) are always fetched completely. | `262144` (application default) |
| `features.storage.imagePreviewBytes` | Maximum bytes fetched for image previews. | `5242880` (application default) |
| `features.storage.pdfPreviewBytes` | Maximum bytes fetched for PDF previews. | `26214400` (application default) |
| `features.storage.filePreviewRows` | Maximum rows in tabular file previews. | `250` (application default) |
| `features.storage.filePreviewColumns` | Maximum columns in tabular file previews. | `50` (application default) |
| `features.storage.transferConcurrency` | Objects copied at once within one copy, move or rename request. | `8` (application default) |
| `features.storage.restoreTabs` | Restore open file browser tabs from the last session. | `false` (application default) |
| `features.storage.infiniteScroll` | Load CSV and Parquet preview rows lazily while scrolling. | `true` (application default) |
| `features.storage.cutCopy` | Show Cut/Copy and allow dragging items. Client-only: the server work happens on paste or move. | `false` (application default) |
| `features.storage.paste` | Show Paste. The transfer API accepts copies only when this is enabled, and moves when this or `move` is enabled. | `false` (application default) |
| `features.storage.rename` | Show Rename. The transfer API only accepts renames when this is enabled. | `false` (application default) |
| `features.storage.move` | Allow drag-and-drop move. Dragging also needs `cutCopy`. The transfer API accepts moves when this or `paste` is enabled. | `false` (application default) |
| `features.storage.maxEditableFileSize` | Maximum size in bytes of files that can be edited and saved in the text editor. `config.bodySizeLimit` must be at least this large. | `5242880` (application default) |
| `features.storage.archivePreviewMaxMb` | Maximum size in MB of an archive opened for preview, checked against its compressed size, the total size of the listed entries and the size of an extracted entry. The archive cache is raised to at least twice this value, so keep `tmp.sizeLimit` above that. | `100` (application default) |
| `features.storage.parquetPreviewDisallowedCompressionTypes` | Comma-separated Parquet compression codecs that are not previewed. A `-no_offset` suffix (e.g. `gzip-no_offset`) only blocks files without an offset index. | `gzip-no_offset` (application default) |
| `features.storage.downloadHistoryRetentionDays` | Days a user's download history is kept. Integer from 1 to 3650. | `30` (application default) |

### Authentication Parameters

OIDC is the only supported auth mechanism. Disable for local testing.

| Parameter | Description | Default |
| --- | --- | --- |
| `auth.baseUrl` | Publicly accessible base URL of the app (used for OIDC callbacks). | `http://localhost:3000` |
| `auth.oidc.enabled` | Enable OIDC authentication. Disable to deploy without auth. | `true` |
| `auth.oidc.discoveryUrl` | OIDC `.well-known/openid-configuration` URL. Required when enabled. | `""` |
| `auth.oidc.clientId` | OIDC client ID. Required when enabled. | `""` |
| `auth.oidc.clientSecret.secretKeyRef.name` | Name of the Secret holding the OIDC client secret. Required when enabled. | `""` |
| `auth.oidc.clientSecret.secretKeyRef.key` | Key inside the Secret. | `oidc-client-secret` |
| `auth.oidc.extraScopes` | List of extra OIDC scopes to request in addition to `openid profile email`. Set when the claim to use as identifier in Trino is only released under a custom scope. | `[]` |

### Trino Connection Parameters

Optional pre-configured Trino endpoint. When `trino.url` is set, the in-app connection form is hidden.

| Parameter | Description | Default |
| --- | --- | --- |
| `trino.url` | Trino coordinator URL. | `""` |
| `trino.publicUrl` | Browser-facing URL for "View in Trino" deep links. Defaults to `trino.url`. | `""` |
| `trino.userImpersonation.enabled` | Forward the logged-in user to Trino as `X-Trino-User`. When `false`, all queries run as `trino.auth.username` (no per-user authorization/audit in Trino). | `true` |
| `trino.userImpersonation.userClaim` | OIDC claim used as the Trino user. Only consumed when impersonation is enabled and OIDC is configured. | `preferred_username` |
| `trino.auth.type` | `"none"` or `"basic"`. | `""` |
| `trino.auth.username` | Username for basic auth. | `""` |
| `trino.auth.password.secretKeyRef.name` | Name of the Secret holding the Trino password. Required when `type=basic`. | `""` |
| `trino.auth.password.secretKeyRef.key` | Key inside the Secret. | `trino-auth-password` |
| `trino.tls.insecure` | Skip TLS certificate verification. Cannot be combined with `caCert` or `secretClass`. | `false` |
| `trino.tls.caCert` | Path to a CA certificate file inside the container, e.g. mounted via `extraVolumes`. Mutually exclusive with `secretClass`. | `""` |
| `trino.tls.secretClass` | Stackable SecretClass that provides the Trino CA certificate. Mutually exclusive with `caCert`. | `""` |
| `trino.queryTtl` | Query result TTL in seconds. | `1800` (application default) |

### Security Parameters

| Parameter | Description | Default |
| --- | --- | --- |
| `sessionSecret.secretKeyRef.name` | Name of a Secret holding a stable session secret. Auto-generated if empty. | `""` |
| `sessionSecret.secretKeyRef.key` | Key inside the Secret. | `session-secret` |
| `storage.encryptionKey.secretKeyRef.name` | Name of the Secret holding the key that encrypts stored storage connection credentials: 64 hex characters, e.g. from `openssl rand -hex 32`. Required when `features.storage.enabled` is `true`. Keep it stable: changing or losing it makes all stored credentials unreadable. | `""` |
| `storage.encryptionKey.secretKeyRef.key` | Key inside the Secret. | `storage-encryption-key` |
| `storage.tls.caCert` | Path to a CA certificate file inside the container for S3 connections with TLS verification, e.g. mounted via `extraVolumes`. Mutually exclusive with `secretClass`. | `""` |
| `storage.tls.secretClass` | Stackable SecretClass that provides the CA certificate for S3 connections with TLS verification. Mutually exclusive with `caCert`. | `""` |
| `podSecurityContext` | Pod security context | See values.yaml |
| `securityContext` | Container security context | See values.yaml |

A configured CA certificate (`caCert` or `secretClass`) replaces the system trust store for that connection. For `storage.tls`, this applies to every S3 connection that verifies certificates, so connections to S3 endpoints with publicly trusted certificates (for example AWS) fail while it is set. The chart refuses to render contradictory TLS settings, for example a CA together with `trino.tls.insecure` or a database mode that doesn't verify certificates.

### Volume Parameters

| Parameter | Description | Default |
| --- | --- | --- |
| `extraVolumes` | Additional pod volumes, e.g. a Secret holding a CA certificate for `trino.tls.caCert`, `database.tls.caCert` or `storage.tls.caCert`. | `[]` |
| `extraVolumeMounts` | Additional volume mounts for the Cockpit container. | `[]` |

### Resource Parameters

| Parameter | Description | Default |
| --- | --- | --- |
| `resources.limits.cpu` | CPU limit | `500m` |
| `resources.limits.memory` | Memory limit | `512Mi` |
| `resources.requests.cpu` | CPU request | `100m` |
| `resources.requests.memory` | Memory request | `128Mi` |

### Service Account Parameters

| Parameter | Description | Default |
| --- | --- | --- |
| `serviceAccount.create` | Create a service account | `true` |
| `serviceAccount.automount` | Automount service account token | `true` |
| `serviceAccount.annotations` | Service account annotations | `{}` |
| `serviceAccount.name` | Service account name | `""` (generated) |

## Support

For issues and questions:

- GitHub: <https://github.com/stackabletech/cockpit/issues>
- Documentation: <https://docs.stackable.tech/>
- Email: <info@stackable.tech>
