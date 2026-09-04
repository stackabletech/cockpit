import { describe, it, expect, vi } from 'vitest';
import type pino from 'pino';
import { streamPreview } from './stream.js';
import type { StorageProvider } from '$lib/server/storage/provider.js';

const mockLog = { info: vi.fn(), debug: vi.fn(), warn: vi.fn() } as unknown as pino.Logger;

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
    deleteObjects: vi.fn(),
    listAllKeys: vi.fn(),
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

  it('uses getObjectRange when totalSize > text limit', async () => {
    const provider = makeProvider();
    const totalSize = 300 * 1024;
    const res = await streamPreview(provider, 'big.txt', 'text/plain', totalSize, 'user1', mockLog);
    expect(provider.getObjectRange).toHaveBeenCalledWith('big.txt', 0, 256 * 1024 - 1);
    expect(res.headers.get('X-Preview-Truncated')).toBe('true');
    expect(res.headers.get('X-Preview-Bytes')).toBe(String(256 * 1024));
    expect(res.headers.get('X-Preview-Total-Size')).toBe(String(totalSize));
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
