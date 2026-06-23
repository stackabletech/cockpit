import { gunzipSync } from 'node:zlib';
import {
  parquetMetadataAsync,
  parquetRead,
  parquetSchema,
  type FileMetaData,
  type CompressionCodec,
  type SchemaTree
} from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import type pino from 'pino';
import { logger } from '$lib/server/logging';
import type { StorageProvider } from '$lib/server/storage/provider.js';
import {
  parquetDisallowedCompression,
  type ParquetDisallowedCompression
} from '$lib/server/feature-flags';

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

/**
 * Check whether a parquet file's row groups contain any column matching a
 * disallowed compression rule.
 */
function findBlockingRule(
  meta: FileMetaData,
  disallowed: ParquetDisallowedCompression[]
): ParquetDisallowedCompression | undefined {
  return disallowed.find((rule) =>
    meta.row_groups.some((group) =>
      group.columns.some((col) => {
        if (col.meta_data?.codec !== rule.codec) return false;
        if (!rule.requireOffsetIndex) return true;
        const hasOffsetIndex =
          col.offset_index_offset !== undefined &&
          col.offset_index_offset !== null &&
          col.offset_index_length !== undefined &&
          col.offset_index_length > 0;
        return !hasOffsetIndex;
      })
    )
  );
}

function stringifyStructuredParquetValue(value: object): string {
  return JSON.stringify(value, (_key, nestedValue: unknown) => {
    if (typeof nestedValue === 'bigint') return nestedValue.toString();
    if (nestedValue instanceof Date) return nestedValue.toISOString();
    if (nestedValue instanceof Uint8Array) return Array.from(nestedValue);
    return nestedValue;
  });
}

/** Extract a human-readable type string from a schema element. */
function describeColumnType(element: SchemaTree['element']): string {
  if (element.logical_type) {
    const lt = element.logical_type;
    if (lt.type === 'STRING') return 'string';
    if (lt.type === 'INTEGER') return `int(${lt.bitWidth})`;
    if (lt.type === 'DECIMAL') return `decimal(${lt.precision},${lt.scale})`;
    if (lt.type === 'DATE') return 'date';
    if (lt.type === 'TIME') return 'time';
    if (lt.type === 'TIMESTAMP') return 'timestamp';
    if (lt.type === 'ENUM') return 'enum';
    if (lt.type === 'UUID') return 'uuid';
    if (lt.type === 'JSON') return 'json';
    if (lt.type === 'BSON') return 'bson';
    if (lt.type === 'MAP') return 'map';
    if (lt.type === 'LIST') return 'list';
    if (lt.type === 'FLOAT16') return 'float16';
    if (lt.type === 'VARIANT') return 'variant';
    if (lt.type === 'NULL') return 'null';
    if (lt.type === 'INTERVAL') return 'interval';
    if (lt.type === 'GEOMETRY') return 'geometry';
    if (lt.type === 'GEOGRAPHY') return 'geography';
  }
  if (element.converted_type) {
    if (element.converted_type === 'UTF8') return 'string';
    if (element.converted_type === 'MAP') return 'map';
    if (element.converted_type === 'LIST') return 'list';
    if (element.converted_type === 'ENUM') return 'enum';
    if (element.converted_type === 'DECIMAL')
      return `decimal(${element.precision},${element.scale})`;
    if (element.converted_type === 'DATE') return 'date';
    if (element.converted_type === 'TIME_MILLIS') return 'time_ms';
    if (element.converted_type === 'TIME_MICROS') return 'time_us';
    if (element.converted_type === 'TIMESTAMP_MILLIS') return 'timestamp_ms';
    if (element.converted_type === 'TIMESTAMP_MICROS') return 'timestamp_us';
    if (element.converted_type === 'UINT_8') return 'uint8';
    if (element.converted_type === 'UINT_16') return 'uint16';
    if (element.converted_type === 'UINT_32') return 'uint32';
    if (element.converted_type === 'UINT_64') return 'uint64';
    if (element.converted_type === 'INT_8') return 'int8';
    if (element.converted_type === 'INT_16') return 'int16';
    if (element.converted_type === 'INT_32') return 'int32';
    if (element.converted_type === 'INT_64') return 'int64';
    if (element.converted_type === 'JSON') return 'json';
    if (element.converted_type === 'BSON') return 'bson';
    if (element.converted_type === 'INTERVAL') return 'interval';
  }
  if (element.type === 'BOOLEAN') return 'boolean';
  if (element.type === 'INT32') return 'int32';
  if (element.type === 'INT64') return 'int64';
  if (element.type === 'INT96') return 'int96';
  if (element.type === 'FLOAT') return 'float';
  if (element.type === 'DOUBLE') return 'double';
  if (element.type === 'BYTE_ARRAY') return 'binary';
  if (element.type === 'FIXED_LEN_BYTE_ARRAY') return 'fixed_binary';
  return 'unknown';
}

