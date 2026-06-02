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
