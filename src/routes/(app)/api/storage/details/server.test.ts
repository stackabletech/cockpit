import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetMetadata = vi.fn();
const mockProvider = { getMetadata: mockGetMetadata };
vi.mock('$lib/server/storage/utils.js', () => ({
  getProvider: () => mockProvider
}));

import { GET } from './+server.js';

const CONNECTION_HEADER = {
  'x-storage-connection': btoa(JSON.stringify({ type: 's3', region: 'us-east-1' }))
};

function mockEvent(searchParams: Record<string, string>) {
  const url = new URL('http://localhost/api/storage/details');
  for (const [k, v] of Object.entries(searchParams)) {
    url.searchParams.set(k, v);
  }
  return {
    url,
    request: { headers: new Headers(CONNECTION_HEADER) },
    locals: {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      user: { id: 'test-user' },
      storageConfig: { type: 's3', region: 'us-east-1' }
    }
  } as unknown as Parameters<typeof GET>[0];
}

describe('GET /api/storage/details', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws 400 when bucket is missing', async () => {
    await expect(GET(mockEvent({ key: 'file.txt' }))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('throws 400 when key is missing', async () => {
    await expect(GET(mockEvent({ bucket: 'b1' }))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('returns file details', async () => {
    const meta = {
      size: 1024,
      lastModified: new Date('2025-01-01'),
      contentType: 'text/plain',
      etag: '"abc123"',
      customMetadata: { author: 'test' },
      versionId: 'v1',
      storageClass: 'STANDARD',
      isDeleteMarker: false
    };
    mockGetMetadata.mockResolvedValue(meta);

    const response = await GET(mockEvent({ bucket: 'b1', key: 'path/file.txt' }));
    expect(mockGetMetadata).toHaveBeenCalledWith('path/file.txt');
    const body = await response.json();
    expect(body).toMatchObject({
      key: 'path/file.txt',
      name: 'file.txt',
      size: 1024,
      contentType: 'text/plain',
      etag: '"abc123"',
      customMetadata: { author: 'test' },
      storageClass: 'STANDARD',
      isDeleteMarker: false
    });
  });

  it('handles missing optional fields', async () => {
    mockGetMetadata.mockResolvedValue({
      size: 0,
      lastModified: new Date(0),
      contentType: undefined,
      etag: undefined,
      customMetadata: undefined,
      versionId: undefined,
      storageClass: undefined,
      isDeleteMarker: false
    });

    const response = await GET(mockEvent({ bucket: 'b1', key: 'test.dat' }));
    const body = await response.json();
    expect(body.contentType).toBeUndefined();
    expect(body.etag).toBeUndefined();
    expect(body.storageClass).toBeUndefined();
  });
});
