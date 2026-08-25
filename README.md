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

### Embedded Services

Embedded services are routed through authenticated, same-origin SvelteKit routes under
`/api/services/<service>/`. This removes browser CORS and iframe-cookie concerns without
modifying the service or deploying a separate reverse proxy. Service credentials are used
only by the Cockpit server and never reach the browser.

Any bookmark product id can be embedded through the proxy by configuring its upstream URL
with flat environment variables (`STACKABLE_COCKPIT_<ID>_URL`, `_AUTH_MODE`,
`_BEARER_TOKEN`). A bookmark for a configured product is then served from
`/api/services/<id>/` rather than its raw URL; unconfigured products keep using the raw URL.

| Variable                              | Description                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STACKABLE_COCKPIT_<ID>_URL`          | Direct HTTP(S) URL of the service's web UI or API server. Setting it enables the proxy for that product.                                                                                                                                                                                                                                                                                          |
| `STACKABLE_COCKPIT_<ID>_AUTH_MODE`    | `none` (default, plain reverse proxy), `simple-users` (per-user Airflow login: the proxy exchanges the dex-sourced cockpit session identity for a real Airflow token via stock `SimpleAuthManager`), `all-admins` (anonymous admin token, stock dev fallback), `bearer` (static token), `sso` (forwards the cockpit session identity as `X-Forwarded-*` headers to an upstream that trusts them). |
| `STACKABLE_COCKPIT_<ID>_BEARER_TOKEN` | Required when `AUTH_MODE=bearer`; remains server-side.                                                                                                                                                                                                                                                                                                                                            |
| `STACKABLE_COCKPIT_<ID>_SIMPLE_USERS` | Required when `AUTH_MODE=simple-users`; comma-separated `user:password` pairs matching the upstream's named users.                                                                                                                                                                                                                                                                                |

For example, to embed Superset and Spark alongside Airflow:

```text
STACKABLE_COCKPIT_AIRFLOW_URL=http://127.0.0.1:8089
STACKABLE_COCKPIT_AIRFLOW_AUTH_MODE=simple-users
STACKABLE_COCKPIT_AIRFLOW_SIMPLE_USERS=alice:pipeline-alice,bob:pipeline-bob
STACKABLE_COCKPIT_SUPERSET_URL=http://superset.example.com
STACKABLE_COCKPIT_SPARK_URL=http://spark-history.example.com
```

`~/airflow-proxy` contains the default **stock** Airflow 3.3.0 development stack — no image
patches, no SSO services inside Airflow. It defines the dev realm's users (alice/bob) as
stock `SimpleAuthManager` named users so the Cockpit proxy can log the embedded UI in as the
actual session user; production deployments must use a real OIDC auth manager or `bearer`
with a least-privilege service token.

## dex (development SSO broker)

`dev/docker-compose.dex.yml` runs a shared [dex](https://dexidp.io) instance on
`http://localhost:5556` (`dev/dex.yaml`). It fronts the kind-cluster Keycloak deployed by
`dev/setup.sh` (realm `stackable`) and serves as the single OIDC issuer for the cockpit, so
one browser session covers the cockpit login and any embedded services. Start the cluster
first, then:

```bash
docker compose -f dev/docker-compose.dex.yml up -d
./dev/setup.sh   # auto-detects dex on :5556 and configures .env.development accordingly
```

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
