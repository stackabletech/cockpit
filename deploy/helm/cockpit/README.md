# Cockpit Helm Chart

This Helm chart deploys the Stackable Data Platform (SDP) Cockpit UI on Kubernetes.

## Requirements

- A Kubernetes cluster
- [Helm](https://helm.sh/docs/intro/install/) installed

## Installing the Chart

### Basic Installation

```bash
helm install cockpit ./deploy/helm/cockpit
```

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

### Feature Parameters

All feature parameters are optional. Omit them to use the application defaults.

| Parameter | Description | Default |
| --- | --- | --- |
| `features.trino.completion.enabled` | Enable SQL code completion. | `true` (application default) |
| `features.storage.enabled` | Show the S3/HDFS file browser and enable routes under `/storage`. | `false` (application default) |
| `features.storage.autoConnect` | Reconnect to the most recently used storage connection when visiting the storage page. | `false` (application default) |
| `features.storage.pageSizes` | Comma-separated page size options. | `25,50,100` (application default) |
| `features.storage.defaultPageSize` | Default page size; must be included in `pageSizes`. | First configured page size (application default) |
| `features.storage.maxRecentFiles` | Number of recently visited storage locations retained locally. | `15` (application default) |
| `features.storage.uploadConcurrency` | Maximum parallel requests for file uploads. | `3` (application default) |
| `features.storage.textPreviewBytes` | Maximum bytes fetched for text, CSV, and JSON previews. | `262144` (application default) |
| `features.storage.imagePreviewBytes` | Maximum bytes fetched for image previews. | `5242880` (application default) |
| `features.storage.pdfPreviewBytes` | Maximum bytes fetched for PDF previews. | `26214400` (application default) |
| `features.storage.filePreviewRows` | Maximum rows in tabular file previews. | `250` (application default) |
| `features.storage.filePreviewColumns` | Maximum columns in tabular file previews. | `50` (application default) |

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
| `trino.userImpersonation.enabled` | Forward the logged-in user to Trino as `X-Trino-User`. When `false`, all queries run as `trino.auth.username` (no per-user authorization/audit in Trino). | `true` |
| `trino.userImpersonation.userClaim` | OIDC claim used as the Trino user. Only consumed when impersonation is enabled and OIDC is configured. | `preferred_username` |
| `trino.auth.type` | `"none"` or `"basic"`. | `""` |
| `trino.auth.username` | Username for basic auth. | `""` |
| `trino.auth.password.secretKeyRef.name` | Name of the Secret holding the Trino password. Required when `type=basic`. | `""` |
| `trino.auth.password.secretKeyRef.key` | Key inside the Secret. | `trino-auth-password` |
| `trino.tls.insecure` | Skip TLS certificate verification. | `false` |
| `trino.tls.caCert` | Path to a custom CA certificate file. | `""` |
| `trino.tls.secretClass` | Stackable SecretClass that provides the Trino CA certificate. | `""` |
| `trino.queryTtl` | Query result TTL in seconds. | `1800` (application default) |

### Security Parameters

| Parameter | Description | Default |
| --- | --- | --- |
| `sessionSecret.secretKeyRef.name` | Name of a Secret holding a stable session secret. Auto-generated if empty. | `""` |
| `sessionSecret.secretKeyRef.key` | Key inside the Secret. | `session-secret` |
| `podSecurityContext` | Pod security context | See values.yaml |
| `securityContext` | Container security context | See values.yaml |

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
