# Tech Debt

Tracked issues that are acceptable at the current early stage but must be addressed before production.

---

## Security

### Connection config is in-memory only

**File:** `src/lib/server/trino/user-clients.ts`

Per-user Trino connection configuration (URL + credentials) is stored in a module-level `Map`. It is not persisted across server restarts and is not shared across multiple processes/instances. Acceptable for single-instance deployments during development. Long-term: persist to a database keyed by authenticated user.

---

### Raw upstream error messages returned to the client

**File:** `src/lib/server/trino/queries.ts:176`

Trino error messages are stored verbatim in `query.error` and surfaced through `buildSnapshot.error` to the client. Trino errors may expose schema details, table names, or internal query plans. These should be classified (query error vs. infrastructure error) and sanitised before being surfaced to users.

---

### TLS certificate verification can be disabled without a custom CA

**File:** `src/lib/server/storage/s3-client.ts`

When `tls.verification` is set to `'None'`, the S3 client is created with `rejectUnauthorized: false`, disabling certificate validation entirely. This is a blunt instrument: it silences errors from self-signed or expired certificates but also makes the connection vulnerable to MITM attacks. The correct long-term fix is to allow users to provide their own CA bundle (a PEM file) which is then used to create a custom TLS context, so the server certificate is still validated — just against a trusted private CA instead of the public root store.

---

### ~~S3 connection credentials stored in localStorage~~ — RESOLVED

Previously, S3 connection credentials were persisted in plaintext `localStorage`. This has been replaced by a server-side encrypted credential store backed by PostgreSQL. Credentials are encrypted with AES-256-GCM using a per-deployment application key (`STORAGE_ENCRYPTION_KEY`). The client now sends only a connection UUID (`x-storage-connection-id` header); the server decrypts and creates the S3 client. See `src/lib/server/storage/encryption.ts` and `src/lib/server/storage/connection.ts`.

---

### Download token store is in-memory only

**File:** `src/lib/server/storage/download-tokens.ts`

The `downloadObject` function no longer buffers objects in browser memory. It now uses a token exchange flow: a HEAD pre-flight validates access, the client exchanges the connection header for a short-lived token via `POST /api/storage/download/token`, then navigates to the download URL with that token. The browser streams the object directly to disk — no JavaScript-side buffering.

The token store is an in-memory `Map<string, TokenEntry>`. Tokens expire after 60 seconds and are single-use. In a multi-process or serverless deployment, the in-memory store would not be shared across instances. The long-term fix is to use a shared store (Redis or signed JWTs that need no server-side state).

---

### In-memory session store loses state on restart and prevents horizontal scaling

**File:** `src/lib/server/auth.ts`

better-auth uses its built-in memory adapter for session and user storage. All sessions and user records are lost on server restart, and because state is process-local, multiple replicas cannot share sessions. The long-term fix is to switch to PostgreSQL or Redis to allow horizontal scaling and session persistence.

---

### Anonymous users share a single Trino client

**File:** `src/lib/server/auth-utils.ts`, `src/lib/server/trino/user-clients.ts`

When OIDC is disabled, every unauthenticated request resolves to `userId = 'anonymous'`, so all anonymous users share the same per-user Trino client and connection. Saving a connection in one browser replaces it for all other anonymous sessions. Per-tab UUIDs still separate query state, but the underlying connection is global. Acceptable for single-user dev; a non-issue once OIDC is required in production.

---

### In-memory query store lost on server restart and prevents horizontal scaling

**File:** `src/lib/server/trino/queries.ts`

All server-side query state (progress, rows, status) is held in a module-level `Map`. A server restart clears all state — running queries become orphaned in Trino and completed results are lost. Additionally, because the state is process-local, multiple server instances cannot share query state: a query started on instance A is invisible to instance B. Combined with the in-memory session store limitation (see above), the deployment is limited to a single replica. Acceptable during development; long-term this should be backed by Redis or a persistent store to enable horizontal scaling and resilience.

---

### Single-file download limit

**File:** `src/lib/storage/download.ts`, `src/lib/components/storage/FileExplorer.svelte`

The Download action is intentionally restricted to a single file at a time. Multi-file or folder downloads (e.g. zipping selected items on the fly) are deferred to a future ticket. Until then, the Download button is disabled whenever more than one item is selected and is always disabled for directories.

