import { gunzipSync } from 'node:zlib';
import {
  parquetMetadataAsync,
  parquetReadObjects,
  parquetSchema,
  type FileMetaData
} from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import type pino from 'pino';
import { logger } from '$lib/server/logging';
import type { StorageProvider } from '$lib/server/storage/provider.js';

interface ParquetPreviewPayload {
  headers: string[];
  rows: unknown[][];
  totalRows: number;
}

const fallbackLog = logger.child({ module: 'parquet-preview' });

const nodeCompressors = {
  ...compressors,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  GZIP: (input: Uint8Array, _outputLength: number): Uint8Array => new Uint8Array(gunzipSync(input))
};

// --- IN-MEMORY CACHE FOR PAGINATION ---
interface CacheEntry {
  meta: FileMetaData;
  indexCache: { start: number; buffer: ArrayBuffer } | null;
  lastAccessed: number;
}
const metadataCache = new Map<string, CacheEntry>();

// Clean up memory cache periodically (TTL: 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of metadataCache.entries()) {
    if (now - entry.lastAccessed > 5 * 60 * 1000) {
      metadataCache.delete(key);
    }
  }
}, 60 * 1000).unref();
// ---------------------------------------

function stringifyStructuredParquetValue(value: object): string {
  return JSON.stringify(value, (_key, nestedValue: unknown) => {
    if (typeof nestedValue === 'bigint') return nestedValue.toString();
    if (nestedValue instanceof Date) return nestedValue.toISOString();
    if (nestedValue instanceof Uint8Array) return Array.from(nestedValue);
    return nestedValue;
  });
}

function toSerializableParquetCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Array.from(value).join(',');
  if (Array.isArray(value) || typeof value === 'object')
    return stringifyStructuredParquetValue(value as object);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string')
    return value;
  return String(value);
}

function createParquetPreviewResponse(
  payload: ParquetPreviewPayload,
  totalSize: number,
  previewRows: number,
  offset: number
): Response {
  return Response.json(payload, {
    headers: {
      'X-Preview-Format': 'parquet',
      'X-Preview-Renderable': 'true',
      'X-Preview-Truncated': String(payload.totalRows > offset + previewRows),
      'X-Preview-Total-Size': String(totalSize),
      'X-Preview-Total-Rows': String(payload.totalRows),
      'X-Preview-Offset': String(offset),
      'Cache-Control': 'no-store'
    }
  });
}

async function streamToArrayBuffer(stream: ReadableStream): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
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

