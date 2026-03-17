# Async Trino Query Execution

## File structure

```text
src/lib/types/query.ts                    — Shared types (QueryState, QuerySnapshot, QueryProgress)
src/lib/server/trino-config.ts            — Connection config types (AuthConfig, ConnectionConfig)
src/lib/server/trino-clients.ts           — Per-user Trino client management, metadata queries
src/lib/server/trino-query-model.ts       — TrinoQuery interface and state helpers
src/lib/server/trino-queries.ts           — Query lifecycle (start, snapshot, cancel)
src/lib/server/trino-result-collector.ts  — Background result collector
src/lib/server/auth-utils.ts              — getUserId helper

src/routes/(app)/trino/
  api/query/+server.ts                   — POST: submit, GET: poll status, DELETE: cancel
  query-runner.svelte.ts                 — Client-side reactive state machine (Svelte 5 runes)
  +page.svelte                           — UI (editor, results table, progress)
```

## Request flow

```text
Browser                          SvelteKit Server                    Trino
──────                          ────────────────                    ─────
1. POST /trino/api/query
   { sql: "SELECT ..." }
                                 → startQuery()
                                   - cancels any previous user query
                                   - creates iterator via trino-client
                                   - stores TrinoQuery in memory
                                   - starts fire-and-forget collectResults()
   ← 204

2. GET /trino/api/query          (client polls)
                                 → getQuerySnapshot()
                                   - returns current state, progress,
                                     columns, rows from in-memory store
   ← QuerySnapshot { state, progress, columns, rows, error }
   ... repeats until terminal state ...

   (meanwhile, server collectResults() is independently
    iterating the trino-client result set and
    accumulating rows into the store)

3. DELETE /trino/api/query       (optional)
                                 → cancelQuery()
                                   - calls trino.cancel(queryId)
                                   - marks query CANCELLED
   ← 204
```

## Key design decisions

- **trino-client library**: Uses the official `trino-client` npm package instead of raw HTTP. The library handles the `nextUri` polling chain internally via an async iterator.
- **Server-side result collection**: The SvelteKit server iterates the trino-client result set in a background task (`collectResults`), accumulating rows in memory. The browser never talks to Trino directly.
- **Client-side polling**: `query-runner.svelte.ts` polls `GET /api/query` with exponential backoff (100ms → 500ms) to get snapshots of the server-side state.
- **Single-query-per-user**: Starting a new query auto-cancels any previous active query for that user.
- **Row limit**: Capped at `MAX_CLIENT_ROWS` (10,000). If exceeded, the server cancels the Trino query and returns what it has.
