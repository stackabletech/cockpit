// Server-side read of cross-cutting feature flags. Read once at module init
// from the live process env so consumers don't repeat the env-name + parsing.
// Limits and other settings live in the config modules, not here.

import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { envBoolean, parseEnv } from '$lib/env-schema.js';

const flags = parseEnv(
  z.object({
    STACKABLE_COCKPIT_COMPLETION_ENABLED: envBoolean(true),
    STACKABLE_COCKPIT_STORAGE_BROWSER_ENABLED: envBoolean(false)
  }),
  env
);

/** When `STACKABLE_COCKPIT_COMPLETION_ENABLED=false`, the SQL editor's
 *  code-completion provider is not registered and the metadata endpoint
 *  refuses requests. Useful to fall back to plain syntax highlighting if
 *  completion misbehaves or generates undesirable load on Trino. */
export const completionEnabled = flags.STACKABLE_COCKPIT_COMPLETION_ENABLED;

/** When `STACKABLE_COCKPIT_STORAGE_BROWSER_ENABLED=true`, the S3/HDFS file
 *  browser is shown in the sidebar and routes under `/storage` become
 *  active. Disabled by default — opt in explicitly to expose storage
 *  credentials and the file-browser UI. */
export const storageBrowserEnabled = flags.STACKABLE_COCKPIT_STORAGE_BROWSER_ENABLED;

// ── Flags shared with the client ─────────────────────────────────────────────
//
// These are `PUBLIC_` flags that the server enforces too. They are defined
// once in `$lib/client/feature-flags` so both sides parse them identically.
//
// Context actions: server-side enforcement (cost control, not authorisation) on
// `POST /api/storage/transfer` and its `/plan`, by the request's `op`:
// - `copy` requires paste.
// - `move` requires move or paste, because drag-and-drop and cut-and-paste
//   both move.
// - `rename` requires rename.
// Cut/copy only fill the client clipboard and have no endpoint of their own.
export {
  infiniteScrollEnabled,
  storagePasteEnabled,
  storageRenameEnabled,
  storageMoveEnabled
} from '$lib/client/feature-flags.js';
