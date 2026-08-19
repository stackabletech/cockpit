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

  it('streams a bounded search with backend filtering and the request abort signal', async () => {
    const controller = new AbortController();
    mockProvider.search.mockResolvedValue({
      results: [
        { key: 'reports/final.pdf', size: 42, lastModified: new Date(), isDirectory: false }
      ],
      truncated: false
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
      maxResults: 50,
      maxKeysScanned: 10000,
      prefix: 'reports/',
      maxDepth: 2,
      signal: expect.any(AbortSignal),
      matches: expect.any(Function),
      onMatch: expect.any(Function)
    });
    const { matches } = mockProvider.search.mock.calls[0][1];
    expect(matches({ key: 'reports/final.pdf' })).toBe(true);
    expect(matches({ key: 'reports/archive.pdf' })).toBe(false);
    expect(storageSearchTotal.inc).toHaveBeenCalledWith({ outcome: 'success', truncated: 'false' });
  });

  it('passes through a truncated result', async () => {
    mockProvider.search.mockResolvedValue({ results: [], truncated: true });

    const response = await GET(mockEvent('bucket=documents&q=report'));

    await expect(response.text()).resolves.toContain('"truncated":true');
    expect(storageSearchTotal.inc).toHaveBeenCalledWith({ outcome: 'success', truncated: 'true' });
  });

  it('applies date and size filters to matches', async () => {
    mockProvider.search.mockResolvedValue({ results: [], truncated: false });
    const MB = 1024 ** 2;

    const response = await GET(
      mockEvent(
        'bucket=documents&q=report&filter=' +
          encodeURIComponent('size>2') +
          '&filter=' +
          encodeURIComponent('date>17.08.2026')
      )
    );
    await expect(response.text()).resolves.toContain('"type":"complete"');
    expect(mockProvider.search).toHaveBeenCalledWith('report', expect.objectContaining({}));
    const { matches } = mockProvider.search.mock.calls[0][1];
    expect(
      matches({
        key: 'reports/x.pdf',
        size: 3 * MB,
        lastModified: new Date(2026, 7, 18),
        isDirectory: false
      })
    ).toBe(true);
    expect(
      matches({
        key: 'reports/x.pdf',
        size: MB,
        lastModified: new Date(2026, 7, 18),
        isDirectory: false
      })
    ).toBe(false);
    expect(
      matches({
        key: 'reports/x.pdf',
        size: 3 * MB,
        lastModified: new Date(2026, 7, 17),
        isDirectory: false
      })
    ).toBe(false);
    expect(
      matches({
        key: 'reports/archive/',
        size: 0,
        lastModified: new Date(2026, 7, 18),
        isDirectory: true
      })
    ).toBe(false);
  });

  it('sends a periodic full snapshot as results are found', async () => {
    mockProvider.search.mockImplementation(async (_query, options) => {
      const results = Array.from({ length: 10 }, (_, index) => ({
        key: `report-${index}.txt`,
        size: index,
        lastModified: new Date(),
        isDirectory: false
      }));
      for (const item of results) options.onMatch(item);
      return { results, truncated: false };
    });

    const response = await GET(mockEvent('bucket=documents&q=report'));
    const updates = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'snapshot', results: expect.any(Array) })
      ])
    );
    expect(updates.at(-1)).toMatchObject({ type: 'complete', results: expect.any(Array) });
  });

  it('rejects a missing bucket', async () => {
    await expect(GET(mockEvent('q=report'))).rejects.toMatchObject({ status: 400 });
  });

  it('accepts missing or blank queries for filters-only searches', async () => {
    mockProvider.search.mockResolvedValue({ results: [], truncated: false });

    const response = await GET(mockEvent('bucket=documents'));
    await expect(response.text()).resolves.toContain('"type":"complete"');
    expect(mockProvider.search).toHaveBeenCalledWith('', expect.anything());
    mockProvider.search.mockClear();

    const blank = await GET(mockEvent('bucket=documents&q=%20%20'));
    await expect(blank.text()).resolves.toContain('"type":"complete"');
    expect(mockProvider.search).toHaveBeenCalledWith('', expect.anything());
  });

  it('rejects an invalid maximum depth', async () => {
    await expect(GET(mockEvent('bucket=documents&q=report&maxDepth=0'))).rejects.toMatchObject({
      status: 400
    });
  });

  it('rejects invalid and unsafe regular expressions before querying storage', async () => {
    await expect(
      GET(mockEvent('bucket=documents&q=(a%2B)%2B%24&regex=true'))
    ).rejects.toMatchObject({
      status: 400
    });
    expect(mockProvider.search).not.toHaveBeenCalled();
  });

  it('streams an unexpected provider failure', async () => {
    mockProvider.search.mockRejectedValue(new Error('connection reset'));

    const response = await GET(mockEvent('bucket=documents&q=report'));
    await expect(response.text()).resolves.toContain('"type":"error"');
    expect(storageSearchTotal.inc).toHaveBeenCalledWith({ outcome: 'error', truncated: 'false' });
  });

  it('rejects buckets outside the active connection', async () => {
    await expect(GET(mockEvent('bucket=private&q=report'))).rejects.toMatchObject({ status: 404 });
    expect(mockProvider.search).not.toHaveBeenCalled();
  });
});
