import { error, json } from '@sveltejs/kit';
import { S3ServiceException } from '@aws-sdk/client-s3';
import { gunzipSync } from 'node:zlib';
import { parquetMetadataAsync, parquetReadObjects, parquetSchema } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { getUserId } from '$lib/server/auth-utils.js';
import { getConnection } from '$lib/server/storage/service.js';
import { StorageProviderFactory } from '$lib/server/storage/factory.js';
import type { RequestHandler } from '@sveltejs/kit';

/** Maximum bytes fetched for text-based previews (256 KiB). */
const TEXT_PREVIEW_BYTES = 256 * 1024;
/** Maximum bytes fetched for image previews (5 MiB). */
const IMAGE_PREVIEW_BYTES = 5 * 1024 * 1024;
/** Maximum bytes fetched for PDF previews (25 MiB). */
const PDF_PREVIEW_BYTES = 25 * 1024 * 1024;
/** Maximum rows to include in a parquet preview. */
const PARQUET_PREVIEW_ROWS = 500;

/**
 * Override the pure-JS GZIP decompressor from hyparquet-compressors with
 * Node's native zlib binding — orders of magnitude faster for large payloads.
 */
const nodeCompressors = {
  ...compressors,
  GZIP: (input: Uint8Array, _outputLength: number): Uint8Array =>
    new Uint8Array(gunzipSync(input))
};

/**
 * Content types that are definitively binary and cannot be rendered as text.
 * For these we skip the body fetch entirely and tell the client upfront.
 */
