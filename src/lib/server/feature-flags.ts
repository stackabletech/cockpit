// Server-side read of cross-cutting feature flags. Read once at module init
// from the live process env so consumers don't repeat the env-name + parsing.

import { env } from '$env/dynamic/private';

/** When `STACKABLE_UI_COMPLETION_DISABLED=true`, the SQL editor's
 *  code-completion provider is not registered and the metadata endpoint
 *  refuses requests. Useful to fall back to plain syntax highlighting if
 *  completion misbehaves or generates undesirable load on Trino. */
export const completionEnabled = env.STACKABLE_UI_COMPLETION_DISABLED !== 'true';

/** When `STACKABLE_UI_STORAGE_BROWSER_DISABLED=true`, the S3/HDFS file
 *  browser is completely hidden from the sidebar and all routes under
 *  `/storage` return 404. Useful to deploy the platform without exposing
 *  storage credentials or when the feature is not yet needed. */
export const storageBrowserEnabled = env.STACKABLE_UI_STORAGE_BROWSER_DISABLED !== 'true';
