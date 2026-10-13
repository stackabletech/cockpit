import type pino from 'pino';
import type { StorageProvider } from '$lib/server/storage/provider.js';
import { textPreviewBytes, infiniteScrollEnabled } from '$lib/server/feature-flags.js';
import { logger } from '$lib/server/logging';
import { ExpiringCache, previewCacheKey } from './cache.js';

const fallbackLog = logger.child({ module: 'csv-preview' });

// ── In-memory line-offset cache for S3 cost optimisation ──

interface CsvCacheEntry {
  headers: string[];
  /** Byte offset of each data line's first byte (0-based relative to file start, after the header line) */
  lineOffsets: number[];
  /** Total bytes consumed from S3 so far */
  bytesRead: number;
  /** Total file size */
  totalSize: number;
  etag?: string;
  lastAccessed: number;
}

const csvPreviewCache = new ExpiringCache<CsvCacheEntry>();

// ── Helpers ──

async function streamToArrayBuffer(stream: ReadableStream): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result.buffer;
}

/** Parse a single CSV row into fields, handling quoted values. */
function parseCsvRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current);
        current = '';
      } else if (char === '\r') {
        // skip carriage return
      } else {
        current += char;
      }
    }
  }
  result.push(current);
  return result;
}

/**
 * Read a portion of the file from S3 and parse lines, extending the cache entry.
 * Returns the updated entry.
 */
async function extendCache(
  provider: StorageProvider,
  key: string,
  entry: CsvCacheEntry,
  targetRow: number
): Promise<CsvCacheEntry> {
  // Already have enough data
  if (entry.lineOffsets.length >= targetRow) return entry;

  // Determine how many more bytes to read
  const bytesToRead = Math.min(entry.totalSize - entry.bytesRead, textPreviewBytes);
  if (bytesToRead <= 0) return entry;

  const rangeEnd = entry.bytesRead + bytesToRead - 1;
  const stream = await provider.getObjectRange(key, entry.bytesRead, rangeEnd);
  const buffer = await streamToArrayBuffer(stream);
  const bytes = new Uint8Array(buffer);
  const initialOffset = entry.bytesRead;
  let lineStart = 0;
  const consumeLine = (end: number, next: number) => {
    if (entry.headers.length === 0) {
      entry.headers = parseCsvRow(
        new TextDecoder().decode(bytes.subarray(lineStart, end)).replace(/\r$/, '')
      );
    } else {
      entry.lineOffsets.push(initialOffset + lineStart);
    }
    lineStart = next;
    entry.bytesRead = initialOffset + next;
  };
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] === 10) consumeLine(index, index + 1);
  }
  if (initialOffset + bytes.length >= entry.totalSize && lineStart < bytes.length) {
    consumeLine(bytes.length, bytes.length);
  }
  return entry;
}

/** Read exact byte range for a set of rows and return parsed values. */
async function readRows(
  provider: StorageProvider,
  key: string,
  entry: CsvCacheEntry,
  startOffset: number,
  endOffset: number
): Promise<string[][]> {
  const startByte = entry.lineOffsets[startOffset];
  const endByte =
    endOffset < entry.lineOffsets.length ? entry.lineOffsets[endOffset] - 1 : entry.bytesRead - 1;

  if (startByte === undefined || startByte < 0) return [];

  const stream = await provider.getObjectRange(key, startByte, Math.max(startByte, endByte));
  const buffer = await streamToArrayBuffer(stream);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);

  const lines = text.split('\n');
  const rows: string[][] = [];
  for (const line of lines) {
    const trimmed = line.replace(/\r$/, '');
    if (trimmed.length > 0 || rows.length < lines.length - 1) {
      rows.push(parseCsvRow(trimmed));
    }
  }
  return rows;
}

// ── Main entry point ──

