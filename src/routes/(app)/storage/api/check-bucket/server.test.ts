import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/storage/service.js', () => ({
  listObjects: vi.fn()
}));

vi.mock('$lib/server/auth-utils.js', () => ({
  getUserId: vi.fn(() => 'test-user')
}));

import { GET } from './+server.js';
import { listObjects } from '$lib/server/storage/service.js';
import { error } from '@sveltejs/kit';

function mockEvent(params: string) {
  const url = new URL(`http://localhost/storage/api/check-bucket?${params}`);
  return {
    url,
    locals: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, user: { id: 'test-user' } }
  } as unknown as Parameters<typeof GET>[0];
}

describe('GET /storage/api/check-bucket', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws 400 when bucket is missing', async () => {
    await expect(GET(mockEvent(''))).rejects.toThrow(expect.objectContaining({ status: 400 }));
  });

  it('returns 204 when bucket is accessible', async () => {
    vi.mocked(listObjects).mockResolvedValue({
      items: [],
      continuationToken: undefined
    } as unknown as Awaited<ReturnType<typeof listObjects>>);

    const res = await GET(mockEvent('bucket=my-bucket'));

    expect(listObjects).toHaveBeenCalledWith('test-user', 'my-bucket', '', 1);
    expect(res.status).toBe(204);
  });

  it('re-throws 404 HttpError when bucket is not found', async () => {
    vi.mocked(listObjects).mockImplementation(() => {
      error(404, 'Bucket not found');
    });

    await expect(GET(mockEvent('bucket=missing-bucket'))).rejects.toMatchObject({ status: 404 });
  });

  it('re-throws 403 HttpError when access is denied', async () => {
    vi.mocked(listObjects).mockImplementation(() => {
      error(403, 'Access denied');
    });

    await expect(GET(mockEvent('bucket=secret-bucket'))).rejects.toMatchObject({ status: 403 });
  });

  it('throws 502 for unexpected errors', async () => {
    vi.mocked(listObjects).mockRejectedValue(new Error('network failure'));

    await expect(GET(mockEvent('bucket=my-bucket'))).rejects.toThrow(
      expect.objectContaining({ status: 502 })
    );
  });
});
