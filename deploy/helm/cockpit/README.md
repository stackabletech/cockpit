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

### Airflow Embed Proxy Parameters

Enable `airflowEmbedProxy` to run an nginx sidecar in front of Cockpit, Airflow, and Keycloak. It exposes all three applications on the Cockpit public origin: Cockpit at `/`, Airflow at `/airflow/`, and Keycloak at `/keycloak/`. This makes the Keycloak login same-origin with the Airflow iframe, which satisfies Keycloak's frame policy and allows its session cookies to work without third-party cookie exceptions.

Cockpit must be published over HTTPS. Configure Airflow with its public base URL as `https://<cockpit-host>/airflow` and enable its proxy-fix support. Configure Keycloak to trust `X-Forwarded-*` headers, set its public hostname to `https://<cockpit-host>/keycloak`, and use `/keycloak` as its HTTP relative path (for example, `KC_PROXY_HEADERS=xforwarded`, `KC_HOSTNAME=https://<cockpit-host>/keycloak`, and `KC_HTTP_RELATIVE_PATH=/keycloak`). nginx preserves the `/airflow` and `/keycloak` paths, rewrites Airflow cookies to `/airflow/`, and retains Keycloak's configured cookie path. Do not append a slash to either upstream URL.

After deployment, create an Airflow bookmark in Cockpit with the URL `https://<cockpit-host>/airflow/` and choose **Open inside Cockpit**.

| Parameter | Description | Default |
| --- | --- | --- |
| `airflowEmbedProxy.enabled` | Enable the nginx same-origin proxy sidecar. | `false` |
| `airflowEmbedProxy.image.repository` | nginx unprivileged image repository. | `nginxinc/nginx-unprivileged` |
| `airflowEmbedProxy.image.tag` | nginx image tag. | `1.29.8-alpine` |
| `airflowEmbedProxy.securityContext.runAsGroup` | Must match `podSecurityContext.runAsGroup` so nginx can write to `/tmp`. | `574654813` |
| `airflowEmbedProxy.airflow.url` | Airflow upstream origin without a trailing slash. Required when enabled. | `""` |
| `airflowEmbedProxy.keycloak.url` | Keycloak upstream origin without a trailing slash. Required when enabled. | `""` |
| `airflowEmbedProxy.keycloak.tls.insecure` | Disable validation of the Keycloak upstream certificate. Test systems only. | `false` |

Example values for the supplied test endpoints:

```yaml
ingress:
  enabled: true
  hosts:
    - host: cockpit.example.test
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: cockpit-tls
      hosts:
        - cockpit.example.test

airflowEmbedProxy:
  enabled: true
  airflow:
    url: http://212.132.78.62:8080
  keycloak:
    url: https://81.173.115.246:30596
    tls:
      insecure: true
```

### Application Configuration

| Parameter | Description | Default |
| --- | --- | --- |
| `config.nodeEnv` | Node.js environment | `production` |

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
| `auth.oidc.usernameClaim` | OIDC claim used as the username for Trino impersonation. | `preferred_username` |

### Trino Connection Parameters

Optional pre-configured Trino endpoint. When `trino.url` is set, the in-app connection form is hidden.

| Parameter | Description | Default |
| --- | --- | --- |
| `trino.url` | Trino coordinator URL. | `""` |
| `trino.auth.type` | `"none"` or `"basic"`. | `""` |
| `trino.auth.username` | Username for basic auth. | `""` |
| `trino.auth.password.secretKeyRef.name` | Name of the Secret holding the Trino password. Required when `type=basic`. | `""` |
| `trino.auth.password.secretKeyRef.key` | Key inside the Secret. | `trino-auth-password` |
| `trino.tls.insecure` | Skip TLS certificate verification. | `false` |
| `trino.tls.caCert` | Path to a custom CA certificate file. | `""` |
| `trino.tls.secretClass` | Stackable SecretClass that provides the Trino CA certificate. | `""` |

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
