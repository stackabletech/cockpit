// Server-side read of cross-cutting feature flags. Read once at module init
// from the live process env so consumers don't repeat the env-name + parsing.

import { env } from '$env/dynamic/private';

/** When `STACKABLE_UI_COMPLETION_ENABLED=true`, the SQL editor's
 *  code-completion provider is registered and the metadata endpoint
 *  accepts requests. Useful to enable enhanced SQL editing features. */
export const completionEnabled = env.STACKABLE_UI_COMPLETION_ENABLED === 'true';

/** When `STACKABLE_UI_STORAGE_BROWSER_ENABLED=true`, the S3/HDFS file
 *  browser is shown in the sidebar and routes under `/storage` become
 *  active. Disabled by default — opt in explicitly to expose storage
 *  credentials and the file-browser UI. */
export const storageBrowserEnabled = env.STACKABLE_UI_STORAGE_BROWSER_ENABLED === 'true';
