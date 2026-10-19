import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/logging', () => import('$lib/test-utils/mock-logger.js'));

import { parseParquetDisallowed, resolveArchiveCacheMaxBytes } from './feature-flags.js';

const MB = 1024 * 1024;

describe('resolveArchiveCacheMaxBytes', () => {
  it('keeps a limit of at least twice the preview limit', () => {
    expect(resolveArchiveCacheMaxBytes(512 * MB, 100 * MB)).toBe(512 * MB);
    expect(resolveArchiveCacheMaxBytes(200 * MB, 100 * MB)).toBe(200 * MB);
  });

  it('raises a lower limit to twice the preview limit', () => {
    expect(resolveArchiveCacheMaxBytes(150 * MB, 100 * MB)).toBe(200 * MB);
  });
});

describe('parseParquetDisallowed', () => {
  it('defaults to GZIP with requireOffsetIndex when value is undefined', () => {
    expect(parseParquetDisallowed(undefined)).toEqual([
      { codec: 'GZIP', requireOffsetIndex: true }
    ]);
  });

  it('defaults to GZIP with requireOffsetIndex when value is empty string', () => {
    expect(parseParquetDisallowed('')).toEqual([{ codec: 'GZIP', requireOffsetIndex: true }]);
  });

  it('parses a single codec without suffix', () => {
    expect(parseParquetDisallowed('zstd')).toEqual([{ codec: 'ZSTD', requireOffsetIndex: false }]);
  });

  it('parses a codec with -no_offset suffix', () => {
    expect(parseParquetDisallowed('gzip-no_offset')).toEqual([
      { codec: 'GZIP', requireOffsetIndex: true }
    ]);
  });

  it('parses comma-separated list with mixed suffixes', () => {
    expect(parseParquetDisallowed('gzip-no_offset,zstd,snappy-no_offset')).toEqual([
      { codec: 'GZIP', requireOffsetIndex: true },
      { codec: 'ZSTD', requireOffsetIndex: false },
      { codec: 'SNAPPY', requireOffsetIndex: true }
    ]);
  });

  it('converts codec names to uppercase', () => {
    expect(parseParquetDisallowed('Gzip,Zstd')).toEqual([
      { codec: 'GZIP', requireOffsetIndex: false },
      { codec: 'ZSTD', requireOffsetIndex: false }
    ]);
  });

  it('filters out empty entries', () => {
    expect(parseParquetDisallowed('gzip,,zstd')).toEqual([
      { codec: 'GZIP', requireOffsetIndex: false },
      { codec: 'ZSTD', requireOffsetIndex: false }
    ]);
  });

  it('trims whitespace', () => {
    expect(parseParquetDisallowed(' gzip , zstd ')).toEqual([
      { codec: 'GZIP', requireOffsetIndex: false },
      { codec: 'ZSTD', requireOffsetIndex: false }
    ]);
  });
});
