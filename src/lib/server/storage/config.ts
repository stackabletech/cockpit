// Storage browser settings: limits and tuning, not feature toggles (those are
// in `$lib/server/feature-flags`). Parsed once at module init.

import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { envInteger, envList, envString, parseEnv } from '$lib/env-schema.js';
import { logger } from '$lib/server/logging';

const log = logger.child({ module: 'storage-config' });

const MB = 1024 * 1024;

export interface ParquetDisallowedCompression {
  /** Upper-case compression codec name (e.g. `GZIP`, `ZSTD`, `SNAPPY`). */
  codec: string;
  /** When true, only block files using this codec if they lack an offset index. */
  requireOffsetIndex: boolean;
}

function toParquetDisallowed(entry: string): ParquetDisallowedCompression {
  if (entry.endsWith('-no_offset')) {
    return { codec: entry.slice(0, -'-no_offset'.length).toUpperCase(), requireOffsetIndex: true };
  }
  return { codec: entry.toUpperCase(), requireOffsetIndex: false };
}

const schema = z.object({
  STACKABLE_COCKPIT_TEXT_PREVIEW_BYTES: envInteger(256 * 1024),
  STACKABLE_COCKPIT_IMAGE_PREVIEW_BYTES: envInteger(5 * MB),
  STACKABLE_COCKPIT_PDF_PREVIEW_BYTES: envInteger(25 * MB),
  STACKABLE_COCKPIT_FILE_PREVIEW_ROWS: envInteger(250),
  STACKABLE_COCKPIT_FILE_PREVIEW_COLUMNS: envInteger(50),
  STACKABLE_COCKPIT_ARCHIVE_PREVIEW_MAX_MB: envInteger(100),
  STACKABLE_COCKPIT_ARCHIVE_CACHE_MAX_MB: envInteger(512),
  STACKABLE_COCKPIT_PARQUET_PREVIEW_DISALLOWED_COMPRESSION_TYPES: envList(['gzip-no_offset']),
  STACKABLE_COCKPIT_STORAGE_TRANSFER_CONCURRENCY: envInteger(8),
  STACKABLE_COCKPIT_DOWNLOAD_HISTORY_RETENTION_DAYS: envInteger(30, { max: 3650 }),
  STACKABLE_COCKPIT_STORAGE_TLS_CA_CERT: envString
});

function resolveArchiveCacheMaxBytes(configured: number, previewMaxBytes: number): number {
  const minimum = 2 * previewMaxBytes;
  if (configured >= minimum) return configured;
  log.warn(
    { configured_bytes: configured, minimum_bytes: minimum },
    'archive cache limit is below twice the archive preview limit, raising it'
  );
  return minimum;
}

export function parseStorageConfig(env: Record<string, string | undefined>) {
  const config = parseEnv(schema, env);
  const archivePreviewMaxBytes = config.STACKABLE_COCKPIT_ARCHIVE_PREVIEW_MAX_MB * MB;
  return {
    textPreviewBytes: config.STACKABLE_COCKPIT_TEXT_PREVIEW_BYTES,
    imagePreviewBytes: config.STACKABLE_COCKPIT_IMAGE_PREVIEW_BYTES,
    pdfPreviewBytes: config.STACKABLE_COCKPIT_PDF_PREVIEW_BYTES,
    filePreviewRows: config.STACKABLE_COCKPIT_FILE_PREVIEW_ROWS,
    filePreviewColumns: config.STACKABLE_COCKPIT_FILE_PREVIEW_COLUMNS,
    archivePreviewMaxBytes,
    archiveCacheMaxBytes: resolveArchiveCacheMaxBytes(
      config.STACKABLE_COCKPIT_ARCHIVE_CACHE_MAX_MB * MB,
      archivePreviewMaxBytes
    ),
    parquetDisallowedCompression:
      config.STACKABLE_COCKPIT_PARQUET_PREVIEW_DISALLOWED_COMPRESSION_TYPES.map(
        toParquetDisallowed
      ),
    storageTransferConcurrency: config.STACKABLE_COCKPIT_STORAGE_TRANSFER_CONCURRENCY,
    downloadHistoryRetentionMs:
      config.STACKABLE_COCKPIT_DOWNLOAD_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    tlsCaCertPath: config.STACKABLE_COCKPIT_STORAGE_TLS_CA_CERT
  };
}

const config = parseStorageConfig(env);

