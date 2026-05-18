# Tech Debt

Tracked issues that are acceptable at the current early stage but must be addressed before production.

---

## Security

### No authentication or authorisation on the Trino API route

**File:** `src/routes/api/trino/query/+server.ts`, `src/hooks.server.ts`

The `/api/trino/query` endpoint is completely unauthenticated. Any request — from any origin — can execute arbitrary SQL against any Trino instance. OIDC authentication is planned (env vars are wired up, `hooks.server.ts` has the right structure) but not yet implemented. Until auth middleware is in place there is also no per-user rate limiting or query quota.

---

### Trino credentials stored in localStorage

**File:** `src/routes/(app)/trino/+page.svelte:41–44`

Username and password are persisted in plaintext localStorage. This is convenient for development (survives page reloads) but violates credential storage best practices — localStorage is accessible to any script on the page and visible in DevTools. Long-term the connection config should be stored server-side (tied to the authenticated session), with credentials never leaving the server after initial setup.

---

### Credentials sent in every request body

**File:** `src/routes/(app)/trino/+page.svelte:82–84`

Because there is no server-side session yet, connection credentials (including password) are included in the JSON body of every `/api/trino/query` POST. Once server-side sessions exist the client should send only a session token, not raw credentials.

---

### Connection config is in-memory only

**File:** `src/lib/server/trino.ts`

The active connection configuration (URL + credentials) is stored in a module-level variable. It is not persisted across server restarts and is not shared across multiple processes/instances. Acceptable for single-instance deployments during development. Long-term: persist to a session store or database, keyed by authenticated user.

---

### Raw upstream error messages returned to the client

**File:** `src/routes/api/trino/query/+server.ts:165, 181, 209`

Trino error messages and Node.js exception messages are returned to the browser without any sanitisation. Trino errors may expose schema details, table names, or internal query plans. These should be classified (query error vs. infrastructure error) and sanitised before being surfaced to users.

---

### In-memory storage connection state

**File:** `src/lib/server/storage/user-connections.ts`

Per-user S3 connection configs (endpoint, region, credentials) are stored in a server-side `Map`. All connections are lost on server restart and cannot be shared across multiple replicas. Acceptable for the initial phase; mirrors the same pattern used by the Trino user-clients module. Long-term fix: persist encrypted connection configs server-side, tied to the authenticated session.

---

### In-memory session store loses state on restart and prevents horizontal scaling

**File:** `src/lib/server/auth.ts`

better-auth uses its built-in memory adapter for session and user storage. All sessions and user records are lost on server restart, and because state is process-local, multiple replicas cannot share sessions. The long-term fix is to switch to PostgreSQL or Redis to allow horizontal scaling and session persistence.

---

### Anonymous users share a single query slot

**File:** `src/lib/server/query-store.ts`

When OIDC is disabled, all users are identified as `'anonymous'` and share a single active query slot. Submitting a new query cancels the previous one. Once OIDC is required in production this is a non-issue, but for development with multiple anonymous users it can cause unexpected cancellations.

---

### In-memory query store lost on server restart and prevents horizontal scaling

**File:** `src/lib/server/query-store.ts`

All server-side query state (progress, rows, status) is held in a module-level `Map`. A server restart clears all state — running queries become orphaned in Trino and completed results are lost. Additionally, because the state is process-local, multiple server instances cannot share query state: a query started on instance A is invisible to instance B. Combined with the in-memory session store limitation (see above), the deployment is limited to a single replica. Acceptable during development; long-term this should be backed by Redis or a persistent store to enable horizontal scaling and resilience.

---

### Single-file download limit

**File:** `src/lib/storage/download.ts`, `src/lib/components/storage/FileExplorer.svelte`

The Download action is intentionally restricted to a single file at a time. Multi-file or folder downloads (e.g. zipping selected items on the fly) are deferred to a future ticket. Until then, the Download button is disabled whenever more than one item is selected and is always disabled for directories.

---

### Completed query results are ephemeral (30-minute TTL)

**File:** `src/lib/server/query-store.ts`

Completed query snapshots (including result rows) are cleaned up after 30 minutes. If a user leaves and returns later, the results will be gone. Consider persisting results to disk or a cache with configurable TTL.

---

### Status endpoint returns full rows array on each poll

**File:** `src/routes/(app)/trino/api/query/status/+server.ts`

The status endpoint returns the entire accumulated `rows` array on every poll request. With the 10k row cap this is acceptable, but for very wide result sets it is wasteful. A future optimisation could accept a `?rowOffset=N` parameter and return only new rows.

---

## API & Validation

### API route request body not validated with Zod

**File:** `src/routes/api/trino/query/+server.ts:83–103`

`parseConnection` uses manual `typeof` checks instead of a Zod schema. The AGENTS.md guidelines require Zod for all validation. Additionally, `request.json()` is called without a try/catch — a malformed JSON body will throw an unhandled error rather than returning a 400.

---

### Client-side row accumulation has no memory bound

**File:** `src/routes/(app)/trino/query-runner.svelte.ts`

The client accumulates all result rows in memory up to `MAX_CLIENT_ROWS` (10,000). For wide result sets this could consume significant browser memory. Consider implementing streaming/virtual scrolling for large results.

---

### Displayed results not cleared on connection change

**File:** `src/routes/(app)/trino/+page.svelte`

After saving a new connection, the previous query results remain visible until a new query is run. Consider calling `queryRunner.reset()` when the connection changes.

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

### Upload endpoint uses in-memory S3 credentials

**File:** `src/routes/(app)/storage/api/upload/+server.ts`, `src/lib/server/storage/user-connections.ts`

The upload endpoint reads S3 credentials from the same per-user in-memory connection map used by download and preview. This introduces no additional security risk beyond what is already documented in the "In-memory storage connection state" entry above. Long-term fix: same as that entry — persist encrypted credentials server-side.

---

### No server-side file size limit on uploads (v0)

**File:** `src/routes/(app)/storage/api/upload/+server.ts`

The upload endpoint imposes no maximum file size. S3's 5 TB single-object limit applies as a natural backstop. For v0 this is acceptable; large uploads will consume server-side streaming resources proportionally but do not buffer the body in memory (the stream is piped directly to the `@aws-sdk/lib-storage` Upload). Add a configurable `MAX_UPLOAD_BYTES` guard in a future iteration once typical object sizes are known.
