import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pino from 'pino';
import type { StorageProvider } from '$lib/server/storage/provider.js';

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

// Use a small textPreviewBytes to force predictable chunk boundaries
vi.mock('$lib/server/feature-flags', () => ({
  textPreviewBytes: 11,
  infiniteScrollEnabled: true
}));

import { getCsvPreview } from './csv.js';

const mockLog = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(() => mockLog)
} as unknown as pino.Logger;

function makeProvider(
  getObjectRangeImpl: (key: string, start: number, end: number) => Promise<ReadableStream>
): StorageProvider {
  return {
    getObjectRange: vi.fn(getObjectRangeImpl),
    getObject: vi.fn(),
    getMetadata: vi.fn(),
    listContainers: vi.fn(),
    listObjects: vi.fn(),
    exists: vi.fn(),
    putObject: vi.fn(),
    deleteObjects: vi.fn(),
    listAllKeys: vi.fn(),
    listAllKeysProgressively: vi.fn(),
    getBucketVersioning: vi.fn(),
    getBucketLifecycleRules: vi.fn(),
    getBucketTags: vi.fn(),
    getBucketAcl: vi.fn(),
    copyObject: vi.fn()
  } as unknown as StorageProvider;
}

async function readNdjsonResponse(
  res: Response
): Promise<{ headers: string[]; rows: string[][]; totalRows: number }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const result: { headers: string[]; rows: string[][]; totalRows: number } = {
    headers: [],
    rows: [],
    totalRows: 0
  };

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
        result.headers = msg.h;
        result.totalRows = msg.tr;
      } else if (msg.t === 'r') {
        result.rows = msg.v;
      }
    }
  }
  return result;
}

function sliceProvider(content: string) {
  const enc = new TextEncoder();
  return makeProvider(async (_key: string, start: number, end: number) => {
    const slice = content.slice(start, end + 1);
    return new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode(slice));
        controller.close();
      }
    });
  });
}

describe('getCsvPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns rows when the whole file fits in one chunk', async () => {
    const fileContent = 'h\na\nb\nc\n';
    const provider = sliceProvider(fileContent);

    const res = await getCsvPreview(
      provider,
      'small',
      0,
      250,
      'text/csv',
      fileContent.length,
      mockLog,
      true
    );

    expect(res.headers.get('X-Preview-Total-Rows')).toBe('3');
    const body = await readNdjsonResponse(res);
    expect(body.rows).toEqual([['a'], ['b'], ['c']]);
    expect(body.totalRows).toBe(3);
  });

  it('does not create phantom rows at chunk boundary mid-line', async () => {
    // Bytes: h(0) \n(1) a(2) b(3) c(4) \n(5) d(6) e(7) f(8) \n(9) g(10) h(11) i(12)
    //        \n(13) j(14) k(15) l(16) \n(17) m(18) n(19) o(20) \n(21)
    // textPreviewBytes=11, range 0..10 = "h\nabc\ndef\ng" (ends mid-line "g")
    const fileContent = 'h\nabc\ndef\nghi\njkl\nmno\n';
    const fileSize = fileContent.length; // 22
    const provider = sliceProvider(fileContent);

    // First call loads chunk 1 (bytes 0..10) → rows "abc", "def". (Incomplete "g" deferred.)
    const res1 = await getCsvPreview(
      provider,
      'boundary',
      0,
      250,
      'text/csv',
      fileSize,
      mockLog,
      true
    );
    expect(res1.headers.get('X-Preview-Total-Rows')).toBe('2');

    // Second call triggers chunk 2 (bytes 10..20) → rows "ghi", "jkl". (Incomplete "mno" deferred.)
    const res2 = await getCsvPreview(
      provider,
      'boundary',
      2,
      250,
      'text/csv',
      fileSize,
      mockLog,
      true
    );
    expect(res2.headers.get('X-Preview-Total-Rows')).toBe('4');

    // Third call triggers chunk 3 (bytes 18..21) → row "mno"
    const res3 = await getCsvPreview(
      provider,
      'boundary',
      4,
      250,
      'text/csv',
      fileSize,
      mockLog,
      true
    );
    expect(res3.headers.get('X-Preview-Total-Rows')).toBe('5');

    // Now read the last page - should get 'mno' as complete row, not split
    const body3 = await readNdjsonResponse(res3);
    expect(body3.rows).toEqual([['mno']]);
    expect(body3.totalRows).toBe(5);
  });

  it('readRows returns correct rows across a chunk boundary', async () => {
    // Same file as above
    const fileContent = 'h\nabc\ndef\nghi\njkl\nmno\n';
    const fileSize = fileContent.length;
    const provider = sliceProvider(fileContent);

    // Load cache with first call
    await getCsvPreview(provider, 'read-test', 0, 250, 'text/csv', fileSize, mockLog, false);

    // Request data that straddles the chunk boundary (after chunk 1 loaded "abc","def")
    // chunk 2 needs to be triggered, which loads "ghi","jkl" (and defers "mno")
    const res = await getCsvPreview(
      provider,
      'read-test',
      1,
      3,
      'text/csv',
      fileSize,
      mockLog,
      true
    );
    const body = await readNdjsonResponse(res);
    // Should get "def" (index 1), "ghi" (index 2), "jkl" (index 3)
    expect(body.rows).toEqual([['def'], ['ghi'], ['jkl']]);
  });

  it('does not create phantom rows across multiple chunk boundaries', async () => {
    // File with 10 rows, each row 5 bytes ("rowN\n"), plus header "h\n" = 2 bytes
    // Total: 2 + 10*5 = 52 bytes. With textPreviewBytes=11, need ~6 extendCache calls.
    const fileContent = 'h\nrow0\nrow1\nrow2\nrow3\nrow4\nrow5\nrow6\nrow7\nrow8\nrow9\n';
    const fileSize = fileContent.length;
    const provider = sliceProvider(fileContent);

    // Load all data by making enough requests with increasing offsets
    // Each call triggers one chunk read. We load header first, then progressively
    // request data at higher offsets to force more chunks.
    for (let offset = 0; offset < 15; offset += 3) {
      await getCsvPreview(
        provider,
        'multi-boundary',
        offset,
        250,
        'text/csv',
        fileSize,
        mockLog,
        false
      );
    }

    // Now request all data
    const res = await getCsvPreview(
      provider,
      'multi-boundary',
      0,
      250,
      'text/csv',
      fileSize,
      mockLog,
      true
    );
    const body = await readNdjsonResponse(res);
    expect(body.totalRows).toBe(10);
    expect(body.rows).toHaveLength(10);
    expect(body.rows[0]).toEqual(['row0']);
    expect(body.rows[9]).toEqual(['row9']);
    // Verify no row is garbled (e.g. "w1" from a split "row1")
    expect(body.rows[1]).toEqual(['row1']);
    expect(body.rows[2]).toEqual(['row2']);
  });

  it('includes the last line when the file has no trailing newline', async () => {
    // E2E scenario: file without trailing \n on the last line.
    // The last line MUST be included even though text doesn't end with \n.
    const fileContent = 'h\na\nb'; // 5 bytes, fits in one chunk (textPreviewBytes=11)
    const provider = sliceProvider(fileContent);

    const res = await getCsvPreview(
      provider,
      'no-trailing-newline',
      0,
      250,
      'text/csv',
      fileContent.length,
      mockLog,
      true
    );

    expect(res.headers.get('X-Preview-Total-Rows')).toBe('2');
    const body = await readNdjsonResponse(res);
    expect(body.rows).toHaveLength(2);
    expect(body.rows).toEqual([['a'], ['b']]);
  });
});
