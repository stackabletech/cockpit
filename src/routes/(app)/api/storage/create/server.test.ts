import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockProvider = { putObject: vi.fn() };
vi.mock('$lib/server/storage/utils.js', () => ({
  getProvider: () => mockProvider
}));

import { POST } from './+server.js';

const CONNECTION_HEADER = {
  'x-storage-connection': btoa(JSON.stringify({ type: 's3', region: 'us-east-1' }))
};

function mockEvent(params: string) {
  const url = new URL(`http://localhost/api/storage/create?${params}`);
  return {
    url,
    request: { headers: new Headers(CONNECTION_HEADER) },
    locals: {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      user: { id: 'test-user' },
      storageConfig: { type: 's3', region: { name: 'us-east-1' } }
    }
  } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/storage/create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a directory marker when key ends with /', async () => {
    mockProvider.putObject.mockResolvedValue(undefined);

    const res = await POST(mockEvent('bucket=b1&key=folder/subfolder/'));

    expect(res.status).toBe(201);
    expect(mockProvider.putObject).toHaveBeenCalledWith(
      'folder/subfolder/',
      expect.any(Buffer),
      'application/x-directory',
      0
    );
  });

  it('creates a plain text object for non-directory keys', async () => {
    mockProvider.putObject.mockResolvedValue(undefined);

    const res = await POST(mockEvent('bucket=b1&key=my-file.txt'));

    expect(res.status).toBe(201);
    expect(mockProvider.putObject).toHaveBeenCalledWith(
      'my-file.txt',
      expect.any(Buffer),
      'text/plain',
      0
    );
  });

  it('returns 400 when key is missing', async () => {
    await expect(POST(mockEvent('bucket=b1'))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('creates inside a folder whose name S3 allows but new names may not use', async () => {
    mockProvider.putObject.mockResolvedValue(undefined);
    const params = new URLSearchParams({ bucket: 'b1', key: 'reports?2024/../a\\b/new.txt' });

    const res = await POST(mockEvent(params.toString()));

    expect(res.status).toBe(201);
    expect(mockProvider.putObject).toHaveBeenCalledWith(
      'reports?2024/../a\\b/new.txt',
      expect.any(Buffer),
      'text/plain',
      0
    );
  });

  it('rejects keys longer than S3 allows', async () => {
    const params = new URLSearchParams({ bucket: 'b1', key: 'a'.repeat(1025) });

    await expect(POST(mockEvent(params.toString()))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('propagates provider errors as 502', async () => {
    mockProvider.putObject.mockRejectedValue(new Error('S3 connection refused'));

    await expect(POST(mockEvent('bucket=b1&key=fail.txt'))).rejects.toThrow(
      expect.objectContaining({ status: 502 })
    );
  });
});