/**
 * Get a CSV preview with optional row-based data pagination.
 *
 * When `includeData` is true, returns an NDJSON stream with:
 *   `{t:'h', h:[headers]}` header message
 *   `{t:'r', v:[[row1], [row2], ...]}` row data
 *   `{t:'d'}` done
 *
 * When `includeData` is false, returns only the header message.
 *
 * Uses an in-memory line-offset cache so subsequent range requests read
 * only the exact bytes needed (no redundant S3 reads).
 */
export async function getCsvPreview(
  provider: StorageProvider,
  key: string,
  offset = 0,
  limit = 250,
  totalSize: number,
  requestLog: pino.Logger = fallbackLog,
  includeData = false,
  bucket = '',
  connectionId = ''
): Promise<Response> {
  const log = requestLog.child({ module: 'csv-preview' });
  const metadata = await provider.getMetadata(key);
  totalSize = metadata.size;

  if (totalSize === 0) {
    return new Response(
      JSON.stringify({ t: 'h', h: [], tr: 0 }) + '\n' + JSON.stringify({ t: 'd' }) + '\n',
      {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'X-Preview-Format': 'csv',
          'X-Preview-Renderable': 'true',
          'X-Preview-Infinite-Scroll': String(infiniteScrollEnabled),
          'X-Preview-Total-Size': '0',
          'X-Preview-Total-Rows': '0',
          'X-Preview-Offset': String(offset),
          'Cache-Control': 'no-store'
        }
      }
    );
  }

  const cacheKey = previewCacheKey(connectionId, bucket, key);
  let entry = csvPreviewCache.get(cacheKey);
  const now = Date.now();

  if (!entry || entry.totalSize !== totalSize || entry.etag !== metadata.etag) {
    entry = {
      headers: [],
      lineOffsets: [],
      bytesRead: 0,
      totalSize,
      etag: metadata.etag,
      lastAccessed: now
    };
    csvPreviewCache.set(cacheKey, entry);
  }

  entry.lastAccessed = now;

  const dataEndRow = offset + limit;

  // Extend cache if needed
  await extendCache(provider, key, entry, dataEndRow);

  if (!includeData) {
    return new Response(
      JSON.stringify({ t: 'h', h: entry.headers, tr: entry.lineOffsets.length }) +
        '\n' +
        JSON.stringify({ t: 'd' }) +
        '\n',
      {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'X-Preview-Format': 'csv',
          'X-Preview-Renderable': 'true',
          'X-Preview-Infinite-Scroll': String(infiniteScrollEnabled),
          'X-Preview-Total-Size': String(totalSize),
          'X-Preview-Total-Rows': String(entry.lineOffsets.length),
          'X-Preview-Offset': String(offset),
          'Cache-Control': 'no-store'
        }
      }
    );
  }

  const truncated = entry.lineOffsets.length < totalSize || dataEndRow < entry.lineOffsets.length;
  const actualEndRow = Math.min(dataEndRow, entry.lineOffsets.length);

  let rows: string[][];
  if (offset < entry.lineOffsets.length) {
    rows = await readRows(provider, key, entry, offset, actualEndRow);
  } else {
    rows = [];
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          JSON.stringify({
            t: 'h',
            h: entry.headers,
            tr: entry.lineOffsets.length
          }) + '\n'
        )
      );

      if (rows.length > 0) {
        controller.enqueue(encoder.encode(JSON.stringify({ t: 'r', v: rows }) + '\n'));
      }

      controller.enqueue(encoder.encode(JSON.stringify({ t: 'd' }) + '\n'));
      controller.close();
    },
    cancel() {
      // client disconnected
    }
  });

  log.info(
    { key, offset, limit, rows_returned: rows.length, total_file_size: totalSize, truncated },
    'csv preview chunk'
  );

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'X-Preview-Format': 'csv',
      'X-Preview-Renderable': 'true',
      'X-Preview-Infinite-Scroll': String(infiniteScrollEnabled),
      'X-Preview-Truncated': String(truncated),
      'X-Preview-Total-Size': String(totalSize),
      'X-Preview-Total-Rows': String(entry.lineOffsets.length),
      'X-Preview-Offset': String(offset),
      'Cache-Control': 'no-store'
    }
  });
}
