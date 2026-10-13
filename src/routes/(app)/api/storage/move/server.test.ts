import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPerformCopyOrMove, flags } = vi.hoisted(() => ({
  mockPerformCopyOrMove: vi.fn(),
  flags: { storageMoveEnabled: true, storagePasteEnabled: true, storageRenameEnabled: true }
}));
vi.mock('$lib/server/feature-flags.js', () => ({
  get storageMoveEnabled() {
    return flags.storageMoveEnabled;
  },
  get storagePasteEnabled() {
    return flags.storagePasteEnabled;
  },
  get storageRenameEnabled() {
    return flags.storageRenameEnabled;
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
    request: new Request('http://localhost/api/storage/move?bucket=bucket', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
    url: new URL('http://localhost/api/storage/move?bucket=bucket'),
    locals: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } }
  } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/storage/move', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPerformCopyOrMove.mockResolvedValue(new Response());
    Object.assign(flags, {
      storageMoveEnabled: true,
      storagePasteEnabled: true,
      storageRenameEnabled: true
    });
  });

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

  describe('feature flags', () => {
    const rename = { sourceKeys: ['dir/old.txt'], destinationKey: 'dir/new.txt' };
    const folderRename = { sourceKeys: ['dir/old/'], destinationKey: 'dir/new/' };
    const move = { sourceKeys: ['dir/old.txt'], destinationPrefix: 'other/' };
    const moveWithNewName = { sourceKeys: ['dir/old.txt'], destinationKey: 'other/new.txt' };
    const crossBucketRename = { ...rename, sourceBucket: 'elsewhere' };

    function only(enabled: Partial<typeof flags>) {
      Object.assign(
        flags,
        { storageMoveEnabled: false, storagePasteEnabled: false, storageRenameEnabled: false },
        enabled
      );
    }

    async function expectForbidden(body: unknown) {
      await expect(POST(mockEvent(body))).rejects.toThrow(expect.objectContaining({ status: 404 }));
      expect(mockPerformCopyOrMove).not.toHaveBeenCalled();
    }

    it('rejects every move when move, rename and paste are disabled', async () => {
      only({});
      for (const body of [rename, move, moveWithNewName]) await expectForbidden(body);
    });

    it('allows a same-folder rename with only rename enabled', async () => {
      only({ storageRenameEnabled: true });
      await POST(mockEvent(rename));
      await POST(mockEvent(folderRename));
      expect(mockPerformCopyOrMove).toHaveBeenCalledTimes(2);
    });

    it('rejects moves to another folder or bucket with only rename enabled', async () => {
      only({ storageRenameEnabled: true });
      for (const body of [move, moveWithNewName, crossBucketRename]) await expectForbidden(body);
    });

    it('allows moves but not same-folder renames with only move enabled', async () => {
      only({ storageMoveEnabled: true });
      await POST(mockEvent(move));
      await POST(mockEvent(moveWithNewName));
      expect(mockPerformCopyOrMove).toHaveBeenCalledTimes(2);
      mockPerformCopyOrMove.mockClear();
      await expectForbidden(rename);
    });

    it('allows cut-and-paste moves and keep-both renames with only paste enabled', async () => {
      only({ storagePasteEnabled: true });
      await POST(mockEvent(move));
      await POST(mockEvent(rename));
      expect(mockPerformCopyOrMove).toHaveBeenCalledTimes(2);
    });
  });
});
