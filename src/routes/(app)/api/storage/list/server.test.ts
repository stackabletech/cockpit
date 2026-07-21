import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockProvider = { listObjects: vi.fn() };
vi.mock('$lib/server/storage/utils.js', () => ({
  getProvider: () => mockProvider
}));

import { GET } from './+server.js';

function mockEvent(params: string) {
  const url = new URL(`http://localhost/api/storage/list?${params}`);
  return {
    url,
    request: { headers: new Headers() },
    locals: {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      storageConfig: { type: 's3', region: { name: 'us-east-1' } }
    }
  } as unknown as Parameters<typeof GET>[0];
}

describe('GET /api/storage/list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns paginated object listing', async () => {
    const lastModified = new Date('2024-06-15T12:00:00Z');
    const page = {
      contents: [{ key: 'a.txt', size: 10, lastModified }],
      continuationToken: 'next-page',
      isTruncated: true
    };
    mockProvider.listObjects.mockResolvedValue(page);

    const res = await GET(mockEvent('bucket=b1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].key).toBe('a.txt');
    expect(body.continuationToken).toBe('next-page');
    expect(body.isTruncated).toBe(true);
    expect(mockProvider.listObjects).toHaveBeenCalledWith('', 25, undefined);
  });

  it('passes prefix and pageSize to provider', async () => {
    mockProvider.listObjects.mockResolvedValue({
      contents: [],
      continuationToken: null,
      isTruncated: false
    });

    await GET(mockEvent('bucket=b1&prefix=data/&pageSize=10'));

    expect(mockProvider.listObjects).toHaveBeenCalledWith('data/', 10, undefined);
  });

  it('passes continuationToken to provider', async () => {
    mockProvider.listObjects.mockResolvedValue({
      contents: [],
      continuationToken: null,
      isTruncated: false
    });

    await GET(mockEvent('bucket=b1&continuationToken=abc123'));

    expect(mockProvider.listObjects).toHaveBeenCalledWith('', 25, 'abc123');
  });

  it('throws when bucket is missing', async () => {
    const url = new URL('http://localhost/api/storage/list');
    const event = {
      url,
      request: { headers: new Headers() },
      locals: {
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
        storageConfig: { type: 's3', region: { name: 'us-east-1' } }
      }
    } as unknown as Parameters<typeof GET>[0];

    await expect(GET(event)).rejects.toThrow();
  });
});