export async function getParquetPreview(
  provider: StorageProvider,
  key: string,
  offset = 0,
  limit = 250,
  requestLog: pino.Logger = fallbackLog,
  totalSize?: number
): Promise<Response> {
  const log = requestLog.child({ module: 'parquet-preview' });
  const byteLength = totalSize ?? (await provider.getMetadata(key)).size;

  if (byteLength === 0) {
    return createParquetPreviewResponse(
      { headers: [], rows: [], totalRows: 0 },
      byteLength,
      0,
      offset
    );
  }

  let parquetMeta: FileMetaData;
  let offsetIndexCache: { start: number; buffer: ArrayBuffer } | null = null;

  // 1. Check in-memory Cache to avoid re-fetching footer and indexes during scroll
  const cached = metadataCache.get(key);
  if (cached) {
    cached.lastAccessed = Date.now();
    parquetMeta = cached.meta;
    offsetIndexCache = cached.indexCache;
    log.debug({ key }, 'Used in-memory cached Parquet metadata');
  } else {
    let footerQueue: Promise<void> = Promise.resolve();
    const footerBuffer = {
      byteLength,
      slice: (start: number, end?: number): Promise<ArrayBuffer> => {
        const rangeEnd = end !== undefined ? end - 1 : byteLength - 1;
        const request = footerQueue.then(async () => {
          const stream = await provider.getObjectRange(key, start, rangeEnd);
          return streamToArrayBuffer(stream as ReadableStream);
        });
        footerQueue = request.then(
          () => {},
          () => {}
        );
        return request;
      }
    };

    parquetMeta = await parquetMetadataAsync(footerBuffer);

    let offsetIndexStart = Infinity;
    let offsetIndexEnd = 0;

    // Scan ALL row groups to cache full file indices for instant pagination
    for (const rowGroup of parquetMeta.row_groups) {
      for (const column of rowGroup.columns) {
        if (column.offset_index_offset && column.offset_index_length) {
          const start = Number(column.offset_index_offset);
          const end = start + column.offset_index_length;
          if (start < offsetIndexStart) offsetIndexStart = start;
          if (end > offsetIndexEnd) offsetIndexEnd = end;
        }
        if (column.column_index_offset && column.column_index_length) {
          const start = Number(column.column_index_offset);
          const end = start + column.column_index_length;
          if (start < offsetIndexStart) offsetIndexStart = start;
          if (end > offsetIndexEnd) offsetIndexEnd = end;
        }
      }
    }

    const indexSpan = offsetIndexEnd - offsetIndexStart;
    if (isFinite(offsetIndexStart) && indexSpan <= 10 * 1024 * 1024) {
      const stream = await provider.getObjectRange(key, offsetIndexStart, offsetIndexEnd - 1);
      offsetIndexCache = {
        start: offsetIndexStart,
        buffer: await streamToArrayBuffer(stream as ReadableStream)
      };
      log.debug({ key, index_bytes: indexSpan }, 'Parquet indices prefetched and cached');
    }

    metadataCache.set(key, {
      meta: parquetMeta,
      indexCache: offsetIndexCache,
      lastAccessed: Date.now()
    });
  }

  try {
    const totalRows = Number(parquetMeta.num_rows);
    const headers = parquetSchema(parquetMeta).children.map((entry) => entry.element.name);

    const actualLimit = Math.min(limit, Math.max(0, totalRows - offset));
    if (actualLimit <= 0) {
      return createParquetPreviewResponse({ headers, rows: [], totalRows }, byteLength, 0, offset);
    }

    const concurrency = 4;
    let active = 0;
    const waiters: Array<() => void> = [];
    const acquire = (): Promise<void> => {
      if (active < concurrency) {
        active += 1;
        return Promise.resolve();
      }
      return new Promise((resolve) => waiters.push(resolve));
    };
    const release = () => {
      const next = waiters.shift();
      if (next) return next();
      active -= 1;
    };

    const asyncFile = {
      byteLength,
      slice: (start: number, end?: number): Promise<ArrayBuffer> => {
        const rangeEnd = end ?? byteLength;
        const MAX_PREVIEW_FETCH_BYTES = 1 * 1024 * 1024; // 1MB chunk cap
        let actualEnd = rangeEnd;

        if (actualEnd - start > MAX_PREVIEW_FETCH_BYTES) {
          actualEnd = start + MAX_PREVIEW_FETCH_BYTES;
          log.trace({ key, capped: actualEnd - start }, 'Capped massive parquet chunk read');
        }

        if (
          offsetIndexCache &&
          start >= offsetIndexCache.start &&
          actualEnd <= offsetIndexCache.start + offsetIndexCache.buffer.byteLength
        ) {
          return Promise.resolve(
            offsetIndexCache.buffer.slice(
              start - offsetIndexCache.start,
              actualEnd - offsetIndexCache.start
            )
          );
        }

        return acquire().then(async () => {
          try {
            const stream = await provider.getObjectRange(key, start, actualEnd - 1);
            return await streamToArrayBuffer(stream as ReadableStream);
          } finally {
            release();
          }
        });
      }
    };

    const rowObjects = await parquetReadObjects({
      file: asyncFile,
      metadata: parquetMeta,
      rowStart: offset, // Tell hyparquet to start reading from the requested chunk
      rowEnd: offset + actualLimit, // Stop reading at chunk limit
      useOffsetIndex: true,
      compressors: nodeCompressors
    });

    const rows = rowObjects.map((row) => {
      const valueMap = new Map(Object.entries(row as Record<string, unknown>));
      return headers.map((header) => toSerializableParquetCell(valueMap.get(header)));
    });

    return createParquetPreviewResponse(
      { headers, rows, totalRows },
      byteLength,
      rows.length,
      offset
    );
  } catch (error) {
    log.error({ err: error, key }, 'Failed to parse Parquet chunk');
    return createParquetPreviewResponse(
      { headers: [], rows: [], totalRows: 0 },
      byteLength,
      0,
      offset
    );
  }
}
