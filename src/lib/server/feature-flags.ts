// Server-side read of cross-cutting feature flags. Read once at module init
// from the live process env so consumers don't repeat the env-name + parsing.

import { env } from '$env/dynamic/private';
import { logger } from '$lib/server/logging';

const log = logger.child({ module: 'feature-flags' });

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
 *  memory pressure and response latency. Only applies to files larger than
 *  `maxEditableFileSize`; editable files are always fetched completely. */
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

/** Maximum number of columns included in a file preview that is rendered as a
 *  table (currently: used by CSV).
 *  Controlled by `STACKABLE_COCKPIT_FILE_PREVIEW_COLUMNS`. Default: 50.
 *  Values only affect client side rendering and not payload size. */
export const filePreviewColumns =
  parseInt(env.STACKABLE_COCKPIT_FILE_PREVIEW_COLUMNS ?? '', 10) || 50;

/** Maximum compressed size of an archive that will be opened for in-browser
 *  preview. Archives larger than this threshold will not be downloaded at all
 *  and a "too large" fallback is shown instead. During listing the total
 *  decompressed entry size is also checked against this limit.
 *  Controlled by `STACKABLE_COCKPIT_ARCHIVE_PREVIEW_MAX_MB`. Default: 100 MB. */
export const archivePreviewMaxBytes =
  parseInt(env.STACKABLE_COCKPIT_ARCHIVE_PREVIEW_MAX_MB ?? '', 10) * 1024 * 1024 ||
  100 * 1024 * 1024;

/** Maximum total size of the archive files cached on local disk (`/tmp`) for
 *  archive previews, nested archives included. When the cache is full, the
 *  least recently used idle archive is evicted; if every cached archive is in
 *  use, the request is rejected. Never lower than twice `archivePreviewMaxBytes`:
 *  a nested archive preview keeps the outer archive cached while the nested one
 *  is written, so it needs room for both.
 *  Controlled by `STACKABLE_COCKPIT_ARCHIVE_CACHE_MAX_MB`. Default: 512 MB. */
export const archiveCacheMaxBytes = resolveArchiveCacheMaxBytes(
  parseInt(env.STACKABLE_COCKPIT_ARCHIVE_CACHE_MAX_MB ?? '', 10) * 1024 * 1024 || 512 * 1024 * 1024,
  archivePreviewMaxBytes
);

export function resolveArchiveCacheMaxBytes(configured: number, previewMaxBytes: number): number {
  const minimum = 2 * previewMaxBytes;
  if (configured >= minimum) return configured;
  log.warn(
    { configured_bytes: configured, minimum_bytes: minimum },
    'archive cache limit is below twice the archive preview limit, raising it'
  );
  return minimum;
}

// ── Parquet preview restrictions ───────────────────────────────────────────

export interface ParquetDisallowedCompression {
  /** Upper-case compression codec name (e.g. `GZIP`, `ZSTD`, `SNAPPY`). */
  codec: string;
  /** When true, only block files using this codec if they lack an offset index. */
  requireOffsetIndex: boolean;
}

export function parseParquetDisallowed(value: string | undefined): ParquetDisallowedCompression[] {
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

// ── Flags shared with the client ─────────────────────────────────────────────
//
// These are `PUBLIC_` settings that the server enforces too. They are defined
// once in `$lib/client/feature-flags` so both sides parse them identically.
//
// `maxEditableFileSize`: save requests above it are rejected with HTTP 413.
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
  maxEditableFileSize,
  storagePasteEnabled,
  storageRenameEnabled,
  storageMoveEnabled
} from '$lib/client/feature-flags.js';

/** Objects copied at once within one transfer request (copy, move, rename).
 *  Controlled by `STACKABLE_COCKPIT_STORAGE_TRANSFER_CONCURRENCY`. Default: 8;
 *  a missing or invalid value falls back to the default. */
export const storageTransferConcurrency: number = (() => {
  // Number() rather than parseInt, so "8x" or "1.5" fall back instead of being truncated.
  const parsed = Number(env.STACKABLE_COCKPIT_STORAGE_TRANSFER_CONCURRENCY?.trim() || NaN);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 8;
})();

// ── Storage browser: downloads ─────────────────────────────────────────────

/** Days that a user's download history remains available. Controlled by
 * `STACKABLE_COCKPIT_DOWNLOAD_HISTORY_RETENTION_DAYS`. */
const retentionDays = Number(env.STACKABLE_COCKPIT_DOWNLOAD_HISTORY_RETENTION_DAYS ?? 30);
if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
  throw new Error(
    'STACKABLE_COCKPIT_DOWNLOAD_HISTORY_RETENTION_DAYS must be an integer between 1 and 3650'
  );
}
export const downloadHistoryRetentionMs = retentionDays * 24 * 60 * 60 * 1000;
