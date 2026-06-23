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
}> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let resultHeaders: string[] = [];
  const rows: unknown[][] = [];
  let resultTotalRows = 0;
  let error: string | undefined;

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
    error
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

  // Simulate column data streaming: fire onChunk for each column
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
        { element: { name: 'id' } },
        { element: { name: 'name' } },
        { element: { name: 'active' } }
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
    expect(mockParquetMetadataAsync).not.toHaveBeenCalled();
  });

  it('parses parquet metadata and returns headers and rows', async () => {
    mockParquetMetadataAsync.mockResolvedValue({ num_rows: 2n, row_groups: [] });
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

    const res = await getParquetPreview(provider, 'data.parquet', 0, 250, mockLog);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Preview-Format')).toBe('parquet');
    expect(res.headers.get('X-Preview-Renderable')).toBe('true');
    expect(res.headers.get('X-Preview-Total-Rows')).toBe('2');
    expect(res.headers.get('X-Preview-Thumbnail')).toBeNull();
    expect(res.headers.get('X-Preview-Total-Size')).toBe('1024');
    expect(res.headers.get('X-Preview-Offset')).toBe('0');

    const body = await readNdjsonResponse(res);
    expect(body.headers).toEqual(['id', 'name', 'active']);
    expect(body.rows).toEqual([
      ['1', 'Alice', true],
      ['2', 'Bob', false]
    ]);
    expect(body.totalRows).toBe(2);
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

    const res = await getParquetPreview(provider, 'large.parquet', 500, 50, mockLog);

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

    const res = await getParquetPreview(provider, 'final.parquet', 50, 250, mockLog);

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

    const res = await getParquetPreview(provider, 'bigint.parquet');
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

    const res = await getParquetPreview(provider, 'dates.parquet');
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

    const res = await getParquetPreview(provider, 'blob.parquet');
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

    const res = await getParquetPreview(provider, 'nested.parquet');
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

    const res = await getParquetPreview(provider, 'nulls.parquet');
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

    const res = await getParquetPreview(provider, 'values.parquet');
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

    const res = await getParquetPreview(provider, 'corrupt.parquet', 0, 250, mockLog);

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
});
