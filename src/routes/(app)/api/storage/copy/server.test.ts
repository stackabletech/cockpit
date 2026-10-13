import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPerformCopyOrMove, flags } = vi.hoisted(() => ({
  mockPerformCopyOrMove: vi.fn(),
  flags: { storagePasteEnabled: true }
}));
vi.mock('$lib/server/feature-flags.js', () => ({
  get storagePasteEnabled() {
    return flags.storagePasteEnabled;
  }
}));
vi.mock('$lib/server/storage/copy-move.js', () => ({
  performCopyOrMove: mockPerformCopyOrMove
}));
vi.mock('$lib/server/storage/request-context.js', () => ({
  createStorageProvider: () => ({ provider: {}, bucket: 'bucket' }),
  createStorageProviderForBucket: () => ({})
}));

import { POST } from './+server.js';

function mockEvent(body: unknown) {
  return {
    request: new Request('http://localhost/api/storage/copy?bucket=bucket', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
    url: new URL('http://localhost/api/storage/copy?bucket=bucket'),
    locals: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } }
  } as unknown as Parameters<typeof POST>[0];
}

const body = { sourceKeys: ['dir/file.txt'], destinationPrefix: 'other/' };

describe('POST /api/storage/copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPerformCopyOrMove.mockResolvedValue(new Response());
    flags.storagePasteEnabled = true;
  });

  it('copies when paste is enabled', async () => {
    await POST(mockEvent(body));

    expect(mockPerformCopyOrMove).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKeys: ['dir/file.txt'],
        destinationPrefix: 'other/',
        deleteOriginals: false
      })
    );
  });

  it('rejects with 404 when paste is disabled', async () => {
    flags.storagePasteEnabled = false;

    await expect(POST(mockEvent(body))).rejects.toThrow(expect.objectContaining({ status: 404 }));
    expect(mockPerformCopyOrMove).not.toHaveBeenCalled();
  });
});