/** Collect the unique compression codecs used across all row groups. */
function collectCompressionCodecs(meta: FileMetaData): CompressionCodec[] {
  const codecs = new Set<CompressionCodec>();
  for (const group of meta.row_groups) {
    for (const col of group.columns) {
      if (col.meta_data?.codec) {
        codecs.add(col.meta_data.codec);
      }
    }
  }
  return Array.from(codecs);
}

/** Check whether the file has an offset index on at least one column. */
function hasOffsetIndex(meta: FileMetaData): boolean {
  return meta.row_groups.some((group) =>
    group.columns.some(
      (col) =>
        col.offset_index_offset !== undefined &&
        col.offset_index_offset !== null &&
        col.offset_index_length !== undefined &&
        col.offset_index_length > 0
    )
  );
}

/** Check whether the file has a column index on at least one column. */
function hasColumnIndex(meta: FileMetaData): boolean {
  return meta.row_groups.some((group) =>
    group.columns.some(
      (col) =>
        col.column_index_offset !== undefined &&
        col.column_index_offset !== null &&
        col.column_index_length !== undefined &&
        col.column_index_length > 0
    )
  );
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
  totalSize?: number,
  includeData = false
): Promise<Response> {
  const log = requestLog.child({ module: 'parquet-preview' });
  const byteLength = totalSize ?? (await provider.getMetadata(key)).size;

  if (byteLength === 0) {
    const meta = {
      rowGroups: 0,
      compressionCodecs: [] as string[],
      hasOffsetIndex: false,
      hasColumnIndex: false,
      createdBy: null as string | null,
      version: 0
    };
    return new Response(JSON.stringify({ t: 'h', h: [], tr: 0, s: [], m: meta }) + '\n', {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'X-Preview-Format': 'parquet',
        'X-Preview-Renderable': 'true',
        'X-Preview-Data-Blocked': 'false',
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
  const schemaTree = parquetSchema(parquetMeta);
  const headers = schemaTree.children.map((entry) => entry.element.name);

  const columnTypes = schemaTree.children.map((entry) => ({
    name: entry.element.name,
    type: describeColumnType(entry.element)
  }));
  const metadata = {
    rowGroups: parquetMeta.row_groups.length,
    compressionCodecs: collectCompressionCodecs(parquetMeta),
    hasOffsetIndex: hasOffsetIndex(parquetMeta),
    hasColumnIndex: hasColumnIndex(parquetMeta),
    createdBy: parquetMeta.created_by ?? null,
    version: parquetMeta.version
  };

  // ── Check if compression rules disallow data preview ─────────
  const blockingRule = findBlockingRule(parquetMeta, parquetDisallowedCompression);

  // Always return header message with schema + metadata (even when blocked).
  // When blocked, set data-blocked header and never stream column data.
  if (blockingRule || !includeData) {
    log.warn(
      { key, codec: blockingRule?.codec, require_offset_index: blockingRule?.requireOffsetIndex },
      blockingRule ? 'Blocked parquet preview by compression rule' : 'Metadata-only parquet request'
    );
    const extraHeaders: Record<string, string> = {};
    if (blockingRule) extraHeaders['X-Preview-Data-Blocked'] = 'true';
    return new Response(
      JSON.stringify({ t: 'h', h: headers, tr: totalRows, s: columnTypes, m: metadata }) + '\n',
      {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'X-Preview-Format': 'parquet',
          'X-Preview-Renderable': 'true',
          ...extraHeaders,
          'X-Preview-Total-Size': String(byteLength),
          'X-Preview-Total-Rows': String(totalRows),
          'X-Preview-Offset': String(offset),
          'Cache-Control': 'no-store'
        }
      }
    );
  }

  const actualLimit = Math.min(limit, Math.max(0, totalRows - offset));

  if (actualLimit <= 0) {
    return new Response(
      JSON.stringify({ t: 'h', h: headers, tr: totalRows, s: columnTypes, m: metadata }) + '\n',
      {
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
      }
    );
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
      // Send headers immediately with schema and metadata
      controller.enqueue(
        encoder.encode(
          JSON.stringify({ t: 'h', h: headers, tr: totalRows, s: columnTypes, m: metadata }) + '\n'
        )
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
