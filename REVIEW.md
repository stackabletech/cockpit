# Code Review: `feat/query-execution-flow`

## Critical Issues

### 1. Global shared connection — all users share a single Trino connection

- **File**: `src/lib/server/trino.ts:41-53`
- **Issue**: `activeConnection` is a module-level singleton. `setConnection()` / `getConnection()` operate on a single global variable. When user A saves a connection, user B's next query submission will use user A's connection config (URL, credentials, impersonation).
- **Impact**: In a multi-user deployment, this is both a **security vulnerability** (credential leaking between users) and a **correctness bug** (queries run against the wrong Trino instance or with the wrong identity). Even the `onMount` in `+page.svelte` re-posts the connection on every page load, so any user navigating to `/trino` will overwrite the global connection for everyone.

### 2. `$lib/types/query.ts` imports from `$lib/server/trino.js`

- **File**: `src/lib/types/query.ts:1`
- **Issue**: `QuerySnapshot` references `TrinoColumn` via `import type { TrinoColumn } from '$lib/server/trino.js'`. This file is imported by the client-side `query-runner.svelte.ts`. While `import type` is erased at runtime, it creates a dependency chain: `query-runner.svelte.ts` → `$lib/types/query.js` → `$lib/server/trino.js`. Depending on how the bundler resolves this, it may pull in server-only code (pino, etc.) into the client bundle, or fail at build time.
- **Impact**: Potential build failure or SSR/client hydration mismatch. The `TrinoColumn` interface should live in a shared (non-server) types file.

### 3. `query-runner.svelte.ts` directly imports from `$lib/server/trino.js`

- **File**: `src/routes/(app)/trino/query-runner.svelte.ts:1`
- **Issue**: Same problem as above but more direct — `import type { TrinoColumn } from '$lib/server/trino.js'` in a `.svelte.ts` file that runs on the client. This is a `type`-only import but still a server path dependency.

### 4. `MAX_CLIENT_ROWS` is duplicated

- **File**: `src/lib/types/query.ts:3` and `src/lib/server/query-store.ts:16`
- **Issue**: Both files define `MAX_CLIENT_ROWS = 10_000`. The query store imports its own copy rather than the shared one from `$lib/types/query.ts`. If someone changes one, the other will silently drift.

---

## Security Notes

### 1. Connection credentials stored in module-level global (see Critical #1)

- **File**: `src/lib/server/trino.ts:41`
- **Risk**: Basic auth credentials (username/password) for one user's Trino connection are stored in a process-global variable and are used by whichever user next triggers a query.
- **Recommendation**: Connection config must be scoped per-user (e.g., keyed by session ID or stored in `event.locals`).

### 2. No auth check on API endpoints

- **File**: `src/routes/(app)/trino/api/statement/+server.ts`, `api/cancel/+server.ts`, `api/query/status/+server.ts`
- **Risk**: These endpoints rely on the auth guard in `hooks.server.ts`, which is only conditionally enabled (`oidcEnabled`). When OIDC is disabled, these endpoints are fully unauthenticated, and `getUserId` falls back to `'anonymous'` — meaning all users share a single query namespace.
- **Recommendation**: This is likely acceptable for dev/demo mode, but worth documenting in `TECH_DEBT.md`.

### 3. `onMount` silently re-posts credentials to server

- **File**: `src/routes/(app)/trino/+page.svelte:49-58`
- **Issue**: On every page load, credentials from localStorage are POSTed to `?/save` via a raw `fetch` call (not through SuperForms). This bypasses CSRF protection that SuperForms normally provides. The `x-sveltekit-action: true` header simulates a form action, but there's no CSRF token.
- **Recommendation**: Either use the SuperForms `submit()` programmatically, or move connection restoration to use a dedicated API endpoint.

---

## Accessibility Issues

### 1. Progress bar missing accessible label

- **File**: `src/routes/(app)/trino/+page.svelte` (the `<progress>` element in the status display)
- **Violation**: The `<progress>` element has no `aria-label` or associated `<label>`. Screen readers will announce a raw percentage without context.
- **Fix**: Add `aria-label={m.trino_state_running()}` or similar.

### 2. Dropdown menu accessibility

- **File**: `src/lib/components/layout/Header.svelte:65-100`
- **Violation**: The `<!-- svelte-ignore a11y_no_noninteractive_tabindex -->` comment suppresses an a11y warning. The `<ul>` has `tabindex="0"` which makes a non-interactive list focusable. DaisyUI dropdown pattern relies on this, but it doesn't provide keyboard navigation (arrow keys) for menu items.
- **Fix**: This is a known DaisyUI limitation. Consider adding `role="menu"` to the `<ul>` and `role="menuitem"` to the `<li>` children, or note it as accepted tech debt.

### 3. User menu list items with nested `<p>` and `<hr>`

- **File**: `src/lib/components/layout/Header.svelte:80-84`
- **Violation**: `<li>` containing `<p>` tags for user info and a separate `<li>` wrapping just `<hr>` are semantically odd for a `<ul>` menu. The info block isn't a menu item.
- **Fix**: Minor — consider using a `<div>` outside the `<ul>` for the user info block.

---

## Maintainability Concerns

### 1. `onMount` fetch to `?/save` is fragile

- **File**: `src/routes/(app)/trino/+page.svelte:49-58`
- **Problem**: The raw `fetch('?/save', ...)` call manually constructs `FormData` and sets `x-sveltekit-action: true` to simulate a form action. This is tightly coupled to SvelteKit internals and bypasses SuperForms validation. If the schema changes or SvelteKit changes its action handling, this will silently break.
- **Suggestion**: Use `superForm`'s programmatic submit, or refactor connection persistence to use a dedicated API endpoint.

### 2. Module-level `$state` in `query-runner.svelte.ts` creates a global singleton

- **File**: `src/routes/(app)/trino/query-runner.svelte.ts:14-21`
- **Problem**: The `$state` runes are at module level, making `queryRunner` a process-wide singleton. During SSR, this state is shared across all concurrent requests. Mitigated by client-only usage via `onMount`, but if anyone accidentally imports it in a server context, state will leak between users.
- **Suggestion**: Add a `// Client-only module` comment at the top, or guard with `browser` check.

### 3. Backoff strategy starts at 0ms in server poll loop

- **File**: `src/lib/server/query-store.ts:139`
- **Problem**: `backoffMs` starts at 0, so the first poll fires immediately after the initial response, then increases by 20ms per iteration. With a cap of 1000ms, it takes 50 iterations to reach the cap. This could hammer Trino aggressively for fast queries. The client-side poll starts at 100ms which is more reasonable.