// ── Preview limits ───────────────────────────────────────────────────────────

/** Maximum bytes fetched when streaming a text, CSV, or JSON file preview.
 *  Only applies to files larger than `maxEditableFileSize`; editable files are
 *  always fetched completely.
 *  Controlled by `STACKABLE_COCKPIT_TEXT_PREVIEW_BYTES`. Default: 262144 (256 KiB). */
export const textPreviewBytes = config.textPreviewBytes;

/** Maximum bytes fetched when streaming an image file preview.
 *  Controlled by `STACKABLE_COCKPIT_IMAGE_PREVIEW_BYTES`. Default: 5242880 (5 MiB). */
export const imagePreviewBytes = config.imagePreviewBytes;

/** Maximum bytes fetched when streaming a PDF file preview. PDFs typically need
 *  several megabytes for the initial pages to render in the browser PDF viewer.
 *  Controlled by `STACKABLE_COCKPIT_PDF_PREVIEW_BYTES`. Default: 26214400 (25 MiB). */
export const pdfPreviewBytes = config.pdfPreviewBytes;

/** Maximum number of rows included in a file preview that is rendered as a
 *  table (currently: Parquet files converted to CSV).
 *  Controlled by `STACKABLE_COCKPIT_FILE_PREVIEW_ROWS`. Default: 250. */
export const filePreviewRows = config.filePreviewRows;

/** Maximum number of columns included in a file preview that is rendered as a
 *  table (currently: used by CSV). Only affects client-side rendering, not the
 *  payload size.
 *  Controlled by `STACKABLE_COCKPIT_FILE_PREVIEW_COLUMNS`. Default: 50. */
export const filePreviewColumns = config.filePreviewColumns;

/** Maximum compressed size of an archive that will be opened for in-browser
 *  preview. Larger archives are not downloaded at all and a "too large"
 *  fallback is shown instead. During listing the total decompressed entry size
 *  is also checked against this limit.
 *  Controlled by `STACKABLE_COCKPIT_ARCHIVE_PREVIEW_MAX_MB`. Default: 100 MB. */
export const archivePreviewMaxBytes = config.archivePreviewMaxBytes;

/** Maximum total size of the archive files cached on local disk (`/tmp`) for
 *  archive previews, nested archives included. When the cache is full, the
 *  least recently used idle archive is evicted; if every cached archive is in
 *  use, the request is rejected. Never lower than twice `archivePreviewMaxBytes`:
 *  a nested archive preview keeps the outer archive cached while the nested one
 *  is written, so it needs room for both.
 *  Controlled by `STACKABLE_COCKPIT_ARCHIVE_CACHE_MAX_MB`. Default: 512 MB. */
export const archiveCacheMaxBytes = config.archiveCacheMaxBytes;

/** Compression types excluded from Parquet data preview. Each comma-separated
 *  entry is a codec name (e.g. `gzip`, `zstd`, `snappy`), or a codec suffixed
 *  with `-no_offset` (e.g. `gzip-no_offset`) to only block files that lack an
 *  offset index.
 *  Controlled by `STACKABLE_COCKPIT_PARQUET_PREVIEW_DISALLOWED_COMPRESSION_TYPES`.
 *  Default: `gzip-no_offset`. */
export const parquetDisallowedCompression = config.parquetDisallowedCompression;

// ── Transfers and downloads ──────────────────────────────────────────────────

/** Objects copied at once within one transfer request (copy, move, rename).
 *  Controlled by `STACKABLE_COCKPIT_STORAGE_TRANSFER_CONCURRENCY`. Default: 8. */
export const storageTransferConcurrency = config.storageTransferConcurrency;

/** How long a user's download history remains available. Controlled by
 *  `STACKABLE_COCKPIT_DOWNLOAD_HISTORY_RETENTION_DAYS` (1 to 3650). Default: 30 days. */
export const downloadHistoryRetentionMs = config.downloadHistoryRetentionMs;

// ── Connections ──────────────────────────────────────────────────────────────

/** Path to a CA certificate for S3 connections with TLS verification. It
 *  replaces the CAs bundled with Node.js.
 *  Controlled by `STACKABLE_COCKPIT_STORAGE_TLS_CA_CERT`. */
export const storageTlsCaCertPath = config.tlsCaCertPath;

// Shared with the client, which hides the save button above it; the save
// endpoint rejects larger saves with HTTP 413.
export { maxEditableFileSize } from '$lib/client/config.js';
