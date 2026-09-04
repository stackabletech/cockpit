import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetBucketVersioning = vi.fn();
const mockGetBucketLifecycleRules = vi.fn();
const mockGetBucketTags = vi.fn();
const mockGetBucketAcl = vi.fn();
const mockListContainers = vi.fn();
const mockProvider = {
  getBucketVersioning: mockGetBucketVersioning,
  getBucketLifecycleRules: mockGetBucketLifecycleRules,
  getBucketTags: mockGetBucketTags,
  getBucketAcl: mockGetBucketAcl
};
vi.mock('$lib/server/storage/utils.js', () => ({
  getProvider: () => mockProvider,
  getConnectionProvider: () => ({ listContainers: mockListContainers })
}));

import { GET } from './+server.js';

function mockEvent(searchParams: Record<string, string>) {
  const url = new URL('http://localhost/api/storage/buckets');
  for (const [k, v] of Object.entries(searchParams)) {
    url.searchParams.set(k, v);
  }
  return {
    url,
    locals: {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      user: { id: 'test-user' },
      storageConfig: {
        type: 's3',
        host: 'localhost',
        accessStyle: 'Path' as const,
        region: { name: 'us-east-1' }
      }
    }
  } as unknown as Parameters<typeof GET>[0];
}

describe('GET /api/storage/buckets', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('bucket listing (no details param)', () => {
    it('returns buckets from provider plus additional buckets', async () => {
      mockListContainers.mockResolvedValue(['alpha', 'beta']);

      const event = mockEvent({});
      event.locals.storageConfig = {
        type: 's3',
        host: 'localhost',
        accessStyle: 'Path' as const,
        region: { name: 'us-east-1' },
        additionalBuckets: ['gamma']
      };
      const response = await GET(event);
      const body = await response.json();
      expect(body).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('deduplicates overlapping provider and additional buckets', async () => {
      mockListContainers.mockResolvedValue(['alpha', 'beta']);

      const event = mockEvent({});
      event.locals.storageConfig = {
        type: 's3',
        host: 'localhost',
        accessStyle: 'Path' as const,
        region: { name: 'us-east-1' },
        additionalBuckets: ['beta']
      };
      const response = await GET(event);
      const body = await response.json();
      expect(body).toEqual(['alpha', 'beta']);
    });

    it('returns empty array when prefix is set without details', async () => {
      const response = await GET(mockEvent({ prefix: 'some/prefix/' }));
      const body = await response.json();
      expect(body).toEqual([]);
    });
  });

  describe('bucket details (details=true)', () => {
    it('throws 400 when bucket is missing', async () => {
      await expect(GET(mockEvent({ details: 'true' }))).rejects.toThrow(
        expect.objectContaining({ status: 400 })
      );
    });

    it('returns bucket details with Enabled versioning', async () => {
      mockGetBucketVersioning.mockResolvedValue('Enabled');
      mockGetBucketLifecycleRules.mockResolvedValue([]);
      mockGetBucketTags.mockResolvedValue({ env: 'prod' });
      mockGetBucketAcl.mockResolvedValue({ owner: 'admin', grants: [] });

      const response = await GET(mockEvent({ details: 'true', bucket: 'b1' }));
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

      const response = await GET(mockEvent({ details: 'true', bucket: 'b1' }));
      const body = await response.json();
      expect(body.versioning).toBe('Suspended');
    });

    it('returns Disabled versioning as default', async () => {
      mockGetBucketVersioning.mockResolvedValue('Disabled');
      mockGetBucketLifecycleRules.mockResolvedValue([]);
      mockGetBucketTags.mockResolvedValue({});
      mockGetBucketAcl.mockResolvedValue({ owner: 'admin', grants: [] });

      const response = await GET(mockEvent({ details: 'true', bucket: 'b1' }));
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

      const response = await GET(mockEvent({ details: 'true', bucket: 'b1' }));
      const body = await response.json();
      expect(body.lifecycleRules).toEqual(rules);
      expect(body.acl).toEqual(acl);
    });
  });
});
