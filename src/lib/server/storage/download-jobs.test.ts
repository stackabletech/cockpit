import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getProvider: vi.fn(),
  listAllKeys: vi.fn(),
  getMetadata: vi.fn(),
  getObject: vi.fn()
}));

vi.mock('./utils.js', () => ({ getProvider: mocks.getProvider }));

const openStream = () =>
  new ReadableStream({
    start() {
      // Never emit data or close, so the job stays running until cancelled.
    },
    cancel() {
      // Cancellation path.
    }
  });

import {
  archiveFileName,
  cancelDownloadJob,
  clearDownloadRootForTests,
  createDownloadJob,
  getDownloadJob
} from './download-jobs.js';
import type { S3ConnectionConfig } from './types.js';

const config: S3ConnectionConfig = {
  type: 's3',
  host: '127.0.0.1',
  accessStyle: 'Path',
  region: { name: 'us-east-1' }
};

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('download jobs', () => {
  beforeEach(async () => {
    await clearDownloadRootForTests();
    mocks.listAllKeys.mockReset().mockResolvedValue([]);
    mocks.getMetadata.mockReset().mockResolvedValue({
      size: 1024,
      lastModified: new Date(),
      contentType: 'application/octet-stream',
      etag: 'etag',
      customMetadata: undefined
    });
    mocks.getObject.mockReset().mockResolvedValue({ stream: openStream() });
    mocks.getProvider.mockReturnValue({
      listAllKeys: mocks.listAllKeys,
      getMetadata: mocks.getMetadata,
      getObject: mocks.getObject,
      exists: vi.fn().mockResolvedValue(true)
    });
  });

  it('cleans the on-disk download cache', async () => {
    await expect(clearDownloadRootForTests()).resolves.toBeUndefined();
  });

  it('uses a normal archive name until multipart output is required', () => {
    expect(archiveFileName('reports')).toBe('reports.zip');
    expect(archiveFileName('reports', 1)).toBe('reports.z01');
    expect(archiveFileName('reports', 12)).toBe('reports.z12');
  });

  it('cancels a running job and stops its in-flight download', async () => {
    const job = createDownloadJob('user-1', 'bucket', 'prefix/', ['file.txt'], config);
    await flush();
    await flush();

    expect(getDownloadJob('user-1', job.id)?.status).toBe('running');

    expect(cancelDownloadJob('user-1', job.id)).toBe(true);
    await flush();
    await flush();

    expect(getDownloadJob('user-1', job.id)?.status).toBe('cancelled');
  });

  it('returns false for unknown or foreign jobs', async () => {
    expect(cancelDownloadJob('user-1', 'missing-id')).toBe(false);

    const job = createDownloadJob('user-1', 'bucket', 'prefix/', ['file.txt'], config);
    await flush();
    await flush();

    expect(cancelDownloadJob('other-user', job.id)).toBe(false);
  });

  it('is idempotent for an already cancelled job', async () => {
    const job = createDownloadJob('user-1', 'bucket', 'prefix/', ['file.txt'], config);
    await flush();
    await flush();

    expect(cancelDownloadJob('user-1', job.id)).toBe(true);
    expect(cancelDownloadJob('user-1', job.id)).toBe(true);
  });
});
