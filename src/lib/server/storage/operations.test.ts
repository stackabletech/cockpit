import { describe, expect, it, vi } from 'vitest';
import { processKeysSequentially } from './operations.js';
import type { StorageProvider } from './provider.js';

function provider(overrides: Partial<StorageProvider> = {}): StorageProvider {
  return {
    listContainers: vi.fn(),
    listObjects: vi.fn().mockResolvedValue({ objects: [] }),
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
  it('renames a whole virtual folder subtree', async () => {
    const source = provider({
      listAllKeys: vi.fn().mockResolvedValue(['docs/a.txt', 'docs/nested/b.txt'])
    });
    await processKeysSequentially(source, ['docs/'], '', { deleteOriginals: true }, 'renamed/');
    expect(source.copyObject).toHaveBeenCalledWith('docs/a.txt', 'renamed/a.txt');
    expect(source.copyObject).toHaveBeenCalledWith('docs/nested/b.txt', 'renamed/nested/b.txt');
    expect(source.deleteObjects).toHaveBeenCalledWith(
      expect.arrayContaining(['docs/a.txt', 'docs/nested/b.txt']),
      false
    );
  });
  it('resolves a conflicting folder root once for all children', async () => {
    const source = provider({
      listAllKeys: vi.fn().mockResolvedValue(['docs/', 'docs/a.txt', 'docs/nested/b.txt']),
      exists: vi.fn(async (key: string) => key === 'target/docs/')
    });
    await processKeysSequentially(source, ['docs/'], 'target/');
    expect(source.copyObject).toHaveBeenCalledWith('docs/', 'target/docs (1)/');
    expect(source.copyObject).toHaveBeenCalledWith('docs/a.txt', 'target/docs (1)/a.txt');
    expect(source.copyObject).toHaveBeenCalledWith(
      'docs/nested/b.txt',
      'target/docs (1)/nested/b.txt'
    );
  });
  it('deletes successful folder markers without recursive prefix expansion', async () => {
    const source = provider({ listAllKeys: vi.fn().mockResolvedValue(['docs/', 'docs/a.txt']) });
    await processKeysSequentially(source, ['docs/'], 'target/', { deleteOriginals: true });
    expect(source.deleteObjects).toHaveBeenCalledWith(
      expect.arrayContaining(['docs/', 'docs/a.txt']),
      false
    );
  });
  it('preserves a source marker and failed children during a partial move', async () => {
    const source = provider({
      listAllKeys: vi.fn().mockResolvedValue(['docs/', 'docs/good.txt', 'docs/failed.txt']),
      copyObject: vi.fn(async (key: string) => {
        if (key.endsWith('failed.txt')) throw new Error('copy failed');
      })
    });
    const result = await processKeysSequentially(source, ['docs/'], 'target/', {
      deleteOriginals: true
    });
    expect(result.failed).toHaveLength(1);
    expect(source.deleteObjects).toHaveBeenCalledWith(['docs/good.txt'], false);
  });
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