const KNOWN_BINARY_TYPES = new Set([
  'application/gzip',
  'application/x-gzip',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-tar',
  'application/x-bzip2',
  'application/x-xz',
  'application/x-zstd',
  'application/zstd',
  'application/avro',
  'application/x-avro',
  'application/orc',
  'application/x-orc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

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

export const GET: RequestHandler = async ({ url, locals }) => {
  const log = locals.logger;
  const userId = getUserId(locals);

  const bucket = url.searchParams.get('bucket');
  const key = url.searchParams.get('key');

  if (!bucket || !key) {
    return json({ error: 'Missing bucket or key parameter' }, { status: 400 });
  }

  const connection = getConnection(userId);
  if (!connection) {
    return json({ error: 'No storage connection configured' }, { status: 401 });
  }
  if (connection.type !== 's3') {
    return json({ error: 'Storage backend not supported for preview' }, { status: 400 });
  }

  const provider = StorageProviderFactory.create({ ...connection, bucket });

  try {
    const metadata = await provider.getMetadata(key);
    const rawContentType = metadata.contentType ?? 'application/octet-stream';
    const totalSize = metadata.size;
    const lowerKey = key.toLowerCase();

    // Parquet files (by content-type or extension) — parse server-side and emit CSV rows.
    const isParquet =
      rawContentType === 'application/vnd.apache.parquet' ||
      rawContentType === 'application/x-parquet' ||
      lowerKey.endsWith('.parquet');

    if (isParquet) {
      log.info(
        { user_id: userId, bucket, key, content_type: rawContentType, total_size: totalSize },
        'parsing parquet preview'
      );

      // Phase 1: read only the parquet footer (≤2 range requests: last 8 bytes
      // for the magic + footer length, then the footer itself).
      const footerBuffer = {
        byteLength: totalSize,
        slice: async (start: number, end?: number): Promise<ArrayBuffer> => {
          const rangeEnd = end !== undefined ? end - 1 : totalSize - 1;
          const stream = await provider.getObjectRange(key, start, rangeEnd);
          return streamToArrayBuffer(stream as ReadableStream);
        }
      };

      const parquetMeta = await parquetMetadataAsync(footerBuffer);
      const totalRows = Number(parquetMeta.num_rows);
      const previewRows = Math.min(totalRows, PARQUET_PREVIEW_ROWS);
      const truncated = previewRows < totalRows;

      // Phase 2: determine which row groups are needed for the preview rows and
      // compute their combined byte span in the file.
      let dataStart = totalSize;
      let dataEnd = 0;
      let rowsAccumulated = 0;

      for (const rowGroup of parquetMeta.row_groups) {
        if (rowsAccumulated >= previewRows) break;
        rowsAccumulated += Number(rowGroup.num_rows);
        for (const col of rowGroup.columns) {
          const md = col.meta_data;
          if (!md) continue;
          // Dictionary page (if present) comes before data pages.
          const pageStart = Number(md.dictionary_page_offset ?? md.data_page_offset);
          const pageEnd = pageStart + Number(md.total_compressed_size);
          if (pageStart > 0) dataStart = Math.min(dataStart, pageStart);
          if (pageEnd > dataEnd) dataEnd = pageEnd;
        }
      }

      // Phase 3: download exactly the needed bytes in a single range request.
      const dataStream = await provider.getObjectRange(key, dataStart, dataEnd - 1);
      const dataBuf = await streamToArrayBuffer(dataStream as ReadableStream);

      log.info(
        {
          user_id: userId,
          bucket,
          key,
          total_rows: totalRows,
          preview_rows: previewRows,
          data_start: dataStart,
          data_bytes: dataEnd - dataStart,
          truncated
        },
        'parquet data range downloaded'
      );

      // Phase 4: parse entirely in-memory — no additional network requests.
      // parquetReadObjects only reads data pages; it will not re-read the footer
      // because we supply metadata: parquetMeta.
      const dataBuffer = {
        byteLength: totalSize,
        slice: (start: number, end?: number): ArrayBuffer => {
          const s = start - dataStart;
          const e = end !== undefined ? end - dataStart : dataBuf.byteLength;
          return dataBuf.slice(Math.max(0, s), Math.max(0, e));
        }
      };

      const schema = parquetSchema(parquetMeta);
      const columnNames = schema.children.map((e) => e.element.name);

      const rows = await parquetReadObjects({ file: dataBuffer, metadata: parquetMeta, rowEnd: previewRows, compressors: nodeCompressors });

      const csvLines = [
        columnNames.map(escapeCSVField).join(','),
        ...rows.map((row) =>
          columnNames.map((col) => escapeCSVField(formatParquetValue(row[col]))).join(',')
        )
      ];
      const csvText = csvLines.join('\n');

      log.info(
        { user_id: userId, bucket, key, total_rows: totalRows, preview_rows: previewRows, truncated },
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

    // Skip body fetch for known-binary formats — client will show fallback immediately.
    if (KNOWN_BINARY_TYPES.has(rawContentType)) {
      log.info(
        { user_id: userId, bucket, key, content_type: rawContentType },
        'skipping preview fetch for known-binary type'
      );
      return new Response(null, {
        headers: {
          'Content-Type': rawContentType,
          'X-Preview-Renderable': 'false',
          'X-Preview-Total-Size': String(totalSize),
          'X-Preview-Bytes': '0',
          'X-Preview-Truncated': 'false',
          'Cache-Control': 'no-store'
        }
      });
    }

    // Normalise the content-type for Excel-exported CSV files so the client
    // treats them as text/csv rather than binary.
    const contentType =
      rawContentType === 'application/vnd.ms-excel' && lowerKey.endsWith('.csv')
        ? 'text/csv'
        : rawContentType;

    let limitBytes: number;
    if (contentType.startsWith('image/')) {
      limitBytes = IMAGE_PREVIEW_BYTES;
    } else if (contentType === 'application/pdf') {
      limitBytes = PDF_PREVIEW_BYTES;
    } else {
      limitBytes = TEXT_PREVIEW_BYTES;
    }

    const previewBytes = Math.min(totalSize, limitBytes);
    const truncated = previewBytes < totalSize;

    log.info(
      {
        user_id: userId,
        bucket,
        key,
        content_type: contentType,
        preview_bytes: previewBytes,
        truncated
      },
      'fetching object preview'
    );

    const stream =
      previewBytes === totalSize
        ? await provider.getObject(key)
        : await provider.getObjectRange(key, 0, previewBytes - 1);

    return new Response(stream as ReadableStream, {
      headers: {
        'Content-Type': contentType,
        'X-Preview-Renderable': 'true',
        'X-Preview-Truncated': String(truncated),
        'X-Preview-Total-Size': String(totalSize),
        'X-Preview-Bytes': String(previewBytes),
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    if (err instanceof S3ServiceException) {
      const code = err.name;
      const status = err.$metadata?.httpStatusCode;
      log.warn(
        { user_id: userId, bucket, key, error_code: code, http_status: status },
        'S3 error fetching preview'
      );
      if (code === 'AccessDenied' || status === 403) {
        throw error(403, 'Access denied');
      }
      if (code === 'NoSuchKey' || status === 404) {
        throw error(404, 'Object not found');
      }
      throw error(502, `Storage error: ${err.message}`);
    }
    throw err;
  }
};
