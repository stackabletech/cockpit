# Stackable Unified Data Platform UI

A SvelteKit application serving as the unified platform UI shell for Stackable's data infrastructure.

## Current Status

This repository currently contains an initial app shell only:

- Main layout with sidebar and header
- Theme toggle (light/dark)
- Dashboard placeholder content
- Baseline Playwright smoke tests

Feature implementation for the Trino Query UI will follow the project plan.

## Tech Stack

- **SvelteKit** with Svelte 5 (runes)
- **Tailwind CSS v4** + **DaisyUI**
- **TypeScript**
- **Playwright** for E2E tests

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Development Server

```bash
npm run dev
```

The application will be available at <http://localhost:5173>.

## Development

### Commands

```bash
# Development
npm run dev              # Start dev server (port 5173)

# Building
npm run build            # Build for production
npm run preview          # Preview production build

# Quality Checks
npm run format           # Format all code
npm run check            # Type checking
npm run lint             # Linting

# E2E Tests
npm run test:e2e         # Run all tests

# ANTLR (after updating src/lib/editor/grammar/SqlBase.g4)
npm run generate:antlr   # Regenerate TypeScript lexer/parser from grammar
```

## E2E Testing

End-to-end tests use Playwright.

### Running Tests

```bash
npm run test:e2e
```

Playwright is configured to start the dev server automatically during test runs.

## Deployment

### Kubernetes Deployment with Helm

The application includes a Helm chart for deploying to Kubernetes.

#### Quick Start

```bash
# Install with default values
helm install cockpit ./deploy/helm/cockpit

# Install with custom configuration
helm install cockpit ./deploy/helm/cockpit \
  -f your-values.yaml
```

#### Documentation

For detailed Helm chart documentation, see [deploy/helm/cockpit/README.md](./deploy/helm/cockpit/README.md).

### Docker Deployment

Build and run the Docker image:

```bash
# Build the image
docker build . -f docker/Dockerfile --build-arg TARGETARCH=x86 --build-arg VERSION=0.0.0-dev -t cockpit:0.0.0-dev

# Run the container
docker run -p 3000:3000 cockpit:0.0.0-dev
```

## Configuration

The application is configured via environment variables. Create a `.env` file at the project root (or set these in your deployment environment).

### Feature Flags

| Variable                                    | Type                             | Default | Description                                                                                                                                                             | Example                                          |
| ------------------------------------------- | -------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `STACKABLE_COCKPIT_COMPLETION_ENABLED`      | `boolean` (`"false"` to disable) | `true`  | Enables the SQL editor code-completion provider and the metadata endpoint. Set to `"false"` to fall back to plain syntax highlighting.                                  | `STACKABLE_COCKPIT_COMPLETION_ENABLED=false`     |
| `STACKABLE_COCKPIT_STORAGE_BROWSER_ENABLED` | `boolean` (`"true"` to enable)   | `false` | Shows the S3/HDFS file browser in the sidebar and activates routes under `/storage`. Must be explicitly opted in to expose storage credentials and the file-browser UI. | `STACKABLE_COCKPIT_STORAGE_BROWSER_ENABLED=true` |

### Storage Preview Limits

| Variable                                | Type              | Default             | Description                                                                                | Example                                          |
| --------------------------------------- | ----------------- | ------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `STACKABLE_COCKPIT_TEXT_PREVIEW_BYTES`  | `integer` (bytes) | `262144` (256 KiB)  | Maximum bytes fetched when previewing text, CSV, or JSON files.                            | `STACKABLE_COCKPIT_TEXT_PREVIEW_BYTES=524288`    |
| `STACKABLE_COCKPIT_IMAGE_PREVIEW_BYTES` | `integer` (bytes) | `5242880` (5 MiB)   | Maximum bytes fetched when previewing image files.                                         | `STACKABLE_COCKPIT_IMAGE_PREVIEW_BYTES=10485760` |
| `STACKABLE_COCKPIT_PDF_PREVIEW_BYTES`   | `integer` (bytes) | `26214400` (25 MiB) | Maximum bytes fetched when previewing PDF files.                                           | `STACKABLE_COCKPIT_PDF_PREVIEW_BYTES=52428800`   |
| `STACKABLE_COCKPIT_FILE_PREVIEW_ROWS`   | `integer` (rows)  | `250`               | Maximum number of rows included in a tabular file preview (e.g. Parquet converted to CSV). | `STACKABLE_COCKPIT_FILE_PREVIEW_ROWS=500`        |

### Embedded Airflow

Airflow backed by Keycloak cannot be embedded directly from a different origin: Keycloak deliberately returns `frame-ancestors 'self'` and its login cookies are not usable as third-party cookies. The Helm chart provides an optional nginx sidecar that proxies Cockpit, Airflow, and Keycloak on one HTTPS origin. See the [Airflow Embed Proxy configuration](./deploy/helm/cockpit/README.md#airflow-embed-proxy-parameters) for the required upstream and identity-provider settings.

`./dev/setup.sh` also deploys a local Airflow instance and starts an nginx proxy at `https://localhost:8443`. Start or restart Vite with `npm run dev` after setup so it reads the generated `.env.development`, then open Cockpit through the proxy. Add an Airflow bookmark for `https://localhost:8443/airflow/` and select **Open inside Cockpit**. Sign in to Airflow through Keycloak as `admin` / `adminadmin`.

The setup requires Docker for nginx and creates a localhost certificate in `dev/.proxy/` unless both `DEV_PROXY_CERT_FILE` and `DEV_PROXY_KEY_FILE` name an existing trusted certificate and key. Pass `--skip-airflow` to retain the former direct `http://localhost:5173` workflow without starting the proxy.

To embed a remote HTTP Airflow test instance, route it through the local HTTPS proxy rather than using its `http://` URL in the bookmark. The remote Keycloak endpoint is exposed separately at `/airflow-keycloak/`, so it does not conflict with Cockpit's local Keycloak login.

```bash
DEV_AIRFLOW_URL=http://212.132.78.62:8080 \
DEV_AIRFLOW_KEYCLOAK_URL=https://81.173.115.246:30596 \
DEV_AIRFLOW_KEYCLOAK_TLS_INSECURE=true \
./dev/setup.sh --skip-trino --skip-garage
```

`DEV_AIRFLOW_KEYCLOAK_TLS_INSECURE=true` is required only for the supplied self-signed test Keycloak certificate. Keep the Cockpit bookmark URL as `https://localhost:8443/airflow/`.

## Contributing

1. Make your changes
2. Run quality checks:

   ```bash
   npm run format
   npm run check
   npm run lint
   ```

3. Run E2E tests
4. Submit pull request

For detailed development guidelines, see [CLAUDE.md](./CLAUDE.md).
