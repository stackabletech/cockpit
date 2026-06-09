import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';

vi.mock('$lib/server/storage/service.js', () => ({
  deleteObjects: vi.fn()
}));

import { DELETE } from './+server.js';
import { deleteObjects } from '$lib/server/storage/service.js';

const CONNECTION_HEADER = {
  'x-storage-connection': btoa(JSON.stringify({ type: 's3', region: 'us-east-1' }))
};

function mockEvent(searchParams: Record<string, string | string[]>) {
  const url = new URL('http://localhost/storage/api/delete');
  for (const [k, v] of Object.entries(searchParams)) {
    if (Array.isArray(v)) {
      v.forEach((val) => url.searchParams.append(k, val));
    } else {
      url.searchParams.set(k, v);
    }
  }
  return {
    url,
    request: { headers: new Headers(CONNECTION_HEADER) },
    locals: {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      user: { id: 'test-user' },
      storageConfig: { type: 's3', region: 'us-east-1' }
    }
  } as unknown as Parameters<typeof DELETE>[0];
}

describe('DELETE /storage/api/delete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws 400 when bucket is missing', async () => {
    await expect(DELETE(mockEvent({ keys: 'a.txt' }))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('throws 400 when keys are missing', async () => {
    await expect(DELETE(mockEvent({ bucket: 'b1' }))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('deletes objects and returns JSON result', async () => {
    const keys = [faker.system.fileName(), faker.system.fileName()];
    const result = { deleted: keys, failed: [] };
    vi.mocked(deleteObjects).mockResolvedValue(
      result as unknown as Awaited<ReturnType<typeof deleteObjects>>
    );

    const response = await DELETE(mockEvent({ bucket: 'b1', keys }));
    expect(deleteObjects).toHaveBeenCalledWith(expect.objectContaining({ type: 's3' }), 'b1', keys);
    expect(await response.json()).toEqual(result);
  });
});
