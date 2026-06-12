import { gunzipSync } from 'node:zlib';
import { parquetMetadataAsync, parquetRead, parquetSchema, type FileMetaData } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import type pino from 'pino';
import { logger } from '$lib/server/logging';
import type { StorageProvider } from '$lib/server/storage/provider.js';

const fallbackLog = logger.child({ module: 'parquet-preview' });

const nodeCompressors = {
  ...compressors,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  GZIP: (input: Uint8Array, _outputLength: number): Uint8Array => new Uint8Array(gunzipSync(input))
};

// --- IN-MEMORY CACHE FOR METADATA ---
const metadataCache = new Map<string, { meta: FileMetaData; lastAccessed: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of metadataCache.entries()) {
    if (now - entry.lastAccessed > 5 * 60 * 1000) {
      metadataCache.delete(key);
    }
  }
}, 60 * 1000).unref();
// -------------------------------------

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
    return new Response(JSON.stringify({ t: 'h', h: [], tr: 0 }) + '\n', {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'X-Preview-Format': 'parquet',
        'X-Preview-Renderable': 'true',
        'X-Preview-Total-Size': '0',
        'X-Preview-Total-Rows': '0',
        'X-Preview-Offset': String(offset),
        'Cache-Control': 'no-store'
      }
    });
  }

  let parquetMeta: FileMetaData;

  const cached = metadataCache.get(key);
  if (cached) {
    cached.lastAccessed = Date.now();
    parquetMeta = cached.meta;
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

    metadataCache.set(key, {
      meta: parquetMeta,
      lastAccessed: Date.now()
    });
  }

  const totalRows = Number(parquetMeta.num_rows);
  const headers = parquetSchema(parquetMeta).children.map((entry) => entry.element.name);

  const actualLimit = Math.min(limit, Math.max(0, totalRows - offset));

  if (actualLimit <= 0) {
    return new Response(JSON.stringify({ t: 'h', h: headers, tr: totalRows }) + '\n', {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'X-Preview-Format': 'parquet',
        'X-Preview-Renderable': 'true',
        'X-Preview-Truncated': 'false',
        'X-Preview-Total-Size': String(byteLength),
        'X-Preview-Total-Rows': String(totalRows),
        'X-Preview-Offset': String(offset),
        'Cache-Control': 'no-store'
      }
    });
  }

  const requestedEnd = offset + actualLimit;

  // Pre-fetch up to MAX_PREVIEW_FETCH_BYTES from the start of the file.
  // For the common case (data of the first row group fits within the limit),
  // this means hyparquet reads entirely from memory — only 2 HTTP requests
  // total (footer + this).  When column data extends beyond the limit,
  // individual slice() calls fall through to per-request HTTP fetches
  // (bounded by useOffsetIndex to only pages needed for the requested rows).
  const MAX_PREVIEW_FETCH_BYTES = 5 * 1024 * 1024; // magic number: amount of data in column to load
  const previewLimit = Math.min(MAX_PREVIEW_FETCH_BYTES, byteLength);

  /** In-memory buffer plus any extra ranges fetched for out-of-preview data. */
  const bufferCache: Array<{ start: number; buffer: ArrayBuffer }> = [];

  if (previewLimit > 0) {
    const stream = await provider.getObjectRange(key, 0, previewLimit - 1);
    bufferCache.push({ start: 0, buffer: await streamToArrayBuffer(stream as ReadableStream) });
  }

  // Also fetch exact byte spans for any row groups whose data starts beyond
  // the preview limit, so we don't degrade to per-slice HTTP for those.
  const extraFetches: Array<{ start: number; end: number }> = [];
  let groupRowStart = 0;
  for (const rowGroup of parquetMeta.row_groups) {
    const groupRows = Number(rowGroup.num_rows);
    const groupRowEnd = groupRowStart + groupRows;

    if (groupRowEnd > offset && groupRowStart < requestedEnd) {
      let minByte = Infinity;
      let maxByte = -Infinity;

      for (const column of rowGroup.columns) {
        const meta = column.meta_data;
        if (!meta) continue;

        const colStart = Number(meta.dictionary_page_offset ?? meta.data_page_offset);
        const colEnd = colStart + Number(meta.total_compressed_size);
        if (colStart < minByte) minByte = colStart;
        if (colEnd > maxByte) maxByte = colEnd;

        if (column.offset_index_offset != null && column.offset_index_length != null) {
          const offEnd = Number(column.offset_index_offset) + Number(column.offset_index_length);
          if (offEnd > maxByte) maxByte = offEnd;
        }
        if (column.column_index_offset != null && column.column_index_length != null) {
          const ciEnd = Number(column.column_index_offset) + Number(column.column_index_length);
          if (ciEnd > maxByte) maxByte = ciEnd;
        }
      }

      if (isFinite(minByte) && maxByte > minByte && minByte >= previewLimit) {
        extraFetches.push({ start: minByte, end: maxByte });
      }
    }

    groupRowStart = groupRowEnd;
  }

  if (extraFetches.length > 0) {
    const results = await Promise.all(
      extraFetches.map((r) =>
        provider
          .getObjectRange(key, r.start, r.end - 1)
          .then((s) => streamToArrayBuffer(s as ReadableStream))
          .then((buf) => ({ start: r.start, buffer: buf }))
      )
    );
    bufferCache.push(...results);
  }

  const asyncFile = {
    byteLength,
    slice: async (_start: number, _end?: number): Promise<ArrayBuffer> => {
      const end = _end ?? byteLength;
      for (const { start, buffer } of bufferCache) {
        const bufEnd = start + buffer.byteLength;
        if (_start >= start && end <= bufEnd) {
          return buffer.slice(_start - start, end - start);
        }
      }
      const stream = await provider.getObjectRange(key, _start, end - 1);
      return streamToArrayBuffer(stream as ReadableStream);
    }
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send headers immediately
      controller.enqueue(
        encoder.encode(JSON.stringify({ t: 'h', h: headers, tr: totalRows }) + '\n')
      );

      // Use parquetRead with onChunk to stream columns as they load.
      // Trim columnData to the requested [offset, requestedEnd) range because
      // hyparquet's onChunk fires with page-granularity data that can include
      // rows outside the requested range (intra-page trimming only happens in
      // asyncGroupToRows called by onComplete, not in onChunk).
      const readPromise = parquetRead({
        file: asyncFile,
        metadata: parquetMeta,
        rowStart: offset,
        rowEnd: requestedEnd,
        useOffsetIndex: true,
        compressors: nodeCompressors,
        rowFormat: 'object',
        onChunk: ({ columnName, columnData, rowStart: chunkStart, rowEnd: chunkEnd }) => {
          try {
            const trimStart = Math.max(0, offset - chunkStart);
            const trimEnd = Math.max(0, chunkEnd - requestedEnd);
            const sliced =
              trimStart > 0 || trimEnd > 0
                ? columnData.slice(trimStart, columnData.length - trimEnd)
                : columnData;
            const values = Array.from(sliced, (v: unknown) => toSerializableParquetCell(v));
            controller.enqueue(
              encoder.encode(JSON.stringify({ t: 'c', n: columnName, v: values }) + '\n')
            );
          } catch (err) {
            log.error({ err, key, column: columnName }, 'Error serializing parquet column chunk');
          }
        },
        onComplete: () => {
          try {
            controller.enqueue(encoder.encode(JSON.stringify({ t: 'd' }) + '\n'));
            controller.close();
          } catch {
            // stream already closed (e.g. client disconnected)
          }
        }
      });

      readPromise.catch((err) => {
        log.error({ err, key }, 'Failed to parse Parquet chunk');
        try {
          controller.enqueue(encoder.encode(JSON.stringify({ t: 'e' }) + '\n'));
          controller.close();
        } catch {
          // stream already closed
        }
      });
    },
    cancel() {
      // Client disconnected — no cleanup needed
    }
  });

  const truncated = totalRows > offset + actualLimit;

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'X-Preview-Format': 'parquet',
      'X-Preview-Renderable': 'true',
      'X-Preview-Truncated': String(truncated),
      'X-Preview-Total-Size': String(byteLength),
      'X-Preview-Total-Rows': String(totalRows),
      'X-Preview-Offset': String(offset),
      'Cache-Control': 'no-store'
    }
  });
}
