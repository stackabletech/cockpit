import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type pino from 'pino';
import type { StorageProvider } from '$lib/server/storage/provider.js';

const mockParquetMetadataAsync = vi.fn();
const mockParquetRead = vi.fn();
const mockParquetSchema = vi.fn();

vi.mock('hyparquet', () => ({
  parquetMetadataAsync: (...args: unknown[]) => mockParquetMetadataAsync(...args),
  parquetRead: (...args: unknown[]) => mockParquetRead(...args),
  parquetSchema: (...args: unknown[]) => mockParquetSchema(...args)
}));

vi.mock('hyparquet-compressors', () => ({
  compressors: { UNCOMPRESSED: vi.fn() }
}));

vi.mock('$lib/server/logging', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
      child: vi.fn()
    })
  }
}));

vi.mock('$lib/server/feature-flags', () => ({
  parquetDisallowedCompression: [{ codec: 'GZIP', requireOffsetIndex: true }],
  storageBrowserEnabled: true,
  completionEnabled: true,
  filePreviewRows: 250,
  textPreviewBytes: 256 * 1024,
  imagePreviewBytes: 5 * 1024 * 1024,
  pdfPreviewBytes: 25 * 1024 * 1024,
  infiniteScrollEnabled: true
}));

import { getParquetPreview } from './parquet.js';

const mockLog = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(() => mockLog)
} as unknown as pino.Logger;

function makeProvider(overrides: Partial<StorageProvider> = {}): StorageProvider {
  return {
    listContainers: vi.fn(),
    listObjects: vi.fn(),
    getObject: vi.fn(),
    getObjectRange: vi.fn(),
    getMetadata: vi.fn(),
    exists: vi.fn(),
    putObject: vi.fn(),
    deleteObjects: vi.fn(),
    listAllKeys: vi.fn(),
    listAllKeysProgressively: vi.fn(),
    getBucketVersioning: vi.fn(),
    getBucketLifecycleRules: vi.fn(),
    getBucketTags: vi.fn(),
    getBucketAcl: vi.fn(),
    ...overrides
  };
}

function makeStream(bytes?: Uint8Array): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes ?? new Uint8Array([0, 0]));
      controller.close();
    }
  });
}

/**
 * Read an NDJSON streaming response into a plain object, simulating the client-side stream parser.
 * Returns the first "h" (headers) message followed by accumulated column data and the final message.
 */
async function readNdjsonResponse(res: Response): Promise<{
  headers: string[];
  rows: unknown[][];
  totalRows: number;
  truncated: boolean;
  error?: string;
  schema?: Array<{ name: string; type: string }>;
  metadata?: {
    rowGroups: number;
    compressionCodecs: string[];
    hasOffsetIndex: boolean;
    hasColumnIndex: boolean;
    createdBy: string | null;
    version: number;
  };
}> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let resultHeaders: string[] = [];
  const rows: unknown[][] = [];
  let resultTotalRows = 0;
  let error: string | undefined;
  let schema: Array<{ name: string; type: string }> | undefined;
  let metadata:
    | {
        rowGroups: number;
        compressionCodecs: string[];
        hasOffsetIndex: boolean;
        hasColumnIndex: boolean;
        createdBy: string | null;
        version: number;
      }
    | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);

      if (msg.t === 'h') {
        resultHeaders = msg.h;
        resultTotalRows = msg.tr;
        schema = msg.s;
        metadata = msg.m;
      } else if (msg.t === 'c') {
        const colIdx = resultHeaders.indexOf(msg.n);
        if (colIdx < 0) continue;
        const values = msg.v as unknown[];
        while (rows.length < values.length) {
          rows.push(new Array(resultHeaders.length).fill(undefined));
        }
        for (let i = 0; i < values.length; i++) {
          if (!rows[i]) rows[i] = new Array(resultHeaders.length).fill(undefined);
          rows[i][colIdx] = values[i];
        }
      } else if (msg.t === 'e') {
        error = 'Server error';
      }
    }
  }

  return {
    headers: resultHeaders,
    rows,
    totalRows: resultTotalRows,
    truncated: res.headers.get('X-Preview-Truncated') === 'true',
    error,
    schema,
    metadata
  };
}

