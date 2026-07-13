import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetBucketVersioning = vi.fn();
const mockGetBucketLifecycleRules = vi.fn();
const mockGetBucketTags = vi.fn();
const mockGetBucketAcl = vi.fn();
const mockProvider = {
  getBucketVersioning: mockGetBucketVersioning,
  getBucketLifecycleRules: mockGetBucketLifecycleRules,
  getBucketTags: mockGetBucketTags,
  getBucketAcl: mockGetBucketAcl
};
vi.mock('$lib/server/storage/utils.js', () => ({
  getProvider: () => mockProvider
}));

import { GET } from './+server.js';

const CONNECTION_HEADER = {
  'x-storage-connection': btoa(JSON.stringify({ type: 's3', region: 'us-east-1' }))
};

function mockEvent(searchParams: Record<string, string>) {
  const url = new URL('http://localhost/api/storage/bucket-details');
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

describe('GET /api/storage/bucket-details', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws 400 when bucket is missing', async () => {
    await expect(GET(mockEvent({}))).rejects.toThrow(expect.objectContaining({ status: 400 }));
  });

  it('returns bucket details with Enabled versioning', async () => {
    mockGetBucketVersioning.mockResolvedValue('Enabled');
    mockGetBucketLifecycleRules.mockResolvedValue([]);
    mockGetBucketTags.mockResolvedValue({ env: 'prod' });
    mockGetBucketAcl.mockResolvedValue({ owner: 'admin', grants: [] });

    const response = await GET(mockEvent({ bucket: 'b1' }));
    const body = await response.json();
    expect(body).toMatchObject({
      name: 'b1',
      versioning: 'Enabled',
      tags: { env: 'prod' },
      acl: { owner: 'admin', grants: [] },
      lifecycleRules: []
    });
  });

  it('preserves Suspended versioning state', async () => {
    mockGetBucketVersioning.mockResolvedValue('Suspended');
    mockGetBucketLifecycleRules.mockResolvedValue([]);
    mockGetBucketTags.mockResolvedValue({});
    mockGetBucketAcl.mockResolvedValue({ owner: 'admin', grants: [] });

    const response = await GET(mockEvent({ bucket: 'b1' }));
    const body = await response.json();
    expect(body.versioning).toBe('Suspended');
  });

  it('returns Disabled versioning as default', async () => {
    mockGetBucketVersioning.mockResolvedValue('Disabled');
    mockGetBucketLifecycleRules.mockResolvedValue([]);
    mockGetBucketTags.mockResolvedValue({});
    mockGetBucketAcl.mockResolvedValue({ owner: 'admin', grants: [] });

    const response = await GET(mockEvent({ bucket: 'b1' }));
    const body = await response.json();
    expect(body.versioning).toBe('Disabled');
  });

  it('includes lifecycle rules and ACL grants', async () => {
    const rules = [
      {
        id: 'rule-1',
        status: 'Enabled',
        filter: { prefix: 'logs/' },
        transitions: [],
        expirations: [{ days: 30 }],
        noncurrentVersionTransitions: [],
        noncurrentVersionExpirations: [],
        abortIncompleteMultipartUploads: []
      }
    ];
    const acl = {
      owner: 'owner',
      grants: [{ grantee: 'user1', permission: 'FULL_CONTROL' }]
    };
    mockGetBucketVersioning.mockResolvedValue('Enabled');
    mockGetBucketLifecycleRules.mockResolvedValue(rules);
    mockGetBucketTags.mockResolvedValue({});
    mockGetBucketAcl.mockResolvedValue(acl);

    const response = await GET(mockEvent({ bucket: 'b1' }));
    const body = await response.json();
    expect(body.lifecycleRules).toEqual(rules);
    expect(body.acl).toEqual(acl);
  });
});
