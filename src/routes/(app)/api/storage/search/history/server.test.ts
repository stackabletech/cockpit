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
      { bucket: 'documents', query: 'report' },
      { bucket: 'archive', query: 'invoice' }
    ]);

    const response = await GET(mockEvent('GET'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { bucket: 'documents', query: 'report' },
      { bucket: 'archive', query: 'invoice' }
    ]);
    expect(recentSearches.listRecentSearches).toHaveBeenCalledWith('user-1', CONNECTION_ID);
  });

  it('records a trimmed bucket and query', async () => {
    recentSearches.recordRecentSearch.mockResolvedValue(undefined);

    const response = await POST(
      mockEvent('POST', { bucket: ' documents ', query: ' report ' }) as Parameters<typeof POST>[0]
    );

    expect(response.status).toBe(204);
    expect(recentSearches.recordRecentSearch).toHaveBeenCalledWith(
      'user-1',
      CONNECTION_ID,
      'documents',
      'report'
    );
  });

  it('rejects invalid history records', async () => {
    await expect(
      POST(mockEvent('POST', { bucket: 'documents', query: ' ' }) as Parameters<typeof POST>[0])
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      POST(mockEvent('POST', { bucket: 1, query: 'report' }) as Parameters<typeof POST>[0])
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
