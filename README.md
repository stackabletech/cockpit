# Stackable Cockpit

[![License OSL 3.0](https://img.shields.io/badge/license-OSL--3.0-blue)](./LICENSE)

Stackable Cockpit is the unified web UI for the [Stackable Data Platform (SDP)](https://stackable.tech/).
It provides a single place to work with the data services running on your platform.

> [!WARNING]
> Stackable Cockpit is experimental.

## About The Stackable Data Platform

This application is part of the Stackable Data Platform, a curated selection of best-of-breed data applications and tools that you can deploy and operate on Kubernetes.
The platform builds on open-source projects and provides Kubernetes operators to manage them, including:

- [Apache Airflow](https://github.com/stackabletech/airflow-operator)
- [Apache Druid](https://github.com/stackabletech/druid-operator)
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

Read more about the platform in the [documentation](https://docs.stackable.tech/) and on the [Stackable Hub](https://hub.stackable.tech/).

## Features

- Single sign-on via any OIDC provider
- Trino SQL query editor and schema browser, with queries submitted under the logged-in user's name

More modules will be added over time.

## Quick Start

The required Node.js version is pinned in [`.node-version`](./.node-version).

```bash
# Install dependencies
npm install

# Start the development server (http://localhost:5173)
npm run dev
```

Copy [`.env.example`](./.env.example) to `.env` and adjust the values for your OIDC provider and Trino endpoint.
For a fully pre-configured local environment (Keycloak and Trino on a local kind cluster), see [`dev/setup.sh`](./dev/setup.sh).

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

The chart needs an existing PostgreSQL database (`database.*` values). See the [chart README](./deploy/helm/cockpit/README.md) for the full list of values, and [docs/DATABASE.md](./docs/DATABASE.md) for the database settings, including TLS.

### Docker

```bash
docker build . -f docker/Dockerfile \
  --build-arg TARGETARCH=x86 --build-arg VERSION=0.0.0-dev \
  -t cockpit:0.0.0-dev

docker run -p 3000:3000 cockpit:0.0.0-dev
```

## Configuration

The application is configured via environment variables.
Create a `.env` file at the project root, or set them in your deployment environment.

### Feature Flags

| Variable                                            | Type                             | Default | Description                                                                                                                                                                                             | Example                                                  |
| --------------------------------------------------- | -------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `STACKABLE_COCKPIT_COMPLETION_ENABLED`              | `boolean` (`"false"` to disable) | `true`  | Enables the SQL editor code-completion provider and the metadata endpoint. Set to `"false"` to fall back to plain syntax highlighting.                                                                  | `STACKABLE_COCKPIT_COMPLETION_ENABLED=false`             |
| `STACKABLE_COCKPIT_STORAGE_BROWSER_ENABLED`         | `boolean` (`"true"` to enable)   | `false` | Shows the S3/HDFS file browser in the sidebar and activates routes under `/storage`. Must be explicitly opted in to expose storage credentials and the file-browser UI.                                 | `STACKABLE_COCKPIT_STORAGE_BROWSER_ENABLED=true`         |
| `PUBLIC_STACKABLE_COCKPIT_STORAGE_CUT_COPY_ENABLED` | `boolean` (`"true"` to enable)   | `false` | Shows Cut/Copy in the file browser and lets items be dragged. Client-only: it fills the clipboard, the S3 work happens on paste or move.                                                                | `PUBLIC_STACKABLE_COCKPIT_STORAGE_CUT_COPY_ENABLED=true` |
| `PUBLIC_STACKABLE_COCKPIT_STORAGE_PASTE_ENABLED`    | `boolean` (`"true"` to enable)   | `false` | Shows Paste in the file browser. When disabled, the server rejects copies via `/api/storage/transfer` with 404, and moves too unless the Move flag is enabled.                                          | `PUBLIC_STACKABLE_COCKPIT_STORAGE_PASTE_ENABLED=true`    |
| `PUBLIC_STACKABLE_COCKPIT_STORAGE_RENAME_ENABLED`   | `boolean` (`"true"` to enable)   | `false` | Shows Rename in the file browser. The server accepts renames via `/api/storage/transfer` only when this is enabled.                                                                                     | `PUBLIC_STACKABLE_COCKPIT_STORAGE_RENAME_ENABLED=true`   |
| `PUBLIC_STACKABLE_COCKPIT_STORAGE_MOVE_ENABLED`     | `boolean` (`"true"` to enable)   | `false` | Enables drag-and-drop move in the file browser (dragging also needs cut/copy). The server accepts moves via `/api/storage/transfer` only when this or paste is enabled, since cut-and-paste also moves. | `PUBLIC_STACKABLE_COCKPIT_STORAGE_MOVE_ENABLED=true`     |

### Storage Preview Limits

| Variable                                | Type              | Default             | Description                                                                                                                                                                                             | Example                                          |
| --------------------------------------- | ----------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `STACKABLE_COCKPIT_TEXT_PREVIEW_BYTES`  | `integer` (bytes) | `262144` (256 KiB)  | Maximum bytes fetched when previewing text, TSV, or JSON files. Editable text files (text types except CSV/TSV, up to `PUBLIC_STACKABLE_COCKPIT_MAX_EDITABLE_FILE_SIZE`) are always fetched completely. | `STACKABLE_COCKPIT_TEXT_PREVIEW_BYTES=524288`    |
| `STACKABLE_COCKPIT_IMAGE_PREVIEW_BYTES` | `integer` (bytes) | `5242880` (5 MiB)   | Maximum bytes fetched when previewing image files.                                                                                                                                                      | `STACKABLE_COCKPIT_IMAGE_PREVIEW_BYTES=10485760` |
| `STACKABLE_COCKPIT_PDF_PREVIEW_BYTES`   | `integer` (bytes) | `26214400` (25 MiB) | Maximum bytes fetched when previewing PDF files.                                                                                                                                                        | `STACKABLE_COCKPIT_PDF_PREVIEW_BYTES=52428800`   |
| `STACKABLE_COCKPIT_FILE_PREVIEW_ROWS`   | `integer` (rows)  | `250`               | Maximum number of rows included in a tabular file preview (e.g. Parquet converted to CSV).                                                                                                              | `STACKABLE_COCKPIT_FILE_PREVIEW_ROWS=500`        |

### Storage Transfers

| Variable                                         | Type      | Default | Description                                                                                                                                                                                                           | Example                                            |
| ------------------------------------------------ | --------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `STACKABLE_COCKPIT_STORAGE_TRANSFER_CONCURRENCY` | `integer` | `8`     | Objects copied at once within one copy, move or rename request. Copies run server-side in the storage backend (S3 CopyObject); no data streams through the app. A missing or invalid value falls back to the default. | `STACKABLE_COCKPIT_STORAGE_TRANSFER_CONCURRENCY=4` |

### Request Body Size

| Variable          | Type             | Default                                       | Description                                                                                                                                                                                                                                                                            | Example               |
| ----------------- | ---------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `BODY_SIZE_LIMIT` | `string` (bytes) | `6M` in the container image (adapter: `512K`) | Maximum request body size accepted by the Node.js server ([adapter-node](https://svelte.dev/docs/kit/adapter-node#Environment-variables-BODY_SIZE_LIMIT)). Must be at least `PUBLIC_STACKABLE_COCKPIT_MAX_EDITABLE_FILE_SIZE`, otherwise saving larger files in the text editor fails. | `BODY_SIZE_LIMIT=12M` |

## Documentation

- Platform documentation: <https://docs.stackable.tech/>
- Stackable website: <https://stackable.tech/>
- Stackable Hub: <https://hub.stackable.tech/>

## Contributing

Contributions are welcome!
Please open an issue or pull request.
Before submitting changes, run the quality checks:

```bash
npm run format
npm run check
npm run lint
npm run test:e2e
```

Contributions require agreeing to a Contributor License Agreement (CLA).
When you open your first pull request, the CLA assistant will guide you through signing it.

## Support

- [GitHub Discussions](https://github.com/orgs/stackabletech/discussions)
- [Discord](https://discord.gg/7kZ3BNnCAF)
- [Commercial support plans](https://stackable.tech/en/plans/)

## Sponsor

If you find this project useful, consider [sponsoring Stackable](https://github.com/sponsors/stackabletech).

## License

Licensed under the [Open Software License version 3.0](./LICENSE).
This project bundles the Trino SQL grammar and code derived from it, which are licensed under the [Apache License, Version 2.0](./LICENSE-Apache-2.0).
The relevant source files carry upstream attribution headers.
