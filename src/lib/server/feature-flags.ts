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

// Shared with the client and enforced by `POST /api/storage/transfer` and its
// `/plan`. Cut and copy only fill the client clipboard and have no endpoint of
// their own.
export { storageTransferEnabled } from '$lib/client/feature-flags.js';
