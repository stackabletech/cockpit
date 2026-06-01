// Client-accessible feature flags. These are embedded at build time via
// SvelteKit's $env/static/public and are safe to expose to the browser.
// All variables must be prefixed PUBLIC_.

import { env } from '$env/dynamic/public';

/** When `PUBLIC_STACKABLE_UI_STORAGE_AUTO_CONNECT=true`, the storage page
 *  automatically reconnects to the most recently used connection when the
 *  user navigates to `/storage`. Disabled by default — the user must choose
 *  a connection manually. */
export const storageAutoConnectEnabled =
  (env.PUBLIC_STACKABLE_UI_STORAGE_AUTO_CONNECT ?? 'false') === 'true';

/** When `PUBLIC_STACKABLE_UI_STORAGE_RESTORE_TABS=true`, the file browser
 *  saves open tabs (their name, order, and location) to localStorage and
 *  restores them the next time the user navigates to `/storage`.
 *  Disabled by default. */
export const storageRestoreTabsEnabled =
  (env.PUBLIC_STACKABLE_UI_STORAGE_RESTORE_TABS ?? 'false') === 'true';
