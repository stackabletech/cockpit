import { gunzipSync } from 'node:zlib';
import { parquetMetadataAsync, parquetReadObjects, parquetSchema } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import type pino from 'pino';
import type { StorageProvider } from '$lib/server/storage/provider.js';

/** Maximum rows to include in a parquet preview. */
const PARQUET_PREVIEW_ROWS = 250;

/**
 * Override the pure-JS GZIP decompressor from hyparquet-compressors with
 * Node's native zlib binding — orders of magnitude faster for large payloads.
 */
const nodeCompressors = {
  ...compressors,
  GZIP: (input: Uint8Array, _outputLength: number): Uint8Array => new Uint8Array(gunzipSync(input))
};

/** Read a ReadableStream into an ArrayBuffer. */
async function streamToArrayBuffer(stream: ReadableStream): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
  }
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result.buffer;
}

/** Serialise a parquet cell value to a string suitable for CSV embedding. */
function formatParquetValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Escape a single CSV field (RFC 4180). */
function escapeCSVField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
    return '"' + field.replace(/"/g, '""') + '"';
  }
  return field;
}

export async function parquetPreview(
  provider: StorageProvider,
  key: string,
  totalSize: number,
  userId: string,
  log: pino.Logger
): Promise<Response> {
  // ── Step 1: footer (serial, ≤ 2 range requests) ────────────────────────
  // hyparquet fetches the last 512 KB first; if the footer is larger it
  // makes a second request. Serial avoids ETIMEDOUT.
  let footerQueue: Promise<void> = Promise.resolve();
  const footerBuffer = {
    byteLength: totalSize,
    slice: (start: number, end?: number): Promise<ArrayBuffer> => {
      const rangeEnd = end !== undefined ? end - 1 : totalSize - 1;
      const req = footerQueue.then(async () => {
        const stream = await provider.getObjectRange(key, start, rangeEnd);
        return streamToArrayBuffer(stream as ReadableStream);
      });
      footerQueue = req.then(
        () => {},
        () => {}
      );
      return req;
    }
  };

  const parquetMeta = await parquetMetadataAsync(footerBuffer);
  const totalRows = Number(parquetMeta.num_rows);
  const previewRows = Math.min(totalRows, PARQUET_PREVIEW_ROWS);
  const truncated = previewRows < totalRows;
  const schema = parquetSchema(parquetMeta);
  const columnNames = schema.children.map((e) => e.element.name);

  // ── Step 2: pre-fetch OffsetIndex in ONE merged range request ───────────
  // OffsetIndex entries for all columns are stored contiguously near the
  // end of the file (written just before the file metadata). Fetching them
  // together eliminates one S3 round-trip per column (~30 saved requests).
  let oiMin = Infinity;
  let oiMax = 0;
  let rowsScanned = 0;
  for (const rg of parquetMeta.row_groups) {
    if (rowsScanned >= previewRows) break;
    rowsScanned += Number(rg.num_rows);
    for (const col of rg.columns) {
      if (col.offset_index_offset && col.offset_index_length) {
        const s = Number(col.offset_index_offset);
        const e = s + col.offset_index_length;
        if (s < oiMin) oiMin = s;
        if (e > oiMax) oiMax = e;
      }
    }
  }
  let oiCache: { start: number; buf: ArrayBuffer } | null = null;
  if (isFinite(oiMin)) {
    const oiStream = await provider.getObjectRange(key, oiMin, oiMax - 1);
    oiCache = { start: oiMin, buf: await streamToArrayBuffer(oiStream as ReadableStream) };
    log.debug({ user_id: userId, key, oi_bytes: oiMax - oiMin }, 'parquet OffsetIndex pre-fetched');
  }

  // ── Step 3: concurrency-limited buffer for data page reads ──────────────
  // prefetchAsyncBuffer inside hyparquet calls file.slice() for every fetch
  // in one synchronous pass. Limit to 4 concurrent S3 connections to stay
  // well below the threshold that triggers ETIMEDOUT on the S3 endpoint,
  // while being 4× faster than serial (30 pages / 4 = 8 batches × ~1.5s).
  const CONCURRENCY = 4;
  let running = 0;
  const waiters: Array<() => void> = [];
  const acquire = (): Promise<void> =>
    running < CONCURRENCY
      ? (running++, Promise.resolve())
      : new Promise((resolve) => waiters.push(resolve));
  const release = () => {
    const next = waiters.shift();
    if (next) next();
    else running--;
  };

  const asyncBuffer = {
    byteLength: totalSize,
    slice: (start: number, end?: number): Promise<ArrayBuffer> => {
      const rangeEnd = end ?? totalSize;
      // Serve OffsetIndex reads from the pre-fetched in-memory cache.
      if (oiCache && start >= oiCache.start && rangeEnd <= oiCache.start + oiCache.buf.byteLength) {
        return Promise.resolve(oiCache.buf.slice(start - oiCache.start, rangeEnd - oiCache.start));
      }
      // All other reads (data pages): rate-limited S3 range request.
      return acquire().then(async () => {
        try {
          const stream = await provider.getObjectRange(key, start, rangeEnd - 1);
          return await streamToArrayBuffer(stream as ReadableStream);
        } finally {
          release();
        }
      });
    }
  };

  // useOffsetIndex: true — fetch only the specific pages covering the first
  // previewRows rows (requires OffsetIndex in file; falls back to full column
  // chunks if absent, which is unavoidable without page-level metadata).
  const rows = await parquetReadObjects({
    file: asyncBuffer,
    metadata: parquetMeta,
    rowEnd: previewRows,
    useOffsetIndex: true,
    compressors: nodeCompressors
  });

  const csvLines = [
    columnNames.map(escapeCSVField).join(','),
    ...rows.map((row) =>
      columnNames.map((col) => escapeCSVField(formatParquetValue(row[col]))).join(',')
    )
  ];
  const csvText = csvLines.join('\n');

  log.info(
    {
      user_id: userId,
      key,
      total_rows: totalRows,
      preview_rows: previewRows,
      truncated
    },
    'parquet preview ready'
  );

  return new Response(csvText, {
    headers: {
      'Content-Type': 'text/csv',
      'X-Preview-Format': 'parquet',
      'X-Preview-Renderable': 'true',
      'X-Preview-Truncated': String(truncated),
      'X-Preview-Total-Size': String(totalSize),
      'X-Preview-Total-Rows': String(totalRows),
      'X-Preview-Preview-Rows': String(previewRows),
      'Cache-Control': 'no-store'
    }
  });
}
