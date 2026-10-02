import { describe, expect, it, vi } from 'vitest';

const { mockPerformCopyOrMove } = vi.hoisted(() => ({ mockPerformCopyOrMove: vi.fn() }));
vi.mock('$lib/server/storage/copy-move.js', () => ({
  performCopyOrMove: mockPerformCopyOrMove
}));
vi.mock('$lib/server/storage/request-context.js', () => ({
  createStorageProvider: () => ({ provider: {}, bucket: 'bucket' })
}));

import { POST } from './+server.js';

function mockEvent(body: unknown) {
  return {
    request: new Request('http://localhost/api/storage/move?bucket=bucket', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
    url: new URL('http://localhost/api/storage/move?bucket=bucket'),
    locals: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } }
  } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/storage/move', () => {
  it('accepts an explicit destination key for a single-item rename', async () => {
    mockPerformCopyOrMove.mockResolvedValue(new Response());

    await POST(mockEvent({ sourceKeys: ['old.txt'], destinationKey: 'new.txt' }));

    expect(mockPerformCopyOrMove).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKeys: ['old.txt'],
        destinationPrefix: '',
        destinationKey: 'new.txt',
        deleteOriginals: true
      })
    );
  });

  it('rejects an explicit destination key for multiple source keys', async () => {
    await expect(
      POST(mockEvent({ sourceKeys: ['first.txt', 'second.txt'], destinationKey: 'new.txt' }))
    ).rejects.toThrow(expect.objectContaining({ status: 400 }));
  });
});
