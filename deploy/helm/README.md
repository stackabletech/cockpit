# Stackable UI Helm Chart

This Helm chart deploys the Stackable Unified Data Platform UI on Kubernetes.

## Requirements

- A Kubernetes cluster
- [Helm](https://helm.sh/docs/intro/install/) installed

## Installing the Chart

### Basic Installation

```bash
helm install stackable-ui ./deploy/helm
```

### Installation with Custom Values

```bash
helm install stackable-ui ./deploy/helm \
  --set image.tag=0.0.0-dev
```

### Installation with Values File

```bash
helm install stackable-ui ./deploy/helm \
  -f my-values.yaml
```

## Uninstalling the Chart

```bash
helm uninstall stackable-ui
```

## Configuration

The following table lists the configurable parameters of the Stackable UI chart and their default values.

### Global Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Number of replicas | `1` |
| `image.registry` | Container image registry | `oci.stackable.tech` |
| `image.repository` | Container image repository | `sdp/stackable-ui` |
| `image.pullPolicy` | Image pull policy | `IfNotPresent` |
| `image.tag` | Image tag (overrides appVersion) | `""` |
| `nameOverride` | String to partially override fullname | `""` |
| `fullnameOverride` | String to fully override fullname | `""` |

### Service Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `service.type` | Kubernetes service type | `ClusterIP` |
| `service.port` | Service port | `3000` |
| `service.targetPort` | Container port | `3000` |
| `service.annotations` | Service annotations | `{}` |

### Ingress Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `ingress.enabled` | Enable ingress controller resource | `false` |
| `ingress.className` | Ingress class name | `""` |
| `ingress.annotations` | Ingress annotations | `{}` |
| `ingress.hosts` | Ingress hosts configuration | See values.yaml |
| `ingress.tls` | Ingress TLS configuration | `[]` |

### Application Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `config.nodeEnv` | Node.js environment | `production` |

### Security Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sessionSecret` | Session secret for signing cookies | `""` (auto-generated) |
| `podSecurityContext` | Pod security context | See values.yaml |
| `securityContext` | Container security context | See values.yaml |

### Resource Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `resources.limits.cpu` | CPU limit | `500m` |
| `resources.limits.memory` | Memory limit | `512Mi` |
| `resources.requests.cpu` | CPU request | `100m` |
| `resources.requests.memory` | Memory request | `128Mi` |

### Service Account Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `serviceAccount.create` | Create a service account | `true` |
| `serviceAccount.automount` | Automount service account token | `true` |
| `serviceAccount.annotations` | Service account annotations | `{}` |
| `serviceAccount.name` | Service account name | `""` (generated) |

## Support

For issues and questions:
- GitHub: https://github.com/stackabletech/stackable-ui/issues
- Documentation: https://docs.stackable.tech/
- Email: info@stackable.tech
