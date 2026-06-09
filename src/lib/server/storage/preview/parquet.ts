import { gunzipSync } from 'node:zlib';
import { parquetMetadataAsync, parquetReadObjects, parquetSchema } from 'hyparquet';
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature must match hyparquet's expectation
  GZIP: (input: Uint8Array, _outputLength: number): Uint8Array => new Uint8Array(gunzipSync(input))
};

function stringifyStructuredParquetValue(value: object): string {
  return JSON.stringify(value, (_key, nestedValue: unknown) => {
    if (typeof nestedValue === 'bigint') {
      return nestedValue.toString();
    }

    if (nestedValue instanceof Date) {
      return nestedValue.toISOString();
    }

    if (nestedValue instanceof Uint8Array) {
      return Array.from(nestedValue);
    }

    return nestedValue;
  });
}

function toSerializableParquetCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Uint8Array) {
    return Array.from(value).join(',');
  }

  if (Array.isArray(value)) {
    return stringifyStructuredParquetValue(value);
  }

  if (typeof value === 'object') {
    return stringifyStructuredParquetValue(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }

  return String(value);
}

function createParquetPreviewResponse(
  payload: ParquetPreviewPayload,
  totalSize: number,
  previewRows: number
): Response {
  return Response.json(payload, {
    headers: {
      'X-Preview-Format': 'parquet',
      'X-Preview-Renderable': 'true',
      'X-Preview-Truncated': String(payload.totalRows > previewRows),
      'X-Preview-Total-Size': String(totalSize),
      'X-Preview-Total-Rows': String(payload.totalRows),
      'X-Preview-Preview-Rows': String(previewRows),
      'Cache-Control': 'no-store'
    }
  });
}

async function streamToArrayBuffer(stream: ReadableStream): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
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

/**
 * Reads a highly optimized preview of a Parquet file from S3.
 * It uses HTTP Range Requests to fetch ONLY the footer and the necessary chunk bytes.
 */
export async function getParquetPreview(
  provider: StorageProvider,
  key: string,
  maxRows = 250,
  requestLog: pino.Logger = fallbackLog,
  totalSize?: number
): Promise<Response> {
  const log = requestLog.child({ module: 'parquet-preview' });
  const byteLength = totalSize ?? (await provider.getMetadata(key)).size;

  if (byteLength === 0) {
    return createParquetPreviewResponse({ headers: [], rows: [], totalRows: 0 }, byteLength, 0);
  }

  // Read footer metadata serially to avoid spiking range requests on large files.
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

  try {
    const parquetMeta = await parquetMetadataAsync(footerBuffer);
    const totalRows = Number(parquetMeta.num_rows);
    const previewRows = Math.min(totalRows, maxRows);
    const headers = parquetSchema(parquetMeta).children.map((entry) => entry.element.name);

    let offsetIndexStart = Infinity;
    let offsetIndexEnd = 0;
    let rowsScanned = 0;

    for (const rowGroup of parquetMeta.row_groups) {
      if (rowsScanned >= previewRows) {
        break;
      }

      rowsScanned += Number(rowGroup.num_rows);

      for (const column of rowGroup.columns) {
        if (!column.offset_index_offset || !column.offset_index_length) {
          continue;
        }

        const start = Number(column.offset_index_offset);
        const end = start + column.offset_index_length;
        if (start < offsetIndexStart) {
          offsetIndexStart = start;
        }
        if (end > offsetIndexEnd) {
          offsetIndexEnd = end;
        }
      }
    }

    let offsetIndexCache: { start: number; buffer: ArrayBuffer } | null = null;
    if (isFinite(offsetIndexStart)) {
      const stream = await provider.getObjectRange(key, offsetIndexStart, offsetIndexEnd - 1);
      offsetIndexCache = {
        start: offsetIndexStart,
        buffer: await streamToArrayBuffer(stream as ReadableStream)
      };
      log.debug(
        { key, offset_index_bytes: offsetIndexEnd - offsetIndexStart },
        'Parquet offset index prefetched'
      );
    } else {
      log.warn(
        { key, preview_rows: previewRows },
        'Parquet preview missing offset indexes; falling back to larger row-group reads'
      );
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
      if (next) {
        next();
        return;
      }

      active -= 1;
    };

    const asyncFile = {
      byteLength,
      slice: (start: number, end?: number): Promise<ArrayBuffer> => {
        const rangeEnd = end ?? byteLength;

        if (
          offsetIndexCache &&
          start >= offsetIndexCache.start &&
          rangeEnd <= offsetIndexCache.start + offsetIndexCache.buffer.byteLength
        ) {
          return Promise.resolve(
            offsetIndexCache.buffer.slice(
              start - offsetIndexCache.start,
              rangeEnd - offsetIndexCache.start
            )
          );
        }

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

    const rowObjects = await parquetReadObjects({
      file: asyncFile,
      metadata: parquetMeta,
      rowEnd: previewRows,
      useOffsetIndex: true,
      compressors: nodeCompressors
    });

    const rows = rowObjects.map((row) => {
      const valueMap = new Map(Object.entries(row as Record<string, unknown>));
      return headers.map((header) => toSerializableParquetCell(valueMap.get(header)));
    });

    log.info({ key, total_rows: totalRows, preview_rows: rows.length }, 'Parquet preview ready');

    return createParquetPreviewResponse({ headers, rows, totalRows }, byteLength, rows.length);
  } catch (error) {
    log.error({ err: error, key }, 'Failed to parse Parquet preview');
    return createParquetPreviewResponse({ headers: [], rows: [], totalRows: 0 }, byteLength, 0);
  }
}
