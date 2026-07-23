import { describe, it, expect } from 'vitest';
import { parseParquetDisallowed } from './feature-flags.js';

describe('parseParquetDisallowed', () => {
  it('defaults to GZIP with requireOffsetIndex when value is undefined', () => {
    expect(parseParquetDisallowed(undefined)).toEqual([
      { codec: 'GZIP', requireOffsetIndex: true }
    ]);
  });

  it('defaults to GZIP with requireOffsetIndex when value is empty string', () => {
    expect(parseParquetDisallowed('')).toEqual([
      { codec: 'GZIP', requireOffsetIndex: true }
    ]);
  });

  it('parses a single codec without suffix', () => {
    expect(parseParquetDisallowed('zstd')).toEqual([
      { codec: 'ZSTD', requireOffsetIndex: false }
    ]);
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
