import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/logging', () => import('$lib/test-utils/mock-logger.js'));

import { parseStorageConfig } from './config.js';

const MB = 1024 * 1024;

describe('parseStorageConfig', () => {
  it('uses the defaults when nothing is set', () => {
    const config = parseStorageConfig({});
    expect(config.archivePreviewMaxBytes).toBe(100 * MB);
    expect(config.archiveCacheMaxBytes).toBe(512 * MB);
    expect(config.downloadHistoryRetentionMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(config.parquetDisallowedCompression).toEqual([
      { codec: 'GZIP', requireOffsetIndex: true }
    ]);
    expect(config.tlsCaCertPath).toBeUndefined();
  });

  it('parses Parquet codecs with and without the -no_offset suffix', () => {
    const config = parseStorageConfig({
      STACKABLE_COCKPIT_PARQUET_PREVIEW_DISALLOWED_COMPRESSION_TYPES: 'zstd, Snappy-no_offset'
    });
    expect(config.parquetDisallowedCompression).toEqual([
      { codec: 'ZSTD', requireOffsetIndex: false },
      { codec: 'SNAPPY', requireOffsetIndex: true }
    ]);
  });

  it('limits the download history retention to 3650 days', () => {
    expect(() =>
      parseStorageConfig({ STACKABLE_COCKPIT_DOWNLOAD_HISTORY_RETENTION_DAYS: '3651' })
    ).toThrow(/STACKABLE_COCKPIT_DOWNLOAD_HISTORY_RETENTION_DAYS/);
  });

  it('raises the archive cache to twice the archive preview limit', () => {
    const config = parseStorageConfig({
      STACKABLE_COCKPIT_ARCHIVE_PREVIEW_MAX_MB: '300',
      STACKABLE_COCKPIT_ARCHIVE_CACHE_MAX_MB: '512'
    });
    expect(config.archiveCacheMaxBytes).toBe(600 * MB);
  });
});
