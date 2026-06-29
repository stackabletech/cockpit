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

/**
 * Statistics aggregated across all row groups for a single column.
 */
interface ColumnStats {
  nullCount: number | null;
  distinctCount: number | null;
  min: string | null;
  max: string | null;
}

/**
 * Per-column detail assembled from all row groups.
 */
interface ColumnDetail {
  name: string;
  type: string;
  codec: string;
  compressedSize: number;
  uncompressedSize: number;
  stats: ColumnStats;
}

/** Serialize a min/max stat value to a string for client transmission. */
function statToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array)
    return `<${Array.from(value.slice(0, 8)).join(',')}${value.length > 8 ? '...' : ''}>`;
  if (typeof value === 'string') return value.length > 100 ? value.slice(0, 100) + '…' : value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return String(value);
}

/**
 * Collect per-column details (sizes, codec, stats) from all row groups.
 */
function collectColumnDetails(meta: FileMetaData, schemaTree: SchemaTree): ColumnDetail[] {
  return schemaTree.children.map((entry) => {
    const colName = entry.element.name;
    let compressedSize = 0;
    let uncompressedSize = 0;
    const codecs = new Set<string>();
    let aggNullCount: number | null = null;
    let aggDistinctCount: number | null = null;
    let aggMin: string | null = null;
    let aggMax: string | null = null;
    let hasAnyStats = false;

    for (const group of meta.row_groups) {
      for (const col of group.columns) {
        const md = col.meta_data;
        if (!md) continue;
        if (
          md.path_in_schema.length === 0 ||
          md.path_in_schema[md.path_in_schema.length - 1] !== colName
        )
          continue;

        codecs.add(md.codec);
        compressedSize += Number(md.total_compressed_size);
        uncompressedSize += Number(md.total_uncompressed_size);

        const st = md.statistics;
        if (st) {
          hasAnyStats = true;
          const nullCount = st.null_count !== undefined ? Number(st.null_count) : null;
          const distinctCount = st.distinct_count !== undefined ? Number(st.distinct_count) : null;

          if (nullCount !== null) {
            aggNullCount = (aggNullCount ?? 0) + nullCount;
          }
          if (distinctCount !== null) {
            aggDistinctCount = (aggDistinctCount ?? 0) + distinctCount;
          }

          const minVal = statToString(st.min ?? st.min_value ?? null);
          const maxVal = statToString(st.max ?? st.max_value ?? null);

          if (minVal !== null) {
            if (aggMin === null || minVal < aggMin) aggMin = minVal;
          }
          if (maxVal !== null) {
            if (aggMax === null || maxVal > aggMax) aggMax = maxVal;
          }
        }
      }
    }

    const codec = codecs.size === 1 ? codecs.values().next().value! : 'MIXED';

    return {
      name: colName,
      type: describeColumnType(entry.element),
      codec,
      compressedSize,
      uncompressedSize,
      stats: {
        nullCount: hasAnyStats ? aggNullCount : null,
        distinctCount: hasAnyStats ? aggDistinctCount : null,
        min: hasAnyStats ? aggMin : null,
        max: hasAnyStats ? aggMax : null
      }
    };
  });
}

/**
 * Try to decode the embedded Arrow schema from Parquet key_value_metadata.
 * Returns a human-readable description (field names & types), or null on failure.
 *
 * The ARROW:schema value is a base64-encoded Arrow IPC serialised Schema
 * (Flatbuffers format inside an IPC message framing).
 */
