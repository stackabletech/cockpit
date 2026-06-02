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

### Completed query results are ephemeral (default 30-minute TTL)

**File:** `src/lib/server/trino/queries.ts:20`

Completed query snapshots (including result rows) are cleaned up after `STACKABLE_UI_QUERY_TTL` seconds (default 1800). If a user leaves and returns later, the results will be gone. Consider persisting results to disk or a cache with configurable TTL.

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

### No `/readyz` endpoint — readiness uses the trivial liveness probe

**File:** `src/routes/healthz/+server.ts`, `deploy/helm/cockpit/values.yaml`

Both `livenessProbe` and `readinessProbe` point at `/healthz`, which always returns 200. There is currently nothing meaningful to gate readiness on (better-auth uses an in-memory session store, OIDC discovery is fetched lazily on first auth call), so a separate `/readyz` would just be a placeholder. Once one of these lands — a real session store / DB, eager OIDC discovery, or a startup-time cache warm — split into `/healthz` (liveness, trivial) and `/readyz` (readiness, checking the new dependency), and update the helm probes accordingly.
