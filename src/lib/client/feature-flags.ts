// Client-accessible feature flags. These are embedded at build time via
// SvelteKit's $env/static/public and are safe to expose to the browser.
// All variables must be prefixed PUBLIC_.

import { env } from '$env/dynamic/public';

/** When `PUBLIC_STACKABLE_COCKPIT_STORAGE_AUTO_CONNECT=true`, the storage page
 *  automatically reconnects to the most recently used connection when the
 *  user navigates to `/storage`. Disabled by default — the user must choose
 *  a connection manually. */
export const storageAutoConnectEnabled =
  (env.PUBLIC_STACKABLE_COCKPIT_STORAGE_AUTO_CONNECT ?? 'false') === 'true';

/** When `PUBLIC_STACKABLE_COCKPIT_STORAGE_RESTORE_TABS=true`, the file browser
 *  saves open tabs (their name, order, and location) to localStorage and
 *  restores them the next time the user navigates to `/storage`.
 *  Disabled by default. */
export const storageRestoreTabsEnabled =
  (env.PUBLIC_STACKABLE_COCKPIT_STORAGE_RESTORE_TABS ??
    env.PUBLIC_STACKABLE_UI_STORAGE_RESTORE_TABS ??
    'false') === 'true';

/** Timeout in milliseconds for the storage auto-connect attempt. Default: 15 000 (15 s).
 *  Controlled by `PUBLIC_STACKABLE_COCKPIT_STORAGE_AUTO_CONNECT_TIMEOUT_MS`. */
export const storageAutoConnectTimeoutMs: number = (() => {
  const parsed = parseInt(env.PUBLIC_STACKABLE_COCKPIT_STORAGE_AUTO_CONNECT_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15_000;
})();

// ── Pagination ───────────────────────────────────────────────────────────────

/** Parse a comma-separated page-sizes string into a deduplicated, sorted list
 *  of positive integers. Falls back to [25, 50, 100] when the value is absent
 *  or produces no valid entries. */
function parsePageSizes(raw: string | undefined): readonly number[] {
  if (raw) {
    const parsed = raw
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (parsed.length > 0) {
      return [...new Set(parsed)].sort((a, b) => a - b);
    }
  }
  return [25, 50, 100];
}

/** The set of page sizes available in paginated list views.
 *  Controlled by `PUBLIC_STACKABLE_COCKPIT_PAGE_SIZES` (comma-separated positive
 *  integers, e.g. `"10,25,50,100"`). Default: `25,50,100`.
 *  Values are deduplicated and sorted ascending. */
export const allowedPageSizes: readonly number[] = parsePageSizes(
  env.PUBLIC_STACKABLE_COCKPIT_PAGE_SIZES
);

/** The page size selected by default when no user preference is stored.
 *  Controlled by `PUBLIC_STACKABLE_COCKPIT_DEFAULT_PAGE_SIZE`.
 *  Must be one of the values in `allowedPageSizes`; if the configured value
 *  is not in the allowed set it falls back to the first allowed size. */
export const defaultPageSize: number = (() => {
  const raw = env.PUBLIC_STACKABLE_COCKPIT_DEFAULT_PAGE_SIZE;
  const parsed = parseInt(raw ?? '', 10);
  return allowedPageSizes.includes(parsed) ? parsed : (allowedPageSizes[0] ?? 25);
})();

// ── Storage browser: Text editor ─────────────────────────────────────────────

/** Maximum file size (in bytes) that can be edited inline in the text editor.
 *  Files larger than this will show a read-only preview without the save button.
 *  Controlled by `PUBLIC_STACKABLE_COCKPIT_MAX_EDITABLE_FILE_SIZE`. Default: 5242880 (5 MiB).
 *  Raise to allow editing larger files; lower to avoid excessive S3 bandwidth
 *  when saving truncated files (the full file must be re-uploaded). */
export const maxEditableFileSize: number = (() => {
  const parsed = parseInt(env.PUBLIC_STACKABLE_COCKPIT_MAX_EDITABLE_FILE_SIZE ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 1024 * 1024;
})();

// ── Storage browser ──────────────────────────────────────────────────────────

/** Maximum number of recently visited files and locations kept in localStorage
 *  for the storage browser history.
 *  Controlled by `PUBLIC_STACKABLE_COCKPIT_MAX_RECENT_FILES`. Default: 15.
 *  Raise to retain a longer history; lower to reduce localStorage pressure on
 *  deployments that handle many distinct objects. Must be a positive integer. */
export const maxRecentFiles: number = (() => {
  const parsed = parseInt(env.PUBLIC_STACKABLE_COCKPIT_MAX_RECENT_FILES ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
})();

/** Maximum number of parallel HTTP requests fired during the upload conflict
 *  check and during the upload itself.
 *  Controlled by `PUBLIC_STACKABLE_COCKPIT_UPLOAD_CONCURRENCY`. Default: 3.
 *  Raise for faster bulk uploads on high-throughput connections; lower to
 *  reduce server pressure on constrained deployments. Must be a positive
 *  integer. */
export const uploadConcurrency: number = (() => {
  const parsed = parseInt(env.PUBLIC_STACKABLE_COCKPIT_UPLOAD_CONCURRENCY ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
})();

// ── Storage browser: Context actions (cut, copy, paste, rename) ────────────

/** When `PUBLIC_STACKABLE_COCKPIT_STORAGE_CUT_COPY_ENABLED=true`, the context
 *  menu shows "Cut" and "Copy" actions and Ctrl+X / Ctrl+C keyboard shortcuts
 *  are active. These are costly S3 operations (list + copy) on most backends.
 *  Disabled by default. */
export const storageCutCopyEnabled =
  (env.PUBLIC_STACKABLE_COCKPIT_STORAGE_CUT_COPY_ENABLED ?? 'false') === 'true';

/** When `PUBLIC_STACKABLE_COCKPIT_STORAGE_PASTE_ENABLED=true`, the context
 *  menu shows "Paste" (when clipboard is non-empty) and Ctrl+V is active
 *  to paste cut/copied items into the current prefix. Disabled by default. */
export const storagePasteEnabled =
  (env.PUBLIC_STACKABLE_COCKPIT_STORAGE_PASTE_ENABLED ?? 'false') === 'true';

/** When `PUBLIC_STACKABLE_COCKPIT_STORAGE_RENAME_ENABLED=true`, the context
 *  menu shows "Rename" and F2 is active to rename the selected item.
 *  Disabled by default. */
export const storageRenameEnabled =
  (env.PUBLIC_STACKABLE_COCKPIT_STORAGE_RENAME_ENABLED ?? 'false') === 'true';
