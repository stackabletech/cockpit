# Storage Feature — Reorganization Plan

This document is an easy-to-follow, step-by-step plan to reorganise the S3 file-browser/storage feature into a clearer, more secure, and testable structure. Follow each step and use the verification checks to confirm progress.

---

## Overview
- Goal: Separate UI, shared domain logic, server providers, business service layer, and public API routes. Add tests and secure persistence for user connection credentials.
- Scope: Minimal breaking changes for UI; refactor server code to centralise logic and enable proper APIs.

---

## Prerequisites
- Node.js version from `.node-version` and `nvm` available.
- Ensure you can run dev server: `npm run dev`.
- AWS SDK is already a dependency (`@aws-sdk/client-s3`).

---

## Canonical Folder Layout (target)
- `src/lib/components/storage/` — UI components (Breadcrumb, FileExplorer, ObjectTable, BucketList, ContextMenu, SelectionToolbar, ConnectForm)
- `src/lib/storage/` — shared domain models and client helpers (`types.ts`, `storage-utils.ts`, `tokenMap.ts`)
- `src/lib/server/storage/` — server implementations: `provider.ts`, `factory.ts`, `s3-provider.ts`, `hdfs-provider.ts` (or remove), `service.ts`, `persistence-adapter.ts`, `audit.ts`
- `src/routes/api/storage/` — API endpoints: `list`, `object`, `metadata`, `download`, `rename`, `move`, `delete`, `connect`
- `src/lib/server/storage/__tests__/` — unit tests for providers/service

---

## Step-by-step Plan (follow in order)

1) Create canonical folder layout
- What: Add the folders above and move existing files into their new homes (or create shims that import old files to avoid breaking routes while migrating).
- Commands (example):

```bash
# create directories
mkdir -p src/lib/storage src/lib/server/storage src/routes/api/storage
git add -A
```

- Verify: files exist in their new locations or shims import moved files.
- Est. time: 30–60 min

2) Extract server service layer (`service.ts`)
- What: Move S3-listing, error handling, and connection lookup logic from `+page.server.ts`/`+layout.server.ts` into `src/lib/server/storage/service.ts`. The service exposes functions like `listObjects(userId, bucket, prefix, continuationToken)` and `getObjectStream(userId, bucket, key)`.
- Why: Improves testability and removes business logic from route loaders.
- Verify: route loaders call `service.ts` and behavior remains identical.
- Est. time: 60–90 min

3) Implement pluggable persistence adapter for user connections
- What: Replace `user-connections.ts` in-memory Map with `persistence-adapter.ts` (interface + `in-memory` and `file` adapters). Persist secrets encrypted for dev if needed.
- Commands: create `src/lib/server/storage/persistence-adapter.ts` with methods `saveConnection(userId, conn)`, `getConnection(userId)`, `deleteConnection(userId)`.
- Verify: connect/disconnect route actions still work, credentials survive dev-server restarts if `file` adapter chosen.
- Est. time: 1–3 hours (depends encryption chosen).

4) Add API routes under `src/routes/api/storage/`
- What: Create thin REST endpoints used by the UI to perform object operations. Examples:
  - `GET /api/storage/list?bucket=...&prefix=...&continuationToken=...`
  - `GET /api/storage/object?bucket=...&key=...` (metadata and/or signed streaming)
  - `GET /api/storage/download?bucket=...&key=...` (download proxy)
  - `POST /api/storage/rename`, `POST /api/storage/delete`, etc.
- Why: Keep client UI decoupled from provider SDK and centralise auth, audit and rate limits.
- Verify: UI calls endpoints and responses are correct; add server logs for calls.
- Est. time: 2–4 hours

5) Change S3 provider to use continuation tokens (cursor) instead of offset pages
- What: Refactor `s3-provider.ts` to return `ContinuationToken` and `IsTruncated`/`NextContinuationToken` per S3 API, and make the `list` API pass tokens through.
- Why: S3 list is designed for cursor pagination and is far more efficient for large buckets.
- Verify: `GET /api/storage/list` returns `items` and `nextContinuationToken`; client can request next pages with the token.
- Est. time: 1–3 hours

6) Wire UI actions to the new API routes
- What: Replace client-side stubs for preview/download/rename/move/delete with calls to endpoints in `src/routes/api/storage/*`. Use streaming downloads for large objects.
- Accessibility: keep keyboard/aria behaviour in components intact.
- Verify: right-click menu and selection toolbar actions work and show server-side errors when appropriate.
- Est. time: 3–6 hours

7) Add unit tests (providers and utils)
- What: Add unit tests for `s3-provider.ts`, `storage-utils.ts`, and `service.ts`. Mock `@aws-sdk/client-s3` responses using jest or vitest.
- Verify: tests cover listing, metadata parsing, error mapping, and token propagation.
- Est. time: 2–4 hours

8) Add E2E tests for connect → list → download
- What: Add Playwright tests in `e2e/` to exercise connect form, listing, pagination, and a download/preview.
- Verify: Playwright tests pass locally.
- Est. time: 3–6 hours

9) Security hardening and operational concerns
- What: Ensure:
  - credentials are stored encrypted and not logged, use a vault in production
  - server endpoints perform authorization checks (OPA) and audit destructive actions
  - rate-limiting for download/preview endpoints
  - remove `hdfs-provider.ts` or implement it properly
- Verify: manual security review + running app with audit logs enabled.
- Est. time: 4+ hours (depends on infra)

10) Documentation and tech-debt updates
- What: Update `TECH_DEBT.md`, add README for storage module, and document the persistence adapter selection.
- Verify: docs updated and reviewed.
- Est. time: 30–60 min

---

## Quick Implementation Checklist (commands)

- Create directories:

```bash
mkdir -p src/lib/storage src/lib/server/storage src/routes/api/storage
```

- Scaffold `service.ts` and `persistence-adapter.ts` files (example):

```bash
# create files (example)
cat > src/lib/server/storage/service.ts <<'EOF'
// scaffold service layer
EOF

cat > src/lib/server/storage/persistence-adapter.ts <<'EOF'
// scaffold persistence adapter
EOF
```

- Run dev server and run tests as you implement:

```bash
npm run dev
npm run test:e2e
# or unit tests
npm run test
```

---

## Verification & Acceptance Criteria
- UI behaves the same from a user perspective for connect + list flows.
- Server-side code tested (unit tests) for provider and service logic.
- Continuation-token pagination works and is used by the UI to page.
- Credentials are not stored in a process-local Map for production (use `persistence-adapter`).
- Audit logs are emitted for destructive operations and not for secrets.

---

## Notes & Security reminders
- Never log credentials. Ensure `pino` redaction config covers credential fields.
- For multi-replica deployments, use a replicated secret store (Vault, KMS-encrypted DB column).
- Use server-side streaming for downloads — avoid loading whole object into memory.

---

## Next steps (you can do these now)
1. Decide on persistence adapter to use for dev: `in-memory (dev)`, `file (dev)`, or `DB/vault (prod)`.
2. Run the directory scaffolding commands above.
3. Implement `service.ts` and move listing logic from `+page.server.ts` into it.

---

Saved checklist & plan in this repo file.
