# Stackable Cockpit

[![License OSL 3.0](https://img.shields.io/badge/license-OSL--3.0-blue)](./LICENSE)

Stackable Cockpit is the unified web UI for the [Stackable Data Platform (SDP)](https://stackable.tech/).
It provides a single place to work with the data services running on your platform. The first (and currently only)
module is a **Trino SQL query editor** with single sign-on, per-user authorisation and catalogue
browsing.
More modules will be added over time.

This is currently an experimental part of the Stackable Data Platform.

## About The Stackable Data Platform

This application is part of the Stackable Data Platform, a curated selection of best-of-breed data
applications and tools that you can deploy and operate on Kubernetes. The platform builds on
open-source Apache projects and provides Kubernetes operators to manage them, including:

- [Apache Airflow](https://github.com/stackabletech/airflow-operator)
- [Apache HBase](https://github.com/stackabletech/hbase-operator)
- [Apache Hadoop HDFS](https://github.com/stackabletech/hdfs-operator)
- [Apache Hive](https://github.com/stackabletech/hive-operator)
- [Apache Kafka](https://github.com/stackabletech/kafka-operator)
- [Apache NiFi](https://github.com/stackabletech/nifi-operator)
- [OpenSearch](https://github.com/stackabletech/opensearch-operator)
- [Apache Spark](https://github.com/stackabletech/spark-k8s-operator)
- [Apache Superset](https://github.com/stackabletech/superset-operator)
- [Trino](https://github.com/stackabletech/trino-operator)
- [Apache ZooKeeper](https://github.com/stackabletech/zookeeper-operator)

Read more about the platform in the [documentation](https://docs.stackable.tech/).

## Quick Start

The required Node.js version is pinned in [`.node-version`](./.node-version).

```bash
# Install dependencies
npm install

# Start the development server (http://localhost:5173)
npm run dev
```

Copy [`.env.example`](./.env.example) to `.env` and adjust the values for your OIDC provider and
Trino endpoint. For a fully pre-configured local environment (Keycloak and Trino on a local kind
cluster), see [`dev/setup.sh`](./dev/setup.sh).

## Development

```bash
npm run dev          # Start the dev server
npm run build        # Build for production
npm run preview      # Preview the production build

npm run format       # Format all code
npm run check        # Type checking
npm run lint         # Linting
npm run test:e2e     # Run the Playwright end-to-end tests

npm run generate:antlr   # Regenerate the lexer/parser after editing the SQL grammar
```

## Deployment

### Helm

A Helm chart for Kubernetes is included under [`deploy/helm/cockpit`](./deploy/helm/cockpit):

```bash
helm install cockpit ./deploy/helm/cockpit -f your-values.yaml
```

See the [chart README](./deploy/helm/cockpit/README.md) for the full list of values.

### Docker

```bash
docker build . -f docker/Dockerfile \
  --build-arg TARGETARCH=x86 --build-arg VERSION=0.0.0-dev \
  -t cockpit:0.0.0-dev

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

## Documentation

- Platform documentation: <https://docs.stackable.tech/>
- Stackable website: <https://stackable.tech/>

## Contributing

Contributions are welcome! Please open an issue or pull request. Before submitting changes, run the
quality checks:

```bash
npm run format
npm run check
npm run lint
npm run test:e2e
```

Contributions require agreeing to a Contributor License Agreement (CLA). When you open your first
pull request, the CLA assistant will guide you through signing it.

## Support

- [GitHub Discussions](https://github.com/orgs/stackabletech/discussions)
- [Discord](https://discord.gg/7kZ3BNnCAF)
- [Commercial support plans](https://stackable.tech/en/plans/)

## Sponsor

If you find this project useful, consider [sponsoring Stackable](https://github.com/sponsors/stackabletech).

## License

Licensed under the [Open Software License version 3.0](./LICENSE). This project bundles the Trino
SQL grammar and code derived from it, which are licensed under the
[Apache License, Version 2.0](./LICENSE-Apache-2.0); the relevant source files carry upstream
attribution headers.
