import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STORAGE_CONNECTION_ID_HEADER } from '$lib/storage/connection-id-header.js';

const mockManifests = vi.hoisted(() => ({
  createDownloadManifest: vi.fn(),
  clearDownloadHistory: vi.fn(),
  listDownloadHistory: vi.fn()
}));
vi.mock('$lib/server/storage/download-manifests.js', () => mockManifests);

import { POST } from './+server.js';

const CONNECTION_ID = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';

function mockEvent(body: unknown) {
  const url = new URL('http://localhost/api/storage/download/manifests?bucket=b1&prefix=reports/');
  return {
    url,
    request: new Request(url, {
      method: 'POST',
      headers: {
        [STORAGE_CONNECTION_ID_HEADER]: CONNECTION_ID,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }),
    locals: {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      user: { id: 'test-user' },
      storageConfig: { type: 's3', region: { name: 'us-east-1' } }
    }
  } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/storage/download/manifests', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['an empty key list', { keys: [] }],
    ['an empty key', { keys: [''] }],
    ['a key over 1024 bytes', { keys: ['a'.repeat(1025)] }],
    ['more than 1000 keys', { keys: Array.from({ length: 1001 }, (_, i) => `k${i}`) }],
    ['a non-string key', { keys: [42] }],
    ['a missing key list', {}],
    ['a null body', null]
  ])('throws 400 for %s', async (_, body) => {
    await expect(POST(mockEvent(body))).rejects.toThrow(
      expect.objectContaining({
        status: 400,
        body: { message: 'Request body must contain one or more object keys' }
      })
    );
    expect(mockManifests.createDownloadManifest).not.toHaveBeenCalled();
  });

  it('creates a manifest for valid keys, deduplicated', async () => {
    const manifest = { id: 'm1' };
    mockManifests.createDownloadManifest.mockResolvedValue(manifest);
    const keys = ['reports/a.csv', 'reports/what?.csv', 'reports/a.csv', 'x'.repeat(1024)];

    const response = await POST(mockEvent({ keys }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(manifest);
    expect(mockManifests.createDownloadManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'test-user',
        connectionId: CONNECTION_ID,
        bucket: 'b1',
        prefix: 'reports/',
        keys: ['reports/a.csv', 'reports/what?.csv', 'x'.repeat(1024)]
      })
    );
  });
});
