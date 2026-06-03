// Server-side read of cross-cutting feature flags. Read once at module init
// from the live process env so consumers don't repeat the env-name + parsing.

import { env } from '$env/dynamic/private';

/** When `STACKABLE_COCKPIT_COMPLETION_ENABLED=false`, the SQL editor's
 *  code-completion provider is not registered and the metadata endpoint
 *  refuses requests. Useful to fall back to plain syntax highlighting if
 *  completion misbehaves or generates undesirable load on Trino. */
export const completionEnabled = env.STACKABLE_COCKPIT_COMPLETION_ENABLED !== 'false';

/** When `STACKABLE_COCKPIT_STORAGE_BROWSER_ENABLED=true`, the S3/HDFS file
 *  browser is shown in the sidebar and routes under `/storage` become
 *  active. Disabled by default — opt in explicitly to expose storage
 *  credentials and the file-browser UI. */
export const storageBrowserEnabled = env.STACKABLE_COCKPIT_STORAGE_BROWSER_ENABLED === 'true';

// ── Storage preview limits ───────────────────────────────────────────────────

/** Maximum bytes fetched when streaming a text, CSV, or JSON file preview.
 *  Controlled by `STACKABLE_COCKPIT_TEXT_PREVIEW_BYTES`. Default: 262144 (256 KiB).
 *  Larger values allow more of a file to be visible in-browser but increase
 *  memory pressure and response latency. */
export const textPreviewBytes =
  parseInt(env.STACKABLE_COCKPIT_TEXT_PREVIEW_BYTES ?? '', 10) || 256 * 1024;

/** Maximum bytes fetched when streaming an image file preview.
 *  Controlled by `STACKABLE_COCKPIT_IMAGE_PREVIEW_BYTES`. Default: 5242880 (5 MiB).
 *  Raise for large high-resolution images; lower to reduce bandwidth on
 *  deployments where storage egress is expensive. */
export const imagePreviewBytes =
  parseInt(env.STACKABLE_COCKPIT_IMAGE_PREVIEW_BYTES ?? '', 10) || 5 * 1024 * 1024;

/** Maximum bytes fetched when streaming a PDF file preview.
 *  Controlled by `STACKABLE_COCKPIT_PDF_PREVIEW_BYTES`. Default: 26214400 (25 MiB).
 *  PDFs typically need several megabytes for the initial pages to render
 *  correctly in the browser PDF viewer. */
export const pdfPreviewBytes =
  parseInt(env.STACKABLE_COCKPIT_PDF_PREVIEW_BYTES ?? '', 10) || 25 * 1024 * 1024;

/** Maximum number of rows included in a file preview that is rendered as a
 *  table (currently: Parquet files converted to CSV).
 *  Controlled by `STACKABLE_COCKPIT_FILE_PREVIEW_ROWS`. Default: 250.
 *  Higher values give more data context but increase server-side S3 reads
 *  and the size of the payload sent to the browser. */
export const filePreviewRows = parseInt(env.STACKABLE_COCKPIT_FILE_PREVIEW_ROWS ?? '', 10) || 250;
