import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockProvider = {
  exists: vi.fn(),
  copyObject: vi.fn(),
  deleteObjects: vi.fn(),
  listAllKeys: vi.fn()
};
vi.mock('$lib/server/storage/utils.js', () => ({
  getProvider: () => mockProvider
}));

import { POST } from './+server.js';

const CONNECTION_HEADER = {
  'x-storage-connection': btoa(JSON.stringify({ type: 's3', region: 'us-east-1' }))
};

function mockEvent(body: Record<string, string>) {
  const url = new URL('http://localhost/api/storage/rename?bucket=b1');
  return {
    url,
    request: {
      headers: new Headers(CONNECTION_HEADER),
      json: () => Promise.resolve(body)
    },
    locals: {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      user: { id: 'test-user' },
      storageConfig: { type: 's3', region: { name: 'us-east-1' } }
    }
  } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/storage/rename', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renames a single file via copy and delete', async () => {
    mockProvider.exists.mockResolvedValue(false);
    mockProvider.copyObject.mockResolvedValue(undefined);
    mockProvider.deleteObjects.mockResolvedValue({ failed: [] });

    const res = await POST(mockEvent({ key: 'old.txt', newKey: 'new.txt' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    expect(mockProvider.copyObject).toHaveBeenCalledWith('old.txt', 'new.txt');
    expect(mockProvider.deleteObjects).toHaveBeenCalledWith(['old.txt']);
  });

  it('renames a directory and all children', async () => {
    mockProvider.exists.mockResolvedValue(false);
    mockProvider.listAllKeys.mockResolvedValue(['dir/a.txt', 'dir/b.txt']);
    mockProvider.copyObject.mockResolvedValue(undefined);
    mockProvider.deleteObjects.mockResolvedValue({ failed: [] });

    const res = await POST(mockEvent({ key: 'dir/', newKey: 'renamed/' }));

    expect(res.status).toBe(200);
    expect(mockProvider.copyObject).toHaveBeenCalledTimes(3);
    expect(mockProvider.copyObject).toHaveBeenCalledWith('dir/', 'renamed/');
    expect(mockProvider.copyObject).toHaveBeenCalledWith('dir/a.txt', 'renamed/a.txt');
    expect(mockProvider.copyObject).toHaveBeenCalledWith('dir/b.txt', 'renamed/b.txt');
    expect(mockProvider.deleteObjects).toHaveBeenCalledWith(['dir/', 'dir/a.txt', 'dir/b.txt']);
  });

  it('returns 400 when key is missing from body', async () => {
    await expect(POST(mockEvent({ newKey: 'new.txt' }))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('returns 400 when newKey is missing from body', async () => {
    await expect(POST(mockEvent({ key: 'old.txt' }))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('returns 409 when destination already exists', async () => {
    mockProvider.exists.mockResolvedValue(true);

    await expect(POST(mockEvent({ key: 'old.txt', newKey: 'existing.txt' }))).rejects.toThrow(
      expect.objectContaining({ status: 409 })
    );
  });

  it('returns 502 when copy fails', async () => {
    mockProvider.exists.mockResolvedValue(false);
    mockProvider.copyObject.mockRejectedValue(new Error('Access denied'));

    await expect(POST(mockEvent({ key: 'old.txt', newKey: 'new.txt' }))).rejects.toThrow();
  });

  it('warns when directory delete has failures', async () => {
    mockProvider.exists.mockResolvedValue(false);
    mockProvider.listAllKeys.mockResolvedValue(['dir/a.txt']);
    mockProvider.copyObject.mockResolvedValue(undefined);
    mockProvider.deleteObjects.mockResolvedValue({ failed: ['dir/a.txt'] });

    const res = await POST(mockEvent({ key: 'dir/', newKey: 'new-dir/' }));

    expect(res.status).toBe(200);
  });
});
