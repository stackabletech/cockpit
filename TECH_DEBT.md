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

### SQLite session store prevents horizontal scaling

**File:** `src/lib/server/auth.ts`, `deploy/helm/stackable-ui/values.yaml`

better-auth uses SQLite (via better-sqlite3) for session and user storage. SQLite only supports a single writer, so the deployment is limited to `replicaCount: 1`. A single pod failure means complete downtime with no failover. The long-term fix is to switch to PostgreSQL or a stateless session store (JWT/Redis) to allow horizontal scaling.

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

## Infrastructure

### No Content Security Policy headers

No CSP headers are set anywhere. This leaves the app exposed to XSS in ways that a strict CSP would mitigate. Should be added in a SvelteKit hook once the app stabilises.

---

### `allowedHosts: true` in Vite config

**File:** `vite.config.ts`

The dev server accepts requests from any host. This enables DNS rebinding attacks against local development environments. Should be restricted to `localhost` / `127.0.0.1` unless remote dev access is explicitly needed.
