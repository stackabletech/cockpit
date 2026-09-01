import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recentSearches } = vi.hoisted(() => ({
  recentSearches: {
    listRecentSearches: vi.fn(),
    recordRecentSearch: vi.fn(),
    clearRecentSearches: vi.fn()
  }
}));

vi.mock('$lib/server/storage/recent-searches-db.js', () => recentSearches);

import { GET, POST, DELETE } from './+server.js';

const CONNECTION_ID = '00000000-0000-0000-0000-000000000001';

function mockEvent(method: string, body?: unknown, connectionId: string | null = CONNECTION_ID) {
  const headers = new Headers();
  if (connectionId) headers.set('x-storage-connection-id', connectionId);
  const request = new Request('http://localhost/api/storage/search/history', {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return {
    request,
    locals: {
      user: { id: 'user-1' },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }
    }
  } as unknown as Parameters<typeof GET>[0];
}

describe('/api/storage/search/history', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists searches for the requesting user and connection', async () => {
    recentSearches.listRecentSearches.mockResolvedValue([
      { buckets: ['documents'], query: 'report' },
      { buckets: ['archive', 'documents'], query: 'invoice' }
    ]);

    const response = await GET(mockEvent('GET'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { buckets: ['documents'], query: 'report' },
      { buckets: ['archive', 'documents'], query: 'invoice' }
    ]);
    expect(recentSearches.listRecentSearches).toHaveBeenCalledWith('user-1', CONNECTION_ID);
  });

  it('records trimmed buckets and query with default options', async () => {
    recentSearches.recordRecentSearch.mockResolvedValue(undefined);

    const response = await POST(
      mockEvent('POST', {
        buckets: [' documents ', 'documents', 'alpha'],
        query: ' report '
      }) as Parameters<typeof POST>[0]
    );

    expect(response.status).toBe(204);
    expect(recentSearches.recordRecentSearch).toHaveBeenCalledWith(
      'user-1',
      CONNECTION_ID,
      ['documents', 'alpha'],
      'report',
      {
        useRegex: false,
        excludePatterns: [],
        searchPath: '',
        maxDepth: null
      }
    );
  });

  it('records the submitted advanced options', async () => {
    recentSearches.recordRecentSearch.mockResolvedValue(undefined);

    const response = await POST(
      mockEvent('POST', {
        buckets: ['documents'],
        query: 'report',
        useRegex: true,
        excludePatterns: ['_temp', 'logs'],
        searchPath: ' events/2024/ ',
        maxDepth: 3
      }) as Parameters<typeof POST>[0]
    );

    expect(response.status).toBe(204);
    expect(recentSearches.recordRecentSearch).toHaveBeenCalledWith(
      'user-1',
      CONNECTION_ID,
      ['documents'],
      'report',
      {
        useRegex: true,
        excludePatterns: ['_temp', 'logs'],
        searchPath: 'events/2024/',
        maxDepth: 3
      }
    );
  });

  it('coerces invalid advanced options to defaults', async () => {
    recentSearches.recordRecentSearch.mockResolvedValue(undefined);

    const response = await POST(
      mockEvent('POST', {
        buckets: ['documents'],
        query: 'report',
        useRegex: 'yes',
        excludePatterns: [1, 2],
        searchPath: 42,
        maxDepth: -5
      }) as Parameters<typeof POST>[0]
    );

    expect(response.status).toBe(204);
    expect(recentSearches.recordRecentSearch).toHaveBeenCalledWith(
      'user-1',
      CONNECTION_ID,
      ['documents'],
      'report',
      {
        useRegex: false,
        excludePatterns: [],
        searchPath: '',
        maxDepth: null
      }
    );
  });

  it('rejects invalid history records', async () => {
    await expect(
      POST(mockEvent('POST', { buckets: ['documents'], query: ' ' }) as Parameters<typeof POST>[0])
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      POST(mockEvent('POST', { buckets: [], query: 'report' }) as Parameters<typeof POST>[0])
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      POST(
        mockEvent('POST', { buckets: 'documents', query: 'report' }) as Parameters<typeof POST>[0]
      )
    ).rejects.toMatchObject({ status: 400 });
  });

  it('clears searches for the requesting user and connection', async () => {
    recentSearches.clearRecentSearches.mockResolvedValue(undefined);

    const response = await DELETE(mockEvent('DELETE') as Parameters<typeof DELETE>[0]);

    expect(response.status).toBe(204);
    expect(recentSearches.clearRecentSearches).toHaveBeenCalledWith('user-1', CONNECTION_ID);
  });

  it('rejects requests without a storage connection ID', async () => {
    await expect(GET(mockEvent('GET', undefined, null))).rejects.toMatchObject({ status: 400 });
  });
});
