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

### S3 connection credentials stored in localStorage

**File:** `src/lib/storage/connection-storage.ts`, `src/lib/components/storage/StorageConnectForm.svelte`

S3 connection credentials (access key ID and secret access key) are persisted in plaintext `localStorage` so the browser can auto-reconnect after a page reload or server restart. `localStorage` is accessible to any JavaScript running on the page and is visible in browser DevTools, making it vulnerable to XSS. Acceptable for the current early stage where the alternative is users having to re-enter credentials after every server restart. Long-term fix: persist encrypted credentials server-side, tied to the authenticated session; send only a session token to the client.

---

### Download endpoint buffers entire object in browser memory

**File:** `src/lib/storage/download.ts`

`downloadObject` fetches the full S3 object body via the `/storage/api/download` endpoint, buffers it as a `Blob` in browser memory, then triggers a programmatic anchor click. This is simpler than streaming directly to disk but means the entire object must fit in browser memory before the save dialog appears. Acceptable for the current object sizes; for very large files (multiple GiB) this will cause memory pressure. Long-term fix: use the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) `createWritable()` to stream bytes directly to disk without buffering, with a fallback to the current Blob approach for Firefox (which does not support `showSaveFilePicker`).

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

**File:** `src/lib/trino/query-runner.svelte.ts`

The client accumulates all result rows in memory up to `MAX_CLIENT_ROWS` (10,000). For wide result sets this could consume significant browser memory. Consider implementing streaming/virtual scrolling for large results.

---

### Displayed results not cleared on connection change

**File:** `src/routes/(app)/trino/query-runner.svelte.ts`, `src/routes/(app)/trino/+page.svelte`

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

### Session cookie not configured for cross-origin iframe embedding

**File:** `src/lib/server/auth.ts`

The better-auth session cookie currently uses `SameSite=Lax` (the browser default when no `SameSite` attribute is set). Browsers do not send `SameSite=Lax` cookies when a page is loaded inside an `<iframe>` whose top-level frame is on a different origin, so authenticated users visiting `/trino?embed=1` or `/storage?embed=1` from an external host page will be silently redirected to `/auth/login`.

To fix this, configure the session cookie with `SameSite=None; Secure` in `better-auth`:

```typescript
// src/lib/server/auth.ts
export const auth = betterAuth({
  advanced: {
    cookies: {
      session_token: {
        attributes: { sameSite: 'none', secure: true }
      }
    }
  }
  // …rest of config
});
```

**Why this is deferred:** `SameSite=None` is only accepted by browsers when the `Secure` flag is also set, which requires HTTPS. The current dev setup uses plain HTTP, so setting this unconditionally would break local development. The correct approach is to make it conditional on a production/HTTPS flag (e.g. `process.env.NODE_ENV === 'production'` or a dedicated env var) once a staging environment with HTTPS is available.

**Also required for cross-origin embedding:** The embedding host page and the Cockpit server must both be on HTTPS, and the Cockpit server's CORS / CSP must explicitly trust the embedding origin if additional API restrictions are in place.

---

### No Content Security Policy headers

No CSP headers are set anywhere. This leaves the app exposed to XSS in ways that a strict CSP would mitigate. Should be added in a SvelteKit hook once the app stabilises.

---

### `allowedHosts: true` in Vite config

**File:** `vite.config.ts`

The dev server accepts requests from any host. This enables DNS rebinding attacks against local development environments. Should be restricted to `localhost` / `127.0.0.1` unless remote dev access is explicitly needed.

---

### No server-side file size limit on uploads (v0)

**File:** `src/routes/(app)/storage/api/upload/+server.ts`

The upload endpoint imposes no maximum file size. S3's 5 TB single-object limit applies as a natural backstop. For v0 this is acceptable; large uploads will consume server-side streaming resources proportionally but do not buffer the body in memory (the stream is piped directly to the `@aws-sdk/lib-storage` Upload). Add a configurable `MAX_UPLOAD_BYTES` guard in a future iteration once typical object sizes are known.

---

### No `/readyz` endpoint — readiness uses the trivial liveness probe

**File:** `src/routes/healthz/+server.ts`, `deploy/helm/cockpit/values.yaml`

Both `livenessProbe` and `readinessProbe` point at `/healthz`, which always returns 200. There is currently nothing meaningful to gate readiness on (better-auth uses an in-memory session store, OIDC discovery is fetched lazily on first auth call), so a separate `/readyz` would just be a placeholder. Once one of these lands — a real session store / DB, eager OIDC discovery, or a startup-time cache warm — split into `/healthz` (liveness, trivial) and `/readyz` (readiness, checking the new dependency), and update the helm probes accordingly.
