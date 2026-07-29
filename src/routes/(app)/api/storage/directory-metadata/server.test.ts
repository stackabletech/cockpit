import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetBucketAcl = vi.fn();
const mockGetMetadata = vi.fn();
const mockProvider = {
  getBucketAcl: mockGetBucketAcl,
  getMetadata: mockGetMetadata
};
vi.mock('$lib/server/storage/utils.js', () => ({
  getProvider: () => mockProvider
}));

import { GET } from './+server.js';

const CONNECTION_HEADER = {
  'x-storage-connection': btoa(JSON.stringify({ type: 's3', region: 'us-east-1' }))
};

function mockEvent(searchParams: Record<string, string>) {
  const url = new URL('http://localhost/api/storage/directory-metadata');
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

describe('GET /api/storage/directory-metadata', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws 400 when bucket is missing', async () => {
    await expect(GET(mockEvent({ prefix: 'dir/' }))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('throws 400 when prefix is missing', async () => {
    await expect(GET(mockEvent({ bucket: 'b1' }))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('returns directory metadata without marker', async () => {
    mockGetBucketAcl.mockResolvedValue({ owner: 'admin', grants: [] });
    mockGetMetadata.mockRejectedValue(new Error('NoSuchKey'));

    const response = await GET(mockEvent({ bucket: 'b1', prefix: 'dir/' }));
    const body = await response.json();
    expect(body).toMatchObject({
      bucketOwner: 'admin',
      bucketGrants: [],
      markerExists: false
    });
    expect(mockGetMetadata).toHaveBeenCalled();
  });

  it('returns directory metadata with marker when object exists', async () => {
    mockGetBucketAcl.mockResolvedValue({ owner: 'admin', grants: [] });
    mockGetMetadata.mockResolvedValue({
      size: 0,
      lastModified: new Date('2025-06-01'),
      contentType: 'application/octet-stream',
      etag: '"def456"',
      versionId: 'v2',
      storageClass: 'STANDARD',
      isDeleteMarker: false
    });

    const response = await GET(mockEvent({ bucket: 'b1', prefix: 'dir/' }));
    const body = await response.json();
    expect(body.markerExists).toBe(true);
    expect(body.markerLastModified).toBeDefined();
    expect(body.markerETag).toBe('"def456"');
    expect(body.markerVersionId).toBe('v2');
  });

  it('handles marker metadata fetch failure gracefully', async () => {
    mockGetBucketAcl.mockResolvedValue({ owner: 'admin', grants: [] });
    mockGetMetadata.mockRejectedValue(new Error('not found'));

    const response = await GET(mockEvent({ bucket: 'b1', prefix: 'dir/' }));
    const body = await response.json();
    expect(body.markerExists).toBe(false);
  });
});