/**
 * Invoke the onChunk / onComplete callbacks that parquetRead would normally call,
 * to simulate streaming column data.
 */
function invokeParquetReadCallbacks(
  args: unknown[],
  columnDataMap: Record<string, unknown[]>
): void {
  const options = args[0] as {
    onChunk?: (chunk: { columnName: string; columnData: unknown[] }) => void;
    onComplete?: () => void;
  };

  // Simulate column data streaming: fire onChunk for each column.
  // NOT passing rowStart/rowEnd so the trimming logic in parquet.ts uses
  // undefined → NaN → false comparison → passes through full columnData.
  for (const [colName, values] of Object.entries(columnDataMap)) {
    if (options.onChunk) {
      options.onChunk({ columnName: colName, columnData: values });
    }
  }

  // Then fire onComplete
  if (options.onComplete) {
    options.onComplete();
  }
}

/**
 * Return a resolved promise mimicking parquetRead's async behaviour.
 */
function resolvedMockParquetRead(args: unknown[], columnDataMap: Record<string, unknown[]>) {
  invokeParquetReadCallbacks(args, columnDataMap);
  return Promise.resolve();
}

describe('getParquetPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockParquetSchema.mockReturnValue({
      children: [
        { element: { name: 'id', type: 'INT64' } },
        {
          element: {
            name: 'name',
            type: 'BYTE_ARRAY',
            converted_type: 'UTF8',
            logical_type: { type: 'STRING' }
          }
        },
        { element: { name: 'active', type: 'BOOLEAN' } }
      ]
    });
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('returns empty response for zero-size parquet file', async () => {
    const provider = makeProvider({
      getMetadata: vi.fn().mockResolvedValue({ size: 0, contentType: 'application/x-parquet' })
    });

    const res = await getParquetPreview(provider, 'empty.parquet', 0, 250, mockLog);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Preview-Format')).toBe('parquet');
    expect(res.headers.get('X-Preview-Renderable')).toBe('true');
    expect(res.headers.get('X-Preview-Total-Rows')).toBe('0');
    const body = await readNdjsonResponse(res);
    expect(body.headers).toEqual([]);
    expect(body.rows).toEqual([]);
    expect(body.totalRows).toBe(0);
    expect(body.schema).toEqual([]);
    expect(body.metadata).toBeDefined();
    expect(body.metadata?.rowGroups).toBe(0);
    expect(mockParquetMetadataAsync).not.toHaveBeenCalled();
  });

  it('parses parquet metadata and returns headers and rows with schema and metadata', async () => {
    mockParquetMetadataAsync.mockResolvedValue({
      num_rows: 2n,
      row_groups: [],
      created_by: 'test',
      version: 1
    });
    mockParquetRead.mockImplementation((...args: unknown[]) =>
      resolvedMockParquetRead(args, {
        id: [1n, 2n],
        name: ['Alice', 'Bob'],
        active: [true, false]
      })
    );

    const provider = makeProvider({
      getMetadata: vi.fn().mockResolvedValue({ size: 1024, contentType: 'application/x-parquet' }),
      getObjectRange: vi.fn(() => Promise.resolve(makeStream()))
    });

    const res = await getParquetPreview(provider, 'data.parquet', 0, 250, mockLog, undefined, true);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Preview-Format')).toBe('parquet');
    expect(res.headers.get('X-Preview-Renderable')).toBe('true');
    expect(res.headers.get('X-Preview-Total-Rows')).toBe('2');
    expect(res.headers.get('X-Preview-Total-Size')).toBe('1024');
    expect(res.headers.get('X-Preview-Offset')).toBe('0');

    const body = await readNdjsonResponse(res);
    expect(body.headers).toEqual(['id', 'name', 'active']);
    expect(body.rows).toEqual([
      ['1', 'Alice', true],
      ['2', 'Bob', false]
    ]);
    expect(body.totalRows).toBe(2);

    // Schema info
    expect(body.schema).toBeDefined();
    expect(body.schema).toHaveLength(3);
    expect(body.schema![0]).toMatchObject({ name: 'id', type: 'int64' });
    expect(body.schema![1]).toMatchObject({ name: 'name', type: 'string' });
    expect(body.schema![2]).toMatchObject({ name: 'active', type: 'boolean' });

    // Metadata
    expect(body.metadata).toBeDefined();
    expect(body.metadata?.rowGroups).toBe(0);
    expect(body.metadata?.version).toBe(1);
  });

  it('handles pagination with offset and limit', async () => {
    mockParquetMetadataAsync.mockResolvedValue({ num_rows: 1000n, row_groups: [] });
    mockParquetRead.mockImplementation((...args: unknown[]) => {
      const rows = Array.from({ length: 50 }, (_, i) => BigInt(500 + i));
      const names = Array.from({ length: 50 }, (_, i) => `User-${500 + i}`);
      return resolvedMockParquetRead(args, {
        id: rows,
        name: names
      });
    });

    const provider = makeProvider({
      getMetadata: vi.fn().mockResolvedValue({ size: 10240, contentType: 'application/x-parquet' }),
      getObjectRange: vi.fn(() => Promise.resolve(makeStream()))
    });

    const res = await getParquetPreview(
      provider,
      'large.parquet',
      500,
      50,
      mockLog,
      undefined,
      true
    );

    expect(res.headers.get('X-Preview-Offset')).toBe('500');

    const body = await readNdjsonResponse(res);
    expect(body.rows).toHaveLength(50);
    expect(body.totalRows).toBe(1000);
    expect(body.rows[0][1]).toBe('User-500');

    expect(mockParquetRead).toHaveBeenCalledWith(
      expect.objectContaining({
        rowStart: 500,
        rowEnd: 550
      })
    );
  });

  it('returns empty rows when offset exceeds total rows', async () => {
    mockParquetMetadataAsync.mockResolvedValue({ num_rows: 100n, row_groups: [] });

    const provider = makeProvider({
      getMetadata: vi.fn().mockResolvedValue({ size: 1024, contentType: 'application/x-parquet' }),
      getObjectRange: vi.fn(() => Promise.resolve(makeStream()))
    });

    const res = await getParquetPreview(provider, 'small.parquet', 200, 250, mockLog);

    const body = await readNdjsonResponse(res);
    expect(body.rows).toHaveLength(0);
    expect(body.totalRows).toBe(100);
    expect(body.truncated).toBe(false);
  });

  it('returns truncated false for final page', async () => {
    mockParquetMetadataAsync.mockResolvedValue({ num_rows: 60n, row_groups: [] });
    mockParquetRead.mockImplementation((...args: unknown[]) => {
      const data = Array.from({ length: 10 }, (_, i) => BigInt(50 + i));
      return resolvedMockParquetRead(args, { id: data });
    });

    const provider = makeProvider({
      getMetadata: vi.fn().mockResolvedValue({ size: 1024, contentType: 'application/x-parquet' }),
      getObjectRange: vi.fn(() => Promise.resolve(makeStream()))
    });

    const res = await getParquetPreview(
      provider,
      'final.parquet',
      50,
      250,
      mockLog,
      undefined,
      true
    );

    expect(res.headers.get('X-Preview-Truncated')).toBe('false');
    const body = await readNdjsonResponse(res);
    expect(body.rows).toHaveLength(10);
  });

  it('serialises BigInt values as strings', async () => {
    mockParquetMetadataAsync.mockResolvedValue({ num_rows: 1n, row_groups: [] });
    mockParquetRead.mockImplementation((...args: unknown[]) =>
      resolvedMockParquetRead(args, { large_id: [9007199254740993n] })
    );
    mockParquetSchema.mockReturnValue({
      children: [{ element: { name: 'large_id' } }]
    });

    const provider = makeProvider({
      getMetadata: vi.fn().mockResolvedValue({ size: 1024, contentType: 'application/x-parquet' }),
      getObjectRange: vi.fn(() => Promise.resolve(makeStream()))
    });

    const res = await getParquetPreview(
      provider,
      'bigint.parquet',
      0,
      250,
      mockLog,
      undefined,
      true
    );
    const body = await readNdjsonResponse(res);
    expect(body.rows[0][0]).toBe('9007199254740993');
  });

  it('serialises Date values as ISO strings', async () => {
    const date = new Date('2025-06-15T10:30:00.000Z');
    mockParquetMetadataAsync.mockResolvedValue({ num_rows: 1n, row_groups: [] });
    mockParquetRead.mockImplementation((...args: unknown[]) =>
      resolvedMockParquetRead(args, { created_at: [date] })
    );
    mockParquetSchema.mockReturnValue({
      children: [{ element: { name: 'created_at' } }]
    });

    const provider = makeProvider({
      getMetadata: vi.fn().mockResolvedValue({ size: 1024, contentType: 'application/x-parquet' }),
      getObjectRange: vi.fn(() => Promise.resolve(makeStream()))
    });

    const res = await getParquetPreview(
      provider,
      'dates.parquet',
      0,
      250,
      mockLog,
      undefined,
      true
    );
    const body = await readNdjsonResponse(res);
    expect(body.rows[0][0]).toBe('2025-06-15T10:30:00.000Z');
  });

  it('serialises Uint8Array values as comma-separated numbers', async () => {
    mockParquetMetadataAsync.mockResolvedValue({ num_rows: 1n, row_groups: [] });
    mockParquetRead.mockImplementation((...args: unknown[]) =>
      resolvedMockParquetRead(args, { blob: [new Uint8Array([1, 2, 3, 255])] })
    );
    mockParquetSchema.mockReturnValue({
      children: [{ element: { name: 'blob' } }]
    });

    const provider = makeProvider({
      getMetadata: vi.fn().mockResolvedValue({ size: 1024, contentType: 'application/x-parquet' }),
      getObjectRange: vi.fn(() => Promise.resolve(makeStream()))
    });

    const res = await getParquetPreview(provider, 'blob.parquet', 0, 250, mockLog, undefined, true);
    const body = await readNdjsonResponse(res);
    expect(body.rows[0][0]).toBe('1,2,3,255');
  });

  it('serialises nested objects as JSON strings', async () => {
    mockParquetMetadataAsync.mockResolvedValue({ num_rows: 1n, row_groups: [] });
    mockParquetRead.mockImplementation((...args: unknown[]) =>
      resolvedMockParquetRead(args, { nested: [{ foo: 'bar', num: 42 }] })
    );
    mockParquetSchema.mockReturnValue({
      children: [{ element: { name: 'nested' } }]
    });

    const provider = makeProvider({
      getMetadata: vi.fn().mockResolvedValue({ size: 1024, contentType: 'application/x-parquet' }),
      getObjectRange: vi.fn(() => Promise.resolve(makeStream()))
    });

    const res = await getParquetPreview(
      provider,
      'nested.parquet',
      0,
      250,
      mockLog,
      undefined,
      true
    );
    const body = await readNdjsonResponse(res);
    expect(body.rows[0][0]).toBe(JSON.stringify({ foo: 'bar', num: 42 }));
  });

  it('handles null and undefined values', async () => {
    mockParquetMetadataAsync.mockResolvedValue({ num_rows: 2n, row_groups: [] });
    mockParquetRead.mockImplementation((...args: unknown[]) =>
      resolvedMockParquetRead(args, {
        a: ['x', 'y'],
        b: [null, null],
        c: [undefined, 'z']
      })
    );
    mockParquetSchema.mockReturnValue({
      children: [{ element: { name: 'a' } }, { element: { name: 'b' } }, { element: { name: 'c' } }]
    });

    const provider = makeProvider({
      getMetadata: vi.fn().mockResolvedValue({ size: 1024, contentType: 'application/x-parquet' }),
      getObjectRange: vi.fn(() => Promise.resolve(makeStream()))
    });

    const res = await getParquetPreview(
      provider,
      'nulls.parquet',
      0,
      250,
      mockLog,
      undefined,
      true
    );
    const body = await readNdjsonResponse(res);
    expect(body.rows[0]).toEqual(['x', null, null]);
    expect(body.rows[1]).toEqual(['y', null, 'z']);
  });

  it('handles boolean and number values directly', async () => {
    mockParquetMetadataAsync.mockResolvedValue({ num_rows: 1n, row_groups: [] });
    mockParquetRead.mockImplementation((...args: unknown[]) =>
      resolvedMockParquetRead(args, {
        flag: [true],
        score: [98.5],
        count: [42]
      })
    );
    mockParquetSchema.mockReturnValue({
      children: [
        { element: { name: 'flag' } },
        { element: { name: 'score' } },
        { element: { name: 'count' } }
      ]
    });

    const provider = makeProvider({
      getMetadata: vi.fn().mockResolvedValue({ size: 1024, contentType: 'application/x-parquet' }),
      getObjectRange: vi.fn(() => Promise.resolve(makeStream()))
    });

    const res = await getParquetPreview(
      provider,
      'values.parquet',
      0,
      250,
      mockLog,
      undefined,
      true
    );
    const body = await readNdjsonResponse(res);
    expect(body.rows[0]).toEqual([true, 98.5, 42]);
  });

  it('returns empty rows and logs error when parquet parsing fails', async () => {
    mockParquetMetadataAsync.mockResolvedValue({ num_rows: 1n, row_groups: [] });
    mockParquetRead.mockRejectedValue(new Error('Corrupt parquet data'));

    const provider = makeProvider({
      getMetadata: vi.fn().mockResolvedValue({ size: 1024, contentType: 'application/x-parquet' }),
      getObjectRange: vi.fn(() => Promise.resolve(makeStream()))
    });

    const res = await getParquetPreview(
      provider,
      'corrupt.parquet',
      0,
      250,
      mockLog,
      undefined,
      true
    );

    expect(res.status).toBe(200);
    const body = await readNdjsonResponse(res);
    expect(body.error).toBe('Server error');
  });

  it('caches metadata in memory for subsequent calls', async () => {
    mockParquetMetadataAsync.mockResolvedValue({ num_rows: 5n, row_groups: [] });
    mockParquetRead.mockImplementation((...args: unknown[]) => {
      const data = Array.from({ length: 5 }, (_, i) => BigInt(i));
      return resolvedMockParquetRead(args, { id: data });
    });
    mockParquetSchema.mockReturnValue({
      children: [{ element: { name: 'id' } }]
    });

    const provider = makeProvider({
      getMetadata: vi.fn().mockResolvedValue({ size: 1024, contentType: 'application/x-parquet' }),
      getObjectRange: vi.fn(() => Promise.resolve(makeStream()))
    });

    // First call — parses metadata
    await getParquetPreview(provider, 'cached.parquet', 0, 5, mockLog);
    expect(mockParquetMetadataAsync).toHaveBeenCalledTimes(1);

    // Second call — should hit cache, not call parquetMetadataAsync again
    await getParquetPreview(provider, 'cached.parquet', 0, 5, mockLog);
    expect(mockParquetMetadataAsync).toHaveBeenCalledTimes(1);
  });

  it('blocks preview for GZIP parquet without offset index', async () => {
    mockParquetMetadataAsync.mockResolvedValue({
      num_rows: 5n,
      row_groups: [
        {
          num_rows: 5n,
          total_byte_size: 1000n,
          columns: [
            {
              file_offset: 100n,
              meta_data: {
                type: 'BYTE_ARRAY',
                codec: 'GZIP',
                path_in_schema: ['name'],
                num_values: 5n,
                total_compressed_size: 200n,
                total_uncompressed_size: 100n,
                data_page_offset: 100n,
                encodings: ['PLAIN']
              },
              offset_index_offset: null,
              offset_index_length: null
            }
          ]
        }
      ],
      created_by: 'test',
      version: 1
    });

    const provider = makeProvider({
      getMetadata: vi.fn().mockResolvedValue({ size: 1024, contentType: 'application/x-parquet' }),
      getObjectRange: vi.fn(() => Promise.resolve(makeStream()))
    });

    const res = await getParquetPreview(provider, 'gzip-no-offset.parquet', 0, 250, mockLog);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Preview-Format')).toBe('parquet');
    expect(res.headers.get('X-Preview-Renderable')).toBe('true');
    expect(res.headers.get('X-Preview-Data-Blocked')).toBe('true');
    expect(res.headers.get('X-Preview-Total-Size')).toBe('1024');
    const body = await readNdjsonResponse(res);
    expect(body.headers).toEqual(['id', 'name', 'active']);
    expect(body.metadata).toBeDefined();
    expect(body.metadata?.rowGroups).toBe(1);
    expect(body.rows).toEqual([]);
  });

  it('allows preview for GZIP parquet when offset index is present', async () => {
    mockParquetMetadataAsync.mockResolvedValue({
      num_rows: 2n,
      row_groups: [
        {
          num_rows: 2n,
          total_byte_size: 500n,
          columns: [
            {
              file_offset: 100n,
              meta_data: {
                type: 'BYTE_ARRAY',
                codec: 'GZIP',
                path_in_schema: ['name'],
                num_values: 2n,
                total_compressed_size: 100n,
                total_uncompressed_size: 50n,
                data_page_offset: 100n,
                encodings: ['PLAIN']
              },
              offset_index_offset: 500n,
              offset_index_length: 50
            }
          ]
        }
      ],
      created_by: 'test',
      version: 1
    });
    mockParquetSchema.mockReturnValue({
      children: [
        {
          element: {
            name: 'name',
            type: 'BYTE_ARRAY',
            converted_type: 'UTF8',
            logical_type: { type: 'STRING' }
          }
        }
      ]
    });
    mockParquetRead.mockImplementation((...args: unknown[]) =>
      resolvedMockParquetRead(args, { name: ['Alice', 'Bob'] })
    );

    const provider = makeProvider({
      getMetadata: vi.fn().mockResolvedValue({ size: 1024, contentType: 'application/x-parquet' }),
      getObjectRange: vi.fn(() => Promise.resolve(makeStream()))
    });

    const res = await getParquetPreview(
      provider,
      'gzip-with-offset.parquet',
      0,
      250,
      mockLog,
      undefined,
      true
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Preview-Format')).toBe('parquet');
    expect(res.headers.get('X-Preview-Renderable')).toBe('true');
    const body = await readNdjsonResponse(res);
    expect(body.headers).toEqual(['name']);
    expect(body.rows).toEqual([['Alice'], ['Bob']]);
  });

  it('allows preview for non-GZIP parquet without offset index', async () => {
    mockParquetMetadataAsync.mockResolvedValue({
      num_rows: 2n,
      row_groups: [
        {
          num_rows: 2n,
          total_byte_size: 500n,
          columns: [
            {
              file_offset: 100n,
              meta_data: {
                type: 'BYTE_ARRAY',
                codec: 'SNAPPY',
                path_in_schema: ['name'],
                num_values: 2n,
                total_compressed_size: 100n,
                total_uncompressed_size: 50n,
                data_page_offset: 100n,
                encodings: ['PLAIN']
              },
              offset_index_offset: null,
              offset_index_length: null
            }
          ]
        }
      ],
      created_by: 'test',
      version: 1
    });
    mockParquetSchema.mockReturnValue({
      children: [
        {
          element: {
            name: 'name',
            type: 'BYTE_ARRAY',
            converted_type: 'UTF8',
            logical_type: { type: 'STRING' }
          }
        }
      ]
    });
    mockParquetRead.mockImplementation((...args: unknown[]) =>
      resolvedMockParquetRead(args, { name: ['Alice'] })
    );

    const provider = makeProvider({
      getMetadata: vi.fn().mockResolvedValue({ size: 1024, contentType: 'application/x-parquet' }),
      getObjectRange: vi.fn(() => Promise.resolve(makeStream()))
    });

    const res = await getParquetPreview(provider, 'snappy-no-offset.parquet', 0, 250, mockLog);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Preview-Format')).toBe('parquet');
    expect(res.headers.get('X-Preview-Renderable')).toBe('true');
    const body = await readNdjsonResponse(res);
    expect(body.headers).toEqual(['name']);
  });
});
