import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockManifests = vi.hoisted(() => ({ recreateDownloadManifest: vi.fn() }));
vi.mock('$lib/server/storage/download-manifests.js', () => mockManifests);

import { POST } from './+server.js';

function mockEvent(body: unknown) {
  const url = new URL('http://localhost/api/storage/download/manifests/m1/redownload');
  return {
    url,
    params: { manifestId: 'm1' },
    request: new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
    locals: {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      user: { id: 'test-user' }
    }
  } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/storage/download/manifests/[manifestId]/redownload', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['an empty key list', { keys: [] }],
    ['an empty key', { keys: [''] }],
    ['more than 10 000 keys', { keys: Array.from({ length: 10_001 }, (_, i) => `k${i}`) }],
    ['a null body', null]
  ])('throws 400 for %s', async (_, body) => {
    await expect(POST(mockEvent(body))).rejects.toThrow(
      expect.objectContaining({
        status: 400,
        body: { message: 'Request body must contain one or more object keys' }
      })
    );
    expect(mockManifests.recreateDownloadManifest).not.toHaveBeenCalled();
  });

  it('throws 400 for duplicate keys', async () => {
    await expect(POST(mockEvent({ keys: ['a', 'a'] }))).rejects.toThrow(
      expect.objectContaining({
        status: 400,
        body: { message: 'Download keys must not contain duplicates' }
      })
    );
  });

  it('recreates the manifest for valid keys', async () => {
    mockManifests.recreateDownloadManifest.mockResolvedValue({ id: 'm2' });

    const response = await POST(mockEvent({ keys: ['a.csv', 'b?.csv'] }));

    expect(response.status).toBe(201);
    expect(mockManifests.recreateDownloadManifest).toHaveBeenCalledWith(
      'test-user',
      'm1',
      ['a.csv', 'b?.csv'],
      expect.any(AbortSignal)
    );
  });
});