function extractArrowSchema(meta: FileMetaData): string | null {
  if (!meta.key_value_metadata) return null;
  const kv = meta.key_value_metadata.find((e) => e.key === 'ARROW:schema');
  if (!kv?.value) return null;

  try {
    const bytes = Uint8Array.from(atob(kv.value), (c) => c.charCodeAt(0));
    if (bytes.length < 8) return null;

    const dv = (pos: number) => new DataView(bytes.buffer, bytes.byteOffset + pos);

    // IPC framing: optional 0xFFFFFFFF continuation indicator, then 4-byte metadata length
    let pos = 0;
    let metaLen: number;
    const first = dv(0).getInt32(0, true);
    if (first === -1) {
      pos = 8;
      metaLen = dv(4).getInt32(0, true);
    } else {
      metaLen = first;
      pos = 4;
    }
    if (pos + metaLen > bytes.length) return null;

    // Flatbuffers helpers operating on the metadata slice
    const fb = {
      buf: bytes.slice(pos, pos + metaLen),
      i32(at: number) {
        return new DataView(this.buf.buffer, this.buf.byteOffset + at).getInt32(0, true);
      },
      i16(at: number) {
        return new DataView(this.buf.buffer, this.buf.byteOffset + at).getInt16(0, true);
      },
      i8(at: number) {
        return new DataView(this.buf.buffer, this.buf.byteOffset + at).getInt8(0);
      }
    };

    // Parse a Flatbuffers table: return field offsets (0 = absent)
    function tableFields(tab: number): number[] {
      const vtOff = tab - fb.i32(tab); // vtable location
      const n = fb.i16(vtOff + 2); // number of fields
      const offs: number[] = [];
      for (let i = 0; i < n; i++) offs.push(fb.i16(vtOff + 4 + i * 2));
      return offs;
    }

    // Read a string at a uoffset_t pointer
    function fbStr(at: number): string {
      const strOff = fb.i32(at); // uoffset_t relative to `at`
      const start = at + strOff;
      const len = fb.i32(start);
      return new TextDecoder().decode(fb.buf.slice(start + 4, start + 4 + len));
    }

    // Read a uoffset_t and return the absolute offset
    function fbOff(at: number): number {
      return at + fb.i32(at);
    }

    // Read a vector (returns element start offset and count)
    function fbVec(at: number): { elemStart: number; count: number } | null {
      const vecOff = fb.i32(at);
      const start = at + vecOff;
      const count = fb.i32(start);
      return { elemStart: start + 4, count };
    }

    // Message table starts at 0 within the metadata block
    const msgFields = tableFields(0);
    if (msgFields.length < 3) return null;

    // Field 1 (header_type, ubyte) — tab=0 so fieldPos = msgFields[1]
    if (msgFields[1] === 0) return null;
    const headerType = fb.i8(msgFields[1]);
    if (headerType !== 1) return null; // 1 = Schema

    // Field 2 (header, table offset) — tab=0 so fieldPos = msgFields[2]
    if (msgFields[2] === 0) return null;
    const schemaTab = fbOff(msgFields[2]);

    // Schema table: field 1 = fields vector
    const schemaFields = tableFields(schemaTab);
    if (schemaFields.length < 2 || schemaFields[1] === 0) return null;
    // fieldPos for fields vector: schemaTab + schemaFields[1]
    const vec = fbVec(schemaTab + schemaFields[1]);
    if (!vec || vec.count === 0) return null;

    const fieldEntries: string[] = [];
    for (let i = 0; i < vec.count; i++) {
      const fieldTabOff = fb.i32(vec.elemStart + i * 4);
      const fieldTabAbs = vec.elemStart + i * 4 + fieldTabOff;
      const ff = tableFields(fieldTabAbs);
      if (ff.length > 0 && ff[0] !== 0) {
        const name = fbStr(fieldTabAbs + ff[0]);
        fieldEntries.push(name);
      }
    }

    if (fieldEntries.length === 0) return null;
    return fieldEntries.join(', ');
  } catch {
    return null;
  }
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
      compressionUniform: true,
      hasOffsetIndex: false,
      hasColumnIndex: false,
      createdBy: null as string | null,
      version: 0,
      arrowSchema: null as string | null
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

  const columnDetails = collectColumnDetails(parquetMeta, schemaTree);
  const arrowSchema = extractArrowSchema(parquetMeta);
  const metadata = {
    rowGroups: parquetMeta.row_groups.length,
    compressionCodecs: collectCompressionCodecs(parquetMeta),
    compressionUniform: new Set(columnDetails.map((c) => c.codec)).size <= 1,
    hasOffsetIndex: hasOffsetIndex(parquetMeta),
    hasColumnIndex: hasColumnIndex(parquetMeta),
    createdBy: parquetMeta.created_by ?? null,
    version: parquetMeta.version,
    arrowSchema
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
      JSON.stringify({ t: 'h', h: headers, tr: totalRows, s: columnDetails, m: metadata }) + '\n',
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
      JSON.stringify({ t: 'h', h: headers, tr: totalRows, s: columnDetails, m: metadata }) + '\n',
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
          JSON.stringify({ t: 'h', h: headers, tr: totalRows, s: columnDetails, m: metadata }) +
            '\n'
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