---

### Completed query results are ephemeral (default 30-minute TTL)

**File:** `src/lib/server/trino/queries.ts:20`

Completed query snapshots (including result rows) are cleaned up after `STACKABLE_COCKPIT_QUERY_TTL` seconds (default 1800). If a user leaves and returns later, the results will be gone. Consider persisting results to disk or a cache with configurable TTL.

---

## API & Validation

### Client-side row accumulation has no memory bound

**File:** `src/routes/(app)/trino/query-runner.svelte.ts`

The client accumulates all result rows in memory up to `MAX_CLIENT_ROWS` (10,000). For wide result sets this could consume significant browser memory. Consider implementing streaming/virtual scrolling for large results.

---

### Displayed results not cleared on connection change

**File:** `src/routes/(app)/trino/+page.svelte`

After saving a new connection, the previous query results remain visible until a new query is run. Consider calling `runner.reset()` when the connection changes.

---

### No validation that the connection target is a Trino instance

**File:** `src/routes/(app)/trino/+page.server.ts`

The query action sends whatever SQL the user provides to the configured connection URL without first verifying that the endpoint is actually a Trino instance. A user could point the URL at any HTTP server, and the app would blindly POST to it. We should validate new connections (e.g. by calling Trino's `/v1/info` endpoint) and reject URLs that do not respond as a Trino server.

---

## Testing

### Mobile viewport E2E tests skipped in CI

Mobile viewport tests (393×851, touch-enabled) are excluded from CI runs to reduce resource pressure on GitHub Actions runners (2 vCPU). They still run locally. The long-term fix is to either run mobile tests in a separate scheduled workflow or provision larger CI runners.

---

## Infrastructure

### No Content Security Policy headers

No CSP headers are set anywhere. This leaves the app exposed to XSS in ways that a strict CSP would mitigate. Should be added in a SvelteKit hook once the app stabilises.

---

### `allowedHosts: true` in Vite config

**File:** `vite.config.ts`

The dev server accepts requests from any host. This enables DNS rebinding attacks against local development environments. Should be restricted to `localhost` / `127.0.0.1` unless remote dev access is explicitly needed.

---

### Archive browsing downloads entire file before parsing

**File:** `src/lib/server/storage/archive.ts`

Archive browsing (ZIP, TAR.GZ, RAR, 7z) downloads the entire archive from S3 to a temporary file on the server before listing or extracting entries. The feasibility of partial/random-access reading depends entirely on the archive format.

#### ZIP (fixable with S3 Range requests)

ZIP stores a **Central Directory** (full file listing) at the end of the file, preceded by an **EOCD** (End of Central Directory) record. This allows true random access:

1. **HEAD** the S3 object to get `Content-Length`
2. **Range request for the last ~100 bytes** → parse EOCD to locate the Central Directory
3. **Range request for the Central Directory** → get full file listing (typically <50 KB)
4. **To extract one file**: single Range request to that file's compressed data offset

Total data transferred for listing: 2 Range requests, often under 50 KB regardless of archive size. Extraction costs only what the user opens — no temp file I/O needed for ZIPs at all.

Available libraries with S3 Range support:

- **`unzipper`** (`ZJONSSON/node-unzipper`) — `Open.s3()` for AWS SDK v2; `Open.custom()` with S3 Range workaround for v3 (see [issue #241](https://github.com/ZJONSSON/node-unzipper/issues/241)). Most mature option.
- **`s3-range-zip`** (`numtel/s3-range-zip`) — Purpose-built for S3 Range-based ZIP reading with `@aws-sdk/client-s3`. Smaller and simpler.
- **`unzipit`** (`greggman/unzipit`) — `HTTPRangeReader` requires presigned S3 URLs; better suited for browser use.

**Recommendation**: Replace `adm-zip` with `unzipper.Open.custom()` using the AWS SDK v3 workaround. This eliminates download latency for ZIPs entirely (the most common archive format) and naturally supports nested archives (inner ZIP's central directory read the same way). Implementation steps:

1. Install `unzipper` npm package, remove `adm-zip`
2. Implement S3 custom reader using `HeadObjectCommand` + `GetObjectCommand` with `Range` header
3. Replace `listZip()` with central directory parsing (no extraction needed for listing)
4. Replace `extractFromZip()` with offset-based single-file extraction
5. Keep `extractFromZip` as fallback name but implement via `unzipper`
6. Remove ZIP from temp-file caching (TAR.GZ/RAR/7z still need it)
7. Remove `adm-zip` dependency

#### TAR.GZ (fundamentally limited — format constraint)

TAR has no central index (sequential tape format). Gzip is a streaming compressor. Together they force full sequential decompression from the start. Three tiers of mitigation exist:

- **Stream + skip** (Node.js `node-tar` + `zlib.createGunzip()`): decompress everything but avoid writing to disk. This is what the current approach effectively does after download. Bandwidth + CPU cost same as full download.
- **Index-on-first-pass** (e.g. Rust [`iluvatar`](https://docs.rs/crate/iluvatar/latest)): records decompressor checkpoints on first pass, subsequent extractions restore nearest checkpoint and seek forward. No Node.js equivalent exists.
- **Specialised format** ([`estargz`](https://github.com/containerd/stargz-snapshotter), [`tarzan`](https://github.com/astraw/tarzan-rs)): archives must be created in these formats; existing `.tar.gz` files cannot be retrofitted.

**Recommendation**: Keep current full-download + temp cache. This is unavoidable for arbitrary `.tar.gz` files.

#### RAR & 7z (limited — solid compression blocks)

Both use solid compression where a single file's data may be interleaved across a compressed block. Without format-level block-to-file index (which neither exposes easily), extracting one file requires decompressing the entire solid block.

**Recommendation**: Keep full-download + temp cache.

#### Summary

| Format | Partial access | Approach                | Bandwidth per listing  |
| ------ | -------------- | ----------------------- | ---------------------- |
| ZIP    | ✅ Yes         | S3 Range via `unzipper` | ~50 KB (2 Range calls) |
| TAR.GZ | ❌ No          | Full download + cache   | Full archive           |
| RAR    | ❌ No          | Full download + cache   | Full archive           |
| 7z     | ❌ No          | Full download + cache   | Full archive           |

---

### RAR and 7z archive support requires system binaries

**File:** `src/lib/server/storage/archive.ts`

RAR and 7z archive parsing shells out to `unrar` and `7zz`/`7z` system binaries respectively. These may not be installed in the production container image. If absent, the user sees a clear error message telling them to install the binary. ZIP and TAR.GZ work without system dependencies (pure JS). The Dockerfile should be updated to include `unrar` and `p7zip` (or similar) packages when RAR/7z support is needed in production.

---

### No server-side file size limit on uploads (v0)

**File:** `src/routes/(app)/api/storage/upload/+server.ts`

The upload endpoint imposes no maximum file size. S3's 5 TB single-object limit applies as a natural backstop. For v0 this is acceptable; large uploads will consume server-side streaming resources proportionally but do not buffer the body in memory (the stream is piped directly to the `@aws-sdk/lib-storage` Upload). Add a configurable `MAX_UPLOAD_BYTES` guard in a future iteration once typical object sizes are known.

---

### No `/readyz` endpoint — readiness uses the trivial liveness probe

**File:** `src/routes/healthz/+server.ts`, `deploy/helm/cockpit/values.yaml`

Both `livenessProbe` and `readinessProbe` point at `/healthz`, which always returns 200. There is currently nothing meaningful to gate readiness on (better-auth uses an in-memory session store, OIDC discovery is fetched lazily on first auth call), so a separate `/readyz` would just be a placeholder. Once one of these lands — a real session store / DB, eager OIDC discovery, or a startup-time cache warm — split into `/healthz` (liveness, trivial) and `/readyz` (readiness, checking the new dependency), and update the helm probes accordingly.

---

## Architecture (Tracked by fitness functions in src/architecture/\*.spec.ts)

### Circular imports in the Trino server layer

**Files:** `src/lib/server/trino/client.ts` ↔ `src/lib/server/trino/user-clients.ts` and `src/lib/server/trino/queries.ts` ↔ `src/lib/server/trino/result-collector.ts`

Two pairs of circular imports exist in the Trino sub-layer. They cause unpredictable module initialisation order and block reliable tree-shaking. The fitness function `KNOWN VIOLATION — Trino layer has circular imports` documents this and will fail the moment the cycle count drops to zero (prompting removal of the exception).

**Fix:** Extract shared interfaces (`TrinoQuery`, `QueryState`, etc.) into `src/lib/server/trino/types.ts`. Neither `client.ts` nor `user-clients.ts` should import from each other — both should import types from the new file.

---

### `state.svelte.ts` is too large (2 331 LOC)

**File:** `src/lib/storage/state.svelte.ts`

This single file contains the entire client-side storage state machine, all reactive derived values, and all event handlers. It is the primary obstacle to the 600-line LOC fitness function threshold. The fitness function currently allows up to 2 400 lines.

**Fix:** Split into focused modules:

- `state/selection.svelte.ts` — selected items, range-selection logic
- `state/upload.svelte.ts` — upload job tracking
- `state/navigation.svelte.ts` — current path, history
- `state/operations.svelte.ts` — copy/move/delete operation state
- `state/index.svelte.ts` — re-exports and glue

---

### `PreviewModal.svelte` is too large (1 065 LOC)

**File:** `src/lib/components/storage/modals/PreviewModal.svelte`

This Svelte component mixes routing logic, multiple preview renderers, and toolbar state in one file. The fitness function currently allows up to 1 100 lines.

**Fix:** Extract preview renderers into separate child components (`CsvRenderer.svelte`, `ParquetRenderer.svelte`, `TextRenderer.svelte`, etc.) and pass the selected object as a prop.

---

### Pre-existing `<div onclick>` patterns (BITV 2.0 violation)

**Files:**

- `src/lib/components/catalog/CatalogTree.svelte` — tree node rows
- `src/lib/components/storage/explorer/OperationsButton.svelte` — operation rows
- `src/lib/components/storage/explorer/TabBar.svelte` — tab items
- `src/lib/components/storage/shared/FloatingMenu.svelte` — portal overlay
- `src/lib/components/trino/StatementResult.svelte` — result rows

Using `<div onclick>` instead of `<button>` breaks keyboard navigation and screen reader support (BITV 2.0). Each of these is listed in the fitness function `KNOWN_VIOLATIONS` list for the `clickable div/span elements must not replace <button>` rule. **When a file is fixed, remove it from that list.** New files with the same pattern will fail the test immediately.

**Fix:** Replace interactive `<div>` elements with `<button type="button">` or an appropriate semantic element (`<li role="option">` for list items in a listbox, etc.).

---

### Pre-existing hardcoded `aria-label` strings (i18n violation)

**Files:** `ToastHost.svelte`, `TextEditor.svelte`, `ContextMenu.svelte`, `FileRow.svelte`, `FolderRow.svelte`, `ObjectTable.svelte`, `StorageBreadcrumb.svelte`, `CsvPreview.svelte`, `ParquetPreview.svelte`, `TextPreview.svelte`

Ten components use static `aria-label="English text"` attributes instead of Paraglide i18n message functions. Screen reader users on the German locale receive English text. Each is listed in the `KNOWN_VIOLATIONS` list in the `aria-label` fitness function. **When a file is fixed, remove it from that list.**

**Fix:** Add corresponding message keys to `messages/en.json` and `messages/de.json`, import `* as m from '$lib/paraglide/messages.js'`, and replace `aria-label="..."` with `aria-label={m.key_name()}`.

---

### Shared storage types live in `src/lib/server/storage/types.ts` instead of `src/lib/types/`

**Files:** `src/lib/components/storage/landing/StorageConnectForm.svelte`, `src/lib/components/storage/sidebar/StorageConnectionSidebar.svelte`

These Svelte components use `import type { ConnectionMetadata }` from the server layer. TypeScript erases `import type` at compile time so there is no runtime bundle risk, but it establishes an unexpected dependency arrow from the component layer to the server layer that is invisible to ArchUnitTS (which does not scan `.svelte` files).

**Fix:** Move `ConnectionMetadata` and other shared types from `src/lib/server/storage/types.ts` into `src/lib/types/storage.ts` so the types live in the layer that both server and client code can freely import.
