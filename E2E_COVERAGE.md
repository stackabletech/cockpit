# E2E Test Coverage Report

Generated: 2026-05-28

---

## Table of Contents

1. [Overview](#overview)
2. [Test Suites](#test-suites)
   - [Authentication](#authentication)
   - [Smoke Tests](#smoke-tests)
   - [Internationalisation](#internationalisation)
   - [Connection Form](#connection-form)
   - [Catalog Browser](#catalog-browser)
   - [Trino Query Editor](#trino-query-editor)
   - [Trino Editor Tabs](#trino-editor-tabs)
   - [Storage S3 (Garage)](#storage-s3-garage)
3. [Storage Feature — Full Component Coverage](#storage-feature--full-component-coverage)
4. [S3 Bucket Permission Configurations](#s3-bucket-permission-configurations)
5. [Edge Case Coverage Gaps](#edge-case-coverage-gaps)

---

## Overview

| Spec file                     | Tests | Pass | Fail | Notes                          |
| ----------------------------- | ----- | ---- | ---- | ------------------------------ |
| `e2e/auth.spec.ts`            | 5     | 5    | 0    | All browsers                   |
| `e2e/smoke.spec.ts`           | 2     | 2    | 0    | All browsers                   |
| `e2e/i18n.spec.ts`            | 5     | 5    | 0    | All browsers                   |
| `e2e/connection-form.spec.ts` | 10    | 10   | 0    | All browsers                   |
| `e2e/catalog-browser.spec.ts` | 8     | 8    | 0    | All browsers                   |
| `e2e/trino.spec.ts`           | 9     | 9    | 0    | All browsers                   |
| `e2e/trino-tabs.spec.ts`      | 10    | 10   | 0    | All browsers                   |
| `e2e/storage-s3.spec.ts`      | 29    | 29   | 0    | Requires local Garage instance |

**Total: 78 tests / 78 pass** <!-- markdownlint-disable-line MD036/no-emphasis-as-heading -->

Browsers: Chromium, Firefox, Mobile Chromium. Tests with `[setup-chromium]` /
`[setup-firefox]` prefixes are auth setup steps, not counted above.

---

## Test Suites

### Authentication

**File:** `e2e/auth.spec.ts`

| #   | Test                                              | What it verifies                                        |
| --- | ------------------------------------------------- | ------------------------------------------------------- |
| 1   | `unauthenticated access redirects to login page`  | Visiting `/` unauthenticated redirects to `/auth/login` |
| 2   | `login page preserves redirectTo query parameter` | `?redirectTo=` is passed through the OIDC flow          |
| 3   | `authenticated user sees dashboard`               | Successful SSO login lands on the dashboard             |
| 4   | `user menu shows sign out option`                 | Header user menu contains a sign-out link               |
| 5   | `sign out redirects to login page`                | Clicking sign out lands on `/auth/login`                |

**Coverage:** Auth flow (OIDC redirect, callback, session), protected route guards, sign-out.

---

### Smoke Tests

**File:** `e2e/smoke.spec.ts`

| #   | Test                                           | What it verifies                                                            |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | `home page loads with app shell`               | Sidebar branding, active nav item, page title and dashboard content visible |
| 2   | `theme toggle switches between light and dark` | Clicking the toggle changes `data-theme`; state survives click cycles       |

**Coverage:** Basic page load, app shell rendering, theme toggle persistence.

---

### Internationalisation

**File:** `e2e/i18n.spec.ts`

| #   | Test                                               | What it verifies                                      |
| --- | -------------------------------------------------- | ----------------------------------------------------- |
| 1   | `renders in English by default with lang="en"`     | `<html lang="en">`, English copy visible              |
| 2   | `language switcher changes to German`              | UI switches to German after selecting DE              |
| 3   | `locale persists via cookie across navigation`     | Locale cookie survives page navigation                |
| 4   | `Accept-Language header respected for first visit` | No locale cookie → falls back to browser language     |
| 5   | `language switcher is visible and accessible`      | Button visible; dropdown lists both EN and DE options |

**Coverage:** Paraglide-JS compile-time i18n, locale cookie, `Accept-Language` header, language switcher component.

---

### Connection Form

**File:** `e2e/connection-form.spec.ts`

Two describe blocks:

#### "Connection form (env-configured)"

| #   | Test                                                     | What it verifies                                           |
| --- | -------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | `connection form is hidden when Trino is env-configured` | When Trino URL is in env, the connection form is not shown |

#### "Connection form (manual mode)"

| #   | Test                                                      | What it verifies                                        |
| --- | --------------------------------------------------------- | ------------------------------------------------------- |
| 2   | `connection form is visible`                              | Form renders in manual mode                             |
| 3   | `expanding the form reveals URL input`                    | Accordion opens to show URL field                       |
| 4   | `auth type toggle shows credential fields for basic auth` | Selecting Basic Auth shows username and password fields |
| 5   | `auth type toggle hides credential fields for no auth`    | Selecting No Auth hides credential fields               |
| 6   | `submitting without a URL shows a validation error`       | Empty URL → inline validation error                     |
| 7   | `basic auth requires username and password`               | Missing credentials → validation errors                 |
| 8   | `connection details persist to localStorage`              | Filled fields saved to localStorage                     |
| 9   | `stored connection is restored on page reload`            | Reload restores previously saved values                 |
| 10  | `connection summary shows host and auth type`             | Connected state shows host and auth info                |

**Coverage:** Trino connection form validation, auth type switching, localStorage persistence.

---

### Catalog Browser

**File:** `e2e/catalog-browser.spec.ts`

| #   | Test                                                       | What it verifies                               |
| --- | ---------------------------------------------------------- | ---------------------------------------------- |
| 1   | `catalog browser panel renders with tree`                  | Panel visible; initial catalog list loads      |
| 2   | `catalog browser can be toggled`                           | Toggle button shows/hides panel                |
| 3   | `expanding a catalog loads schemas`                        | Clicking catalog loads schema list             |
| 4   | `expanding a schema loads tables`                          | Clicking schema loads table/view list          |
| 5   | `expanding a table loads columns`                          | Clicking table loads column names and types    |
| 6   | `clicking a table name inserts qualified name into editor` | Inserts `tpch.sf1.customer` into Monaco editor |
| 7   | `schema context selectors are populated`                   | Dropdown filters show catalogs/schemas         |
| 8   | `browser is hidden by default on mobile`                   | Mobile viewport: hidden by default, toggleable |

**Coverage:** CatalogBrowser and CatalogTree components, lazy-loading at each tree level, editor insertion, mobile responsiveness.

---

### Trino Query Editor

**File:** `e2e/trino.spec.ts`

| #   | Test                                                              | What it verifies                                                     |
| --- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | `page renders with editor and results sections`                   | Monaco editor, results panel, Run button, initial "No results" state |
| 2   | `Trino nav item is active when on /trino`                         | `aria-current="page"` set on nav item                                |
| 3   | `running a query displays the results table`                      | Execute query; results table with columns and rows                   |
| 4   | `Ctrl+Enter triggers query execution`                             | Keyboard shortcut runs query                                         |
| 5   | `query error is shown in an alert`                                | Invalid SQL shows error alert                                        |
| 6   | `pagination navigates between pages`                              | Next/prev/first/last; button enabled/disabled state                  |
| 7   | `multi-statement script shows results for each statement`         | Multiple SELECTs each produce result section                         |
| 8   | `failed statement shows skipped count`                            | Error mid-script; downstream statements skipped                      |
| 9   | `statement highlighting appears during multi-statement execution` | Executing statement highlighted; cleared after completion            |

**Coverage:** Monaco editor, query execution API, results table, pagination, error display, keyboard shortcuts, multi-statement execution.

---

### Trino Editor Tabs

**File:** `e2e/trino-tabs.spec.ts`

| #   | Test                                                   | What it verifies                                      |
| --- | ------------------------------------------------------ | ----------------------------------------------------- |
| 1   | `default state shows one tab`                          | Single tab on first load                              |
| 2   | `create new tab via + button`                          | Plus button adds a new tab; becomes active            |
| 3   | `switch between tabs preserves SQL content`            | SQL content isolated per tab                          |
| 4   | `close tab removes it and activates adjacent`          | Adjacent tab activated after close                    |
| 5   | `cannot close last remaining tab`                      | Close button hidden when only one tab                 |
| 6   | `tab without custom label shows default name`          | Default "Untitled" label shown                        |
| 7   | `double-click to rename tab`                           | Edit-in-place rename; persists                        |
| 8   | `tab limit enforced — add button disappears at 8 tabs` | Add button hidden at 8 tabs                           |
| 9   | `query execution is scoped to active tab`              | Switching tabs does not show results from another tab |
| 10  | `page reload preserves tabs via localStorage`          | Tabs + SQL content restored after reload              |

**Coverage:** TabBar component, tab lifecycle (create/close/rename), localStorage persistence, query scoping per tab.

---

### Storage S3 (Garage)

**File:** `e2e/storage-s3.spec.ts`

Requires: a running Garage instance with valid `s3-config.json`. Tests skip automatically otherwise.
Permission tests (marked ⚙) additionally require `GARAGE_ADMIN_URL` and `GARAGE_ADMIN_TOKEN`.

#### Connection & Authentication

| #   | Test                                                                | Components exercised                   | S3 operations            |
| --- | ------------------------------------------------------------------- | -------------------------------------- | ------------------------ |
| 1   | `connects to Garage S3 bucket and lists buckets`                    | StorageConnectForm, BucketGrid         | `ListBuckets`            |
| 2   | `shows an error for invalid Garage credentials`                     | StorageConnectForm                     | `ListBuckets` (rejected) |
| 3   | `saves a connection and reconnects from the saved connections list` | StorageConnectForm (saved connections) | `ListBuckets`            |
| 4   | `forgets a saved connection via the remove button`                  | StorageConnectForm (forget dialog)     | —                        |
| 5   | `disconnects from Garage S3`                                        | StorageConnectForm disconnect          | —                        |

#### Bucket Grid Navigation

| #   | Test                                                                  | Components exercised     | S3 operations   |
| --- | --------------------------------------------------------------------- | ------------------------ | --------------- |
| 6   | `clicking a bucket tile in the grid navigates to the bucket explorer` | BucketGrid, FileExplorer | `ListObjectsV2` |

#### Browsing & Navigation

| #   | Test                                                                | Components exercised                                    | S3 operations                           |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------- |
| 7   | `browses nested folders, uses breadcrumbs, and shows empty folders` | FileExplorer, ObjectTable, StorageBreadcrumb, FolderRow | `ListObjectsV2` with prefix, navigation |
| 8   | `paginates bucket listings`                                         | FileExplorer, Pagination                                | `ListObjectsV2` (30 objects, 2 pages)   |
| 9   | `changes the page size and shows more items per page`               | Pagination (page-size selector)                         | `ListObjectsV2`                         |

#### Selection & Bulk Operations

| #   | Test                                                            | Components exercised                                | S3 operations                 |
| --- | --------------------------------------------------------------- | --------------------------------------------------- | ----------------------------- |
| 10  | `selects all items and deselects them with the header checkbox` | ObjectTable (select-all checkbox), SelectionToolbar | —                             |
| 11  | `deletes files and folders recursively`                         | SelectionToolbar, DeleteConfirmModal                | `DeleteObjects`, `HeadObject` |
| 12  | `cancel delete does not remove the selected file`               | DeleteConfirmModal (cancel path)                    | `HeadObject` (verify)         |

#### Context Menu

| #   | Test                                                         | Components exercised                          | S3 operations   |
| --- | ------------------------------------------------------------ | --------------------------------------------- | --------------- |
| 13  | `context menu appears on right-click and shows file actions` | ContextMenu (Preview, Download, Delete items) | —               |
| 14  | `context menu closes when the Escape key is pressed`         | ContextMenu (keyboard dismiss)                | —               |
| 15  | `deletes a single file via context menu`                     | ContextMenu → DeleteConfirmModal              | `DeleteObjects` |

#### Downloads

| #   | Test                                         | Components exercised               | S3 operations                                             |
| --- | -------------------------------------------- | ---------------------------------- | --------------------------------------------------------- |
| 16  | `downloads a file via the selection toolbar` | SelectionToolbar (Download button) | `HEAD /storage/api/download`, `GET /storage/api/download` |
| 17  | `downloads a file via the context menu`      | ContextMenu (Download action)      | `HEAD /storage/api/download`, `GET /storage/api/download` |

#### Preview

| #   | Test                                                             | Components exercised                                               | S3 operations                              |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------ |
| 18  | `previews text files from the object table`                      | PreviewModal, TextPreview (double-click row)                       | `/storage/api/preview`                     |
| 19  | `uploads realistic faker-generated text, csv, and image files`   | UploadModal, TextPreview, CsvPreview, ImagePreview                 | `PutObject` × 3, `HeadObject`, `GetObject` |
| 20  | `shows fallback preview for a known binary file type`            | PreviewModal, FallbackPreview (`X-Preview-Renderable: false` path) | `/storage/api/preview`                     |
| 21  | `shows binary fallback preview for non-decodable binary content` | PreviewModal, FallbackPreview (client-side binary detection)       | `/storage/api/preview`                     |
| 22  | `shows a PDF preview for PDF files`                              | PreviewModal, PdfPreview                                           | `/storage/api/preview`                     |
| 23  | `closes preview modal when the Escape key is pressed`            | PreviewModal (Escape key dismiss)                                  | `/storage/api/preview`                     |

#### Upload & Conflict Resolution

| #   | Test                                                             | Components exercised                   | S3 operations                    |
| --- | ---------------------------------------------------------------- | -------------------------------------- | -------------------------------- |
| 24  | `uploads files and resolves replace, skip, and rename conflicts` | UploadModal (replace/skip/rename flow) | `PutObject` × 3, `GetObject` × 5 |

#### Permissions / Error Scenarios

| #   | Test                                                              | Components exercised                                          | S3 operations                            | Requires admin |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------- | -------------- |
| 25  | `surfaces real Garage permission errors for a read-only bucket` ⚙ | UploadModal (access-denied error), toast system, delete error | `PutObject` (403), `DeleteObjects` (403) | ✅             |
| 26  | `shows access denied error when browsing a write-only bucket` ⚙   | `+error.svelte` (403 page)                                    | `ListObjectsV2` (403)                    | ✅             |
| 27  | `shows access denied error when browsing a no-access bucket` ⚙    | `+error.svelte` (403 page)                                    | `ListObjectsV2` (403)                    | ✅             |

#### Recent Items

| #   | Test                                                            | Components exercised        | What it verifies                                |
| --- | --------------------------------------------------------------- | --------------------------- | ----------------------------------------------- |
| 28  | `tracks recently visited locations in the Recent Locations tab` | RecentItems (Locations tab) | Navigating to a bucket records a location entry |
| 29  | `tracks recently accessed files in the Recent Files tab`        | RecentItems (Files tab)     | Previewing a file records a file entry          |

#### Faker-Generated File Fixtures

| Fixture                    | File type | MIME type       | Generated content                            |
| -------------------------- | --------- | --------------- | -------------------------------------------- |
| `createTextUploadFixture`  | `.txt`    | `text/plain`    | Author, project, summary, lorem paragraphs   |
| `createCsvUploadFixture`   | `.csv`    | `text/csv`      | 5 rows: customer, email, city, annual_spend  |
| `createImageUploadFixture` | `.svg`    | `image/svg+xml` | Gradient SVG with title, card ID, owner name |

---

## Storage Feature — Full Component Coverage

### Source Components

| Component            | File                                                        | E2E covered? | What's tested                                                               |
| -------------------- | ----------------------------------------------------------- | ------------ | --------------------------------------------------------------------------- |
| `StorageConnectForm` | `src/lib/components/storage/StorageConnectForm.svelte`      | ✅           | Connect, invalid creds, saved connections, forget dialog, disconnect        |
| `BucketGrid`         | `src/lib/components/storage/BucketGrid.svelte`              | ✅           | Bucket list rendered; tile click navigates to explorer                      |
| `FileExplorer`       | `src/lib/components/storage/FileExplorer.svelte`            | ✅           | Selection mode, navigation, pagination, page-size change, toolbar           |
| `ObjectTable`        | `src/lib/components/storage/ObjectTable.svelte`             | ✅           | File rows, folder rows, select-all checkbox, indeterminate state            |
| `FileRow`            | `src/lib/components/storage/FileRow.svelte`                 | ✅           | Double-click preview, single-click selection, right-click context menu      |
| `FolderRow`          | `src/lib/components/storage/FolderRow.svelte`               | ✅           | Click to navigate, selection checkbox, right-click context menu             |
| `StorageBreadcrumb`  | `src/lib/components/storage/StorageBreadcrumb.svelte`       | ✅           | Breadcrumb segments, click to navigate up                                   |
| `ContextMenu`        | `src/lib/components/storage/ContextMenu.svelte`             | ✅           | Right-click open, Preview/Download/Delete items, Escape to close            |
| `PreviewModal`       | `src/lib/components/storage/PreviewModal.svelte`            | ✅           | Open, close (button + Escape), loading, text/csv/image/pdf/fallback content |
| `TextPreview`        | `src/lib/components/storage/preview/TextPreview.svelte`     | ✅           | Text file content rendered                                                  |
| `CsvPreview`         | `src/lib/components/storage/preview/CsvPreview.svelte`      | ✅           | CSV table rendered                                                          |
| `ImagePreview`       | `src/lib/components/storage/preview/ImagePreview.svelte`    | ✅           | SVG rendered with alt text                                                  |
| `PdfPreview`         | `src/lib/components/storage/preview/PdfPreview.svelte`      | ✅           | PDF iframe rendered                                                         |
| `FallbackPreview`    | `src/lib/components/storage/preview/FallbackPreview.svelte` | ✅           | Known-binary and client-detected binary paths; "Download full file" link    |
| `UploadModal`        | `src/lib/components/storage/UploadModal.svelte`             | ✅           | Upload, conflict resolution (replace/skip/rename), permission error         |
| `DeleteConfirmModal` | `src/lib/components/storage/DeleteConfirmModal.svelte`      | ✅           | Confirm (single file, folder), cancel (no deletion)                         |
| `SelectionToolbar`   | `src/lib/components/storage/SelectionToolbar.svelte`        | ✅           | Delete button, Download button                                              |
| `Pagination`         | `src/lib/components/Pagination.svelte`                      | ✅           | Next/prev/page indicator, page-size selector                                |
| `RecentItems`        | `src/lib/components/storage/RecentItems.svelte`             | ✅           | Recent Files tab, Recent Locations tab                                      |
| `TimestampDisplay`   | `src/lib/components/storage/TimestampDisplay.svelte`        | ⚠️           | Rendered but not directly asserted                                          |

### Server Routes

| Route                           | Method | E2E covered? | What's tested                                                   |
| ------------------------------- | ------ | ------------ | --------------------------------------------------------------- |
| `/storage`                      | GET    | ✅           | Bucket list, connect form                                       |
| `/storage/[bucket]/[...prefix]` | GET    | ✅           | Object listing, pagination, 403 error page                      |
| `/storage/api/upload`           | POST   | ✅           | Successful upload, permission error                             |
| `/storage/api/download`         | GET    | ✅           | File download triggered via toolbar and context menu            |
| `/storage/api/download`         | HEAD   | ✅           | Pre-flight check invoked by download action                     |
| `/storage/api/delete`           | DELETE | ✅           | Files, recursive folders, permission error                      |
| `/storage/api/preview`          | GET    | ✅           | Text, CSV, image, PDF, binary-fallback, unknown-binary previews |

### Server-Side Services

| Service / File                               | E2E covered? | Notes                                                       |
| -------------------------------------------- | ------------ | ----------------------------------------------------------- |
| `src/lib/server/storage/service.ts`          | ✅           | All exported operations exercised                           |
| `src/lib/server/storage/s3-provider.ts`      | ✅           | listBuckets, listObjects, upload, delete, download, preview |
| `src/lib/server/storage/s3-client.ts`        | ✅           | Client creation with test credentials                       |
| `src/lib/server/storage/s3-errors.ts`        | ✅           | 403 error mapped to user-facing message                     |
| `src/lib/server/storage/user-connections.ts` | ✅           | Connect, disconnect, per-user state                         |
| `src/lib/server/storage/preview/binary.ts`   | ✅           | `KNOWN_BINARY_TYPES` path (zip) and renderable:false header |
| `src/lib/server/storage/preview/stream.ts`   | ✅           | Text, CSV, image, PDF streaming                             |
| `src/lib/server/storage/hdfs-provider.ts`    | ❌           | HDFS stub not implemented or tested                         |
| `src/lib/server/storage/preview/parquet.ts`  | ❌           | Parquet preview disabled                                    |

---

## S3 Bucket Permission Configurations

### Garage Permission Model

Garage S3 uses per-key, per-bucket access grants with three flags:

```typescript
type GarageBucketPermissions = {
  owner: boolean; // Can manage bucket (set ACLs, modify configuration)
  read: boolean; // Can list objects and get objects
  write: boolean; // Can put and delete objects
};
```

### Tested Scenarios

| Scenario        | `owner` | `read` | `write` | Covered by                                                   |
| --------------- | :-----: | :----: | :-----: | ------------------------------------------------------------ |
| **Full access** |   ✅    |   ✅   |   ✅    | Tests 1–24, 28–29: browse, upload, delete, preview, paginate |
| **Read-only**   |   ❌    |   ✅   |   ❌    | Test 25: upload blocked (403), delete blocked (403)          |
| **Write-only**  |   ❌    |   ❌   |   ✅    | Test 26: listing returns 403 error page                      |
| **No access**   |   ❌    |   ❌   |   ❌    | Test 27: listing returns 403 error page                      |

### Permission Scenarios Not Yet Covered

| Scenario                         | `owner` | `read` | `write` | What to test                                                                |
| -------------------------------- | :-----: | :----: | :-----: | --------------------------------------------------------------------------- |
| **Write-only — upload succeeds** |   ❌    |   ❌   |   ✅    | Upload itself should succeed (listing is blocked; this is not yet verified) |
| **Owner-only**                   |   ✅    |   ❌   |   ❌    | Bucket manageable but list/upload blocked                                   |
| **Owner + Write, no Read**       |   ✅    |   ❌   |   ✅    | Upload succeeds; listing fails; download blocked                            |
| **Owner + Read, no Write**       |   ✅    |   ✅   |   ❌    | Same UX as read-only                                                        |

### Tested Permission Error Messages

| Operation                     | Blocked by  | Error message displayed                                            |
| ----------------------------- | ----------- | ------------------------------------------------------------------ |
| Upload (write: false)         | Garage 403  | _"Access denied. You do not have permission to upload here."_      |
| Delete (write: false)         | Garage 403  | _"Access denied. You do not have permission to delete this item."_ |
| Browse (read: false)          | Garage 403  | Storage error page with 403 and bucket name in message             |
| Invalid credentials (connect) | Garage auth | Error shown on connection form                                     |

---

## Edge Case Coverage Gaps

### Storage — Remaining Gaps

| Gap                                                 | Priority | Notes                                                                                      |
| --------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| **Write-only bucket — upload success**              | Medium   | Listing blocked verified, but upload success not asserted in isolation                     |
| **Non-ASCII filenames**                             | Medium   | RFC 5987 `Content-Disposition` encoding not verified end-to-end                            |
| **Download — content verification**                 | Medium   | Download event triggered and filename asserted, but file bytes not verified                |
| **PreviewModal — maximise/restore**                 | Low      | Maximise button in modal header not tested                                                 |
| **PreviewModal — truncated content / "Fetch more"** | Low      | Truncation badge and download-full link for truncated text not tested                      |
| **SelectionToolbar — Preview button**               | Low      | Preview via toolbar tested implicitly via double-click; toolbar button not directly tested |
| **ContextMenu — Pin/Unpin**                         | Low      | Pin and Unpin actions in context menu not tested                                           |
| **StorageBreadcrumb — right-click pin**             | Low      | Right-click on breadcrumb segment to pin/unpin not tested                                  |
| **Large file pagination (100 items/page)**          | Low      | Only 25 and 50 page sizes tested                                                           |
| **Concurrent uploads**                              | Low      | Multiple simultaneous uploads not tested                                                   |
| **HDFS provider**                                   | N/A      | Not implemented                                                                            |
| **Parquet preview**                                 | N/A      | Disabled in codebase                                                                       |

### Other Features — Remaining Gaps

| Gap                   | Priority | Notes                                                                        |
| --------------------- | -------- | ---------------------------------------------------------------------------- |
| **Mobile storage UI** | Medium   | Storage pages not tested at mobile viewport                                  |
| **TimestampDisplay**  | Low      | Rendered on every row but timestamp formatting/relative display not asserted |
