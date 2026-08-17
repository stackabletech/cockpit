import { describe, it, expect, vi, beforeEach } from 'vitest';

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

  it('delegates a bounded search with the request abort signal', async () => {
    const controller = new AbortController();
    mockProvider.search.mockResolvedValue({
      results: [
        { key: 'reports/final.pdf', size: 42, lastModified: new Date(), isDirectory: false }
      ],
      truncated: false
    });

    const response = await GET(
      mockEvent('bucket=documents&q=report&prefix=reports%2F&maxDepth=2', controller.signal)
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      results: [{ key: 'reports/final.pdf' }],
      truncated: false
    });
    expect(mockProvider.search).toHaveBeenCalledWith('report', {
      maxResults: 50,
      maxKeysScanned: 10000,
      prefix: 'reports/',
      maxDepth: 2,
      signal: expect.any(AbortSignal)
    });
    expect(storageSearchTotal.inc).toHaveBeenCalledWith({ outcome: 'success', truncated: 'false' });
  });

  it('passes through a truncated result', async () => {
    mockProvider.search.mockResolvedValue({ results: [], truncated: true });

    const response = await GET(mockEvent('bucket=documents&q=report'));

    await expect(response.json()).resolves.toEqual({ results: [], truncated: true });
    expect(storageSearchTotal.inc).toHaveBeenCalledWith({ outcome: 'success', truncated: 'true' });
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

  it('maps an unexpected provider failure to 502', async () => {
    mockProvider.search.mockRejectedValue(new Error('connection reset'));

    await expect(GET(mockEvent('bucket=documents&q=report'))).rejects.toMatchObject({
      status: 502
    });
    expect(storageSearchTotal.inc).toHaveBeenCalledWith({ outcome: 'error', truncated: 'false' });
  });

  it('rejects buckets outside the active connection', async () => {
    await expect(GET(mockEvent('bucket=private&q=report'))).rejects.toMatchObject({ status: 404 });
    expect(mockProvider.search).not.toHaveBeenCalled();
  });
});
