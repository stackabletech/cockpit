import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';

const mockProvider = { deleteObjects: vi.fn() };
vi.mock('$lib/server/storage/utils.js', () => ({
  getProvider: () => mockProvider
}));

import { DELETE } from './+server.js';

const CONNECTION_HEADER = {
  'x-storage-connection': btoa(JSON.stringify({ type: 's3', region: 'us-east-1' }))
};

function mockEvent(searchParams: Record<string, string | string[]>) {
  const url = new URL('http://localhost/api/storage/delete');
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

describe('DELETE /api/storage/delete', () => {
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
    mockProvider.deleteObjects.mockResolvedValue(result);

    const response = await DELETE(mockEvent({ bucket: 'b1', keys }));
    expect(mockProvider.deleteObjects).toHaveBeenCalledWith(keys);
    expect(await response.json()).toEqual(result);
  });
});
