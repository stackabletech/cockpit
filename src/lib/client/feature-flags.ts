// Client-accessible feature flags. These are read at runtime via SvelteKit's
// $env/dynamic/public and are safe to expose to the browser. All variables
// must be prefixed PUBLIC_. The server re-exports the flags it enforces from
// here (see `$lib/server/feature-flags`), so each is parsed in one place.
// Keep this module free of browser-only code: it is also loaded on the server.

import { z } from 'zod';
import { env } from '$env/dynamic/public';
import { envBoolean, parseEnv } from '$lib/env-schema.js';

const flags = parseEnv(
  z.object({ PUBLIC_STACKABLE_COCKPIT_STORAGE_TRANSFER_ENABLED: envBoolean(false) }),
  env
);

/** When `PUBLIC_STACKABLE_COCKPIT_STORAGE_TRANSFER_ENABLED=true`, the file
 *  browser offers Cut, Copy, Paste and Rename (context menu and keyboard
 *  shortcuts), and items can be dragged to move them. Also enforced by the
 *  transfer endpoint as cost control: copies and moves list and copy (and, for
 *  moves, delete) every object in the storage backend. Disabled by default. */
export const storageTransferEnabled = flags.PUBLIC_STACKABLE_COCKPIT_STORAGE_TRANSFER_ENABLED;
