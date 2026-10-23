// Client-accessible feature flags. These are read at runtime via SvelteKit's
// $env/dynamic/public and are safe to expose to the browser. All variables
// must be prefixed PUBLIC_. The server re-exports the flags it enforces from
// here (see `$lib/server/feature-flags`), so each is parsed in one place.
// Keep this module free of browser-only code: it is also loaded on the server.
// Limits and other settings live in `$lib/client/config`, not here.

import { z } from 'zod';
import { env } from '$env/dynamic/public';
import { envBoolean, parseEnv } from '$lib/env-schema.js';

const flags = parseEnv(
  z.object({
    PUBLIC_STACKABLE_COCKPIT_STORAGE_RESTORE_TABS: envBoolean(false),
    PUBLIC_STACKABLE_COCKPIT_INFINITE_SCROLL_ENABLED: envBoolean(true),
    PUBLIC_STACKABLE_COCKPIT_STORAGE_CUT_COPY_ENABLED: envBoolean(false),
    PUBLIC_STACKABLE_COCKPIT_STORAGE_PASTE_ENABLED: envBoolean(false),
    PUBLIC_STACKABLE_COCKPIT_STORAGE_RENAME_ENABLED: envBoolean(false),
    PUBLIC_STACKABLE_COCKPIT_STORAGE_MOVE_ENABLED: envBoolean(false)
  }),
  env
);

/** When `PUBLIC_STACKABLE_COCKPIT_STORAGE_RESTORE_TABS=true`, the file browser
 *  saves open tabs (their name, order, and location) to localStorage and
 *  restores them the next time the user navigates to `/storage`.
 *  Disabled by default. */
export const storageRestoreTabsEnabled = flags.PUBLIC_STACKABLE_COCKPIT_STORAGE_RESTORE_TABS;

/** When `PUBLIC_STACKABLE_COCKPIT_INFINITE_SCROLL_ENABLED=false`, the CSV and
 *  Parquet file previews load a fixed number of rows without virtual scrolling /
 *  infinite loading. Enabled by default — the previews fetch row chunks lazily
 *  as the user scrolls, reducing S3 costs and browser memory for large files.
 *  Also read by the server. */
export const infiniteScrollEnabled = flags.PUBLIC_STACKABLE_COCKPIT_INFINITE_SCROLL_ENABLED;

/** When `PUBLIC_STACKABLE_COCKPIT_STORAGE_CUT_COPY_ENABLED=true`, the context
 *  menu shows "Cut" and "Copy" actions, Ctrl+X / Ctrl+C keyboard shortcuts
 *  are active, and items can be dragged. Cut and copy only fill the clipboard;
 *  the costly S3 work (list + copy) happens on paste or move, which the server
 *  gates with those flags. Disabled by default. */
export const storageCutCopyEnabled = flags.PUBLIC_STACKABLE_COCKPIT_STORAGE_CUT_COPY_ENABLED;

/** When `PUBLIC_STACKABLE_COCKPIT_STORAGE_PASTE_ENABLED=true`, the context
 *  menu shows "Paste" (when clipboard is non-empty) and Ctrl+V is active
 *  to paste cut/copied items into the current prefix. Also enforced by the
 *  transfer endpoint for copies and moves. Disabled by default. */
export const storagePasteEnabled = flags.PUBLIC_STACKABLE_COCKPIT_STORAGE_PASTE_ENABLED;

/** When `PUBLIC_STACKABLE_COCKPIT_STORAGE_RENAME_ENABLED=true`, the context
 *  menu shows "Rename" and F2 is active to rename the selected item. Also
 *  enforced by the transfer endpoint. Disabled by default. */
export const storageRenameEnabled = flags.PUBLIC_STACKABLE_COCKPIT_STORAGE_RENAME_ENABLED;

/** When `PUBLIC_STACKABLE_COCKPIT_STORAGE_MOVE_ENABLED=true`, drag-and-drop
 *  move is active (folder-row, breadcrumb, sidebar, and tab drop targets).
 *  This is a separate flag from paste because move is a costly S3 operation
 *  (list + copy + delete per directory level) and may be undesirable in
 *  high-egress-cost environments. Also enforced by the transfer endpoint.
 *  Disabled by default. */
export const storageMoveEnabled = flags.PUBLIC_STACKABLE_COCKPIT_STORAGE_MOVE_ENABLED;
