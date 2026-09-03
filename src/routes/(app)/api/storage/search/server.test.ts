import { describe, it, expect, vi, beforeEach } from 'vitest';
import { error } from '@sveltejs/kit';

const { mockProvider, storageSearchTotal } = vi.hoisted(() => ({
  mockProvider: { search: vi.fn(), listContainers: vi.fn() },
  storageSearchTotal: { inc: vi.fn() }
}));

vi.mock('$lib/server/storage/utils.js', () => ({
  getProvider: () => mockProvider
}));

vi.mock('$lib/server/metrics.js', () => ({ storageSearchTotal }));

import { GET } from './+server.js';

function mockEvent(params: string, signal?: AbortSignal) {
  const url = new URL(`http://localhost/api/storage/search?${params}`);
  return {
    url,
    request: new Request(url, { signal }),
    locals: {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      storageConfig: { type: 's3', region: { name: 'us-east-1' } }
    }
  } as unknown as Parameters<typeof GET>[0];
}

describe('GET /api/storage/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider.listContainers.mockResolvedValue(['documents']);
  });

  it('streams a complete search with backend filtering and the request abort signal', async () => {
    const controller = new AbortController();
    mockProvider.search.mockResolvedValue({
      results: [
        { key: 'reports/final.pdf', size: 42, lastModified: new Date(), isDirectory: false }
      ]
    });

    const response = await GET(
      mockEvent(
        'bucket=documents&q=report&prefix=reports%2F&maxDepth=2&regex=true&exclude=archive',
        controller.signal
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/x-ndjson');
    await expect(response.text()).resolves.toContain('"type":"complete"');
    expect(mockProvider.search).toHaveBeenCalledWith('report', {
      prefix: 'reports/',
      maxDepth: 2,
      signal: expect.any(AbortSignal),
      matches: expect.any(Function),
      onMatch: expect.any(Function)
    });
    const { matches } = mockProvider.search.mock.calls[0][1];
    expect(
      matches({ key: 'reports/final.pdf', size: 42, lastModified: new Date(), isDirectory: false })
    ).toBe(true);
    expect(
      matches({
        key: 'reports/archive.pdf',
        size: 42,
        lastModified: new Date(),
        isDirectory: false
      })
    ).toBe(false);
    expect(storageSearchTotal.inc).toHaveBeenCalledWith({ outcome: 'success' });
  });

  it('rejects a missing bucket', async () => {
    await expect(GET(mockEvent('q=report'))).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a missing or blank query', async () => {
    await expect(GET(mockEvent('bucket=documents'))).rejects.toMatchObject({ status: 400 });
    await expect(GET(mockEvent('bucket=documents&q=%20%20'))).rejects.toMatchObject({
      status: 400
    });
  });

  it('rejects an invalid maximum depth', async () => {
    await expect(GET(mockEvent('bucket=documents&q=report&maxDepth=0'))).rejects.toMatchObject({
      status: 400
    });
  });

  it('streams an unexpected provider failure', async () => {
    mockProvider.search.mockRejectedValue(new Error('connection reset'));

    const response = await GET(mockEvent('bucket=documents&q=report'));
    await expect(response.text()).resolves.toContain('"type":"error"');
    expect(storageSearchTotal.inc).toHaveBeenCalledWith({ outcome: 'error' });
  });

  it('includes access-denied classification in streamed provider failures', async () => {
    let accessDeniedError: unknown;
    try {
      error(403, 'Access denied');
    } catch (err) {
      accessDeniedError = err;
    }
    mockProvider.search.mockRejectedValue(accessDeniedError);

    const response = await GET(mockEvent('bucket=documents&q=report'));

    await expect(response.text()).resolves.toContain('"code":"access_denied"');
  });

  it('rejects buckets outside the active connection', async () => {
    await expect(GET(mockEvent('bucket=private&q=report'))).rejects.toMatchObject({ status: 404 });
    expect(mockProvider.search).not.toHaveBeenCalled();
  });
});
