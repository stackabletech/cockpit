import { describe, expect, it, vi } from 'vitest';
import { processKeysSequentially } from './operations.js';
import type { StorageProvider } from './provider.js';

function provider(overrides: Partial<StorageProvider> = {}): StorageProvider {
  return {
    listContainers: vi.fn(),
    listObjects: vi.fn(),
    getObject: vi.fn(),
    getObjectRange: vi.fn(),
    getMetadata: vi.fn(),
    exists: vi.fn().mockResolvedValue(false),
    putObject: vi.fn(),
    deleteObjects: vi.fn().mockResolvedValue({ failed: [] }),
    listAllKeys: vi.fn(),
    listAllKeysProgressively: vi.fn(),
    getBucketVersioning: vi.fn(),
    getBucketLifecycleRules: vi.fn(),
    getBucketTags: vi.fn(),
    getBucketAcl: vi.fn(),
    copyObject: vi.fn(),
    ...overrides
  } as StorageProvider;
}

describe('processKeysSequentially', () => {
  it('streams a progress-enabled cross-bucket copy through the destination provider', async () => {
    const stream = new ReadableStream();
    const source = provider({
      getObject: vi.fn().mockResolvedValue({
        stream,
        contentType: 'text/plain',
        contentLength: 3
      })
    });
    const destination = provider();
    const onCopyProgress = vi.fn();

    await processKeysSequentially(source, ['file.txt'], '', {
      destinationProvider: destination,
      onCopyProgress
    });

    expect(source.copyObject).not.toHaveBeenCalled();
    expect(destination.putObject).toHaveBeenCalledWith('file.txt', stream, 'text/plain', 3);
    expect(onCopyProgress).toHaveBeenCalledWith('file.txt', 'file.txt', 3, 3);
  });
});
