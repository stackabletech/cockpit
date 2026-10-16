import { describe, it, expect, vi } from 'vitest';
import { streamPreview } from './stream.js';
import type { StorageProvider } from '$lib/server/storage/provider.js';
import { createMockLogger } from '$lib/test-utils/mock-logger.js';

const mockLog = createMockLogger();

function makeProvider(overrides: Partial<StorageProvider> = {}): StorageProvider {
  return {
    listContainers: vi.fn(),
    listObjects: vi.fn(),
    getObject: vi
      .fn()
      .mockResolvedValue({ stream: new ReadableStream(), contentType: 'text/plain' }),
    getObjectRange: vi.fn().mockResolvedValue(new ReadableStream()),
    getMetadata: vi.fn(),
    exists: vi.fn(),
    putObject: vi.fn(),
    putObjectIfMatch: vi.fn(),
    deleteObjects: vi.fn(),
    prefixExists: vi.fn(),
    listAllKeysProgressively: vi.fn(),
    search: vi.fn(),
    getBucketVersioning: vi.fn(),
    getBucketLifecycleRules: vi.fn(),
    getBucketTags: vi.fn(),
    getBucketAcl: vi.fn(),
    copyObject: vi.fn(),
    ...overrides
  };
}

describe('streamPreview', () => {
  it('uses full getObject when totalSize <= text limit (256KB)', async () => {
    const provider = makeProvider();
    const res = await streamPreview(provider, 'file.txt', 'text/plain', 1000, 'user1', mockLog);
    expect(provider.getObject).toHaveBeenCalledWith('file.txt');
    expect(provider.getObjectRange).not.toHaveBeenCalled();
    expect(res.headers.get('X-Preview-Truncated')).toBe('false');
    expect(res.headers.get('X-Preview-Bytes')).toBe('1000');
  });

  it('loads an editable text file completely with the ETag of the GET', async () => {
    const provider = makeProvider({
      getObject: vi.fn().mockResolvedValue({ stream: new ReadableStream(), etag: '"e1"' })
    });
    const totalSize = 300 * 1024; // above the 256 KiB text limit, below the 5 MiB edit limit
    const res = await streamPreview(provider, 'mid.txt', 'text/plain', totalSize, 'user1', mockLog);
    expect(provider.getObject).toHaveBeenCalledWith('mid.txt');
    expect(provider.getObjectRange).not.toHaveBeenCalled();
    expect(res.headers.get('X-Preview-Truncated')).toBe('false');
    expect(res.headers.get('X-Preview-Bytes')).toBe(String(totalSize));
    expect(res.headers.get('X-Preview-ETag')).toBe('"e1"');
  });

  it.each([
    ['application/octet-stream', 'data.bin'],
    ['text/tab-separated-values', 'table.tsv'],
    ['text/plain', 'table.tsv'],
    ['text/csv', 'table.csv']
  ])('keeps the text preview limit for non-editable %s (%s)', async (contentType, key) => {
    const provider = makeProvider();
    const totalSize = 300 * 1024;
    const res = await streamPreview(provider, key, contentType, totalSize, 'user1', mockLog);
    expect(provider.getObject).not.toHaveBeenCalled();
    expect(provider.getObjectRange).toHaveBeenCalledWith(key, 0, 256 * 1024 - 1);
    expect(res.headers.get('X-Preview-Truncated')).toBe('true');
  });

  it('uses getObjectRange without an ETag when totalSize > edit limit', async () => {
    const provider = makeProvider();
    const totalSize = 6 * 1024 * 1024;
    const res = await streamPreview(provider, 'big.txt', 'text/plain', totalSize, 'user1', mockLog);
    expect(provider.getObjectRange).toHaveBeenCalledWith('big.txt', 0, 256 * 1024 - 1);
    expect(res.headers.get('X-Preview-Truncated')).toBe('true');
    expect(res.headers.get('X-Preview-Bytes')).toBe(String(256 * 1024));
    expect(res.headers.get('X-Preview-Total-Size')).toBe(String(totalSize));
    expect(res.headers.get('X-Preview-ETag')).toBeNull();
  });

  it('uses 5MB limit for images', async () => {
    const provider = makeProvider();
    const totalSize = 6 * 1024 * 1024;
    await streamPreview(provider, 'img.png', 'image/png', totalSize, 'user1', mockLog);
    expect(provider.getObjectRange).toHaveBeenCalledWith('img.png', 0, 5 * 1024 * 1024 - 1);
  });

  it('uses 25MB limit for PDFs', async () => {
    const provider = makeProvider();
    const totalSize = 30 * 1024 * 1024;
    await streamPreview(provider, 'doc.pdf', 'application/pdf', totalSize, 'user1', mockLog);
    expect(provider.getObjectRange).toHaveBeenCalledWith('doc.pdf', 0, 25 * 1024 * 1024 - 1);
  });

  it('fetches full PDF when under limit', async () => {
    const provider = makeProvider();
    await streamPreview(provider, 'small.pdf', 'application/pdf', 1000, 'user1', mockLog);
    expect(provider.getObject).toHaveBeenCalledWith('small.pdf');
  });

  it('sets X-Preview-Renderable to true', async () => {
    const provider = makeProvider();
    const res = await streamPreview(provider, 'f.txt', 'text/plain', 10, 'user1', mockLog);
    expect(res.headers.get('X-Preview-Renderable')).toBe('true');
  });
});
