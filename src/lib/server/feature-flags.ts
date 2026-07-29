// Server-side read of cross-cutting feature flags. Read once at module init
// from the live process env so consumers don't repeat the env-name + parsing.

import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

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

// ── Infinite scroll preview ───────────────────────────────────────────────────

/** When `STACKABLE_COCKPIT_INFINITE_SCROLL_ENABLED=false`, the CSV and Parquet
 *  file previews load a fixed number of rows without virtual scrolling / infinite
 *  loading. Enabled by default — the previews fetch row chunks lazily as the
 *  user scrolls, reducing S3 costs and browser memory for large files.
 *  Controlled by `STACKABLE_COCKPIT_INFINITE_SCROLL_ENABLED`. Default: `true`. */
export const infiniteScrollEnabled =
  env.PUBLIC_STACKABLE_COCKPIT_INFINITE_SCROLL_ENABLED !== 'false';

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

/** Maximum compressed size of an archive that will be opened for in-browser
 *  preview. Archives larger than this threshold will not be downloaded at all
 *  and a "too large" fallback is shown instead. During listing the total
 *  decompressed entry size is also checked against this limit.
 *  Controlled by `STACKABLE_COCKPIT_ARCHIVE_PREVIEW_MAX_MB`. Default: 100 MB. */
export const archivePreviewMaxBytes =
  parseInt(env.STACKABLE_COCKPIT_ARCHIVE_PREVIEW_MAX_MB ?? '', 10) * 1024 * 1024 ||
  100 * 1024 * 1024;

// ── Parquet preview restrictions ───────────────────────────────────────────

export interface ParquetDisallowedCompression {
  /** Upper-case compression codec name (e.g. `GZIP`, `ZSTD`, `SNAPPY`). */
  codec: string;
  /** When true, only block files using this codec if they lack an offset index. */
  requireOffsetIndex: boolean;
}

function parseParquetDisallowed(value: string | undefined): ParquetDisallowedCompression[] {
  if (!value) return [{ codec: 'GZIP', requireOffsetIndex: true }];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry.endsWith('-no_offset')) {
        return {
          codec: entry.slice(0, -'-no_offset'.length).toUpperCase(),
          requireOffsetIndex: true
        };
      }
      return { codec: entry.toUpperCase(), requireOffsetIndex: false };
    });
}

/** Comma-separated list of compression types to disallow from parquet
 *  data preview. Each entry is either a compression codec name (e.g. `gzip`,
 *  `zstd`, `snappy`) or a codec suffixed with `-no_offset` (e.g.
 *  `gzip-no_offset`) to only block when the file lacks an offset index.
 *  Controlled by `STACKABLE_COCKPIT_PARQUET_PREVIEW_DISALLOWED_COMPRESSION_TYPES`.
 *  Default: `gzip-no_offset`. */
export const parquetDisallowedCompression = parseParquetDisallowed(
  env.STACKABLE_COCKPIT_PARQUET_PREVIEW_DISALLOWED_COMPRESSION_TYPES ?? 'gzip-no_offset'
);

// ── Storage browser: Text editor ─────────────────────────────────────────────

/** Maximum file size (in bytes) that may be saved via the inline text editor.
 *  Files with an `originalSize` exceeding this limit are treated as read-only
 *  and save requests are rejected with HTTP 413. Mirrors the client-side flag
 *  `maxEditableFileSize` so that the restriction is enforced even if the client
 *  check is bypassed.
 *  Controlled by `PUBLIC_STACKABLE_COCKPIT_MAX_EDITABLE_FILE_SIZE`. Default: 5242880 (5 MiB). */
export const maxEditableFileSize: number = (() => {
  const parsed = parseInt(publicEnv.PUBLIC_STACKABLE_COCKPIT_MAX_EDITABLE_FILE_SIZE ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 1024 * 1024;
})();

// ── Storage browser: Context actions (cut, copy, paste, rename) ────────────

/** When `PUBLIC_STACKABLE_COCKPIT_STORAGE_CUT_COPY_ENABLED=true`, the context
 *  menu shows Cut/Copy actions. Uses the PUBLIC_ key so the same env var gates
 *  both client and server. Disabled by default. */
export const storageCutCopyEnabled =
  (publicEnv.PUBLIC_STACKABLE_COCKPIT_STORAGE_CUT_COPY_ENABLED ?? 'false') === 'true';

/** When `PUBLIC_STACKABLE_COCKPIT_STORAGE_PASTE_ENABLED=true`, the context
 *  menu shows Paste and the paste API endpoint is active.
 *  Uses PUBLIC_ key. Disabled by default. */
export const storagePasteEnabled =
  (publicEnv.PUBLIC_STACKABLE_COCKPIT_STORAGE_PASTE_ENABLED ?? 'false') === 'true';

/** When `PUBLIC_STACKABLE_COCKPIT_STORAGE_RENAME_ENABLED=true`, the rename
 *  API endpoint is active. Uses PUBLIC_ key. Disabled by default. */
export const storageRenameEnabled =
  (publicEnv.PUBLIC_STACKABLE_COCKPIT_STORAGE_RENAME_ENABLED ?? 'false') === 'true';

/** When `PUBLIC_STACKABLE_COCKPIT_STORAGE_MOVE_ENABLED=true`, the move
 *  API endpoint (drag-and-drop) is active. Uses PUBLIC_ key. Disabled by default. */
export const storageMoveEnabled =
  (publicEnv.PUBLIC_STACKABLE_COCKPIT_STORAGE_MOVE_ENABLED ?? 'false') === 'true';
