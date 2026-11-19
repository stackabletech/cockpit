# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [26.11.0-rc1] - 2026-11-19

### Added

- Trino SQL query editor.
- S3 file browser.
- Bookmarks, including global bookmarks set by the administrator.
- OIDC login with user impersonation in Trino.

### Fixed

- Uploads larger than 6 MiB in the S3 file browser. `BODY_SIZE_LIMIT` now defaults to `5G` and caps the upload file size; all other requests are limited to 6 MiB (or the editable file size plus 1 MiB). Raise the body limit of an ingress or reverse proxy to match.
- `REQUEST_TIMEOUT`, the time in seconds to receive a whole request (default `3600` in the container image instead of Node's `300`), so large uploads don't time out after five minutes. The container now starts `server.js`, which wraps `build/index.js`.
