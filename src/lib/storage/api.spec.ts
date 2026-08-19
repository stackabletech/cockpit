import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFetchStorageApi } from './api.js';
import { StorageError } from './errors.js';
import { STORAGE_CONNECTION_ID_HEADER } from './connection-id-header.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, opts?: { status?: number }): Response {
  return new Response(JSON.stringify(data), {
    status: opts?.status ?? 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function ndjsonResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines.join('\n') + '\n'));
      controller.close();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' }
  });
}

function makeNdjsonLines(data: {
  results?: Array<{ sourceKey: string; destKey: string }>;
  moved?: Array<{ sourceKey: string; destKey: string }>;
  failed?: Array<{ sourceKey: string; error: string }>;
}): string[] {
  const items = data.results ?? data.moved ?? [];
  const lines: string[] = [];
  for (const r of items) {
    lines.push(JSON.stringify({ type: 'done', sourceKey: r.sourceKey, destKey: r.destKey }));
  }
  for (const f of data.failed ?? []) {
    lines.push(JSON.stringify({ type: 'failed', sourceKey: f.sourceKey, error: f.error }));
  }
  lines.push(
    JSON.stringify({
      type: 'complete',
      results: items,
      failed: data.failed ?? []
    })
  );
  return lines;
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('createFetchStorageApi', () => {
  describe('list', () => {
    it('fetches objects for a bucket', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      const page = {
        objects: [
          {
            key: 'file.txt',
            size: 100,
            lastModified: new Date().toISOString(),
            isDirectory: false,
            contentType: 'text/plain'
          }
        ],
        hasNextPage: false,
        currentPage: 1,
        pageSize: 25
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(page));

      const result = await api.list({ bucket: 'my-bucket' });

      expect(result.objects).toHaveLength(1);
      expect(result.objects[0].key).toBe('file.txt');
    });

    it('includes prefix and pageSize in the URL', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ objects: [], hasNextPage: false, currentPage: 1, pageSize: 100 })
      );

      await api.list({ bucket: 'b', prefix: 'docs/', pageSize: 100 });

      const url = vi.mocked(globalThis.fetch).mock.calls[0]![0] as string;
      expect(url).toContain('bucket=b');
      expect(url).toContain('prefix=docs%2F');
      expect(url).toContain('pageSize=100');
    });

    it('sets the connection ID header', async () => {
      const api = createFetchStorageApi(() => 'conn-42');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ objects: [], hasNextPage: false, currentPage: 1, pageSize: 25 })
      );

      await api.list({ bucket: 'b' });

      const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      const headers = new Headers(init?.headers);
      expect(headers.get(STORAGE_CONNECTION_ID_HEADER)).toBe('conn-42');
    });

    it('throws StorageError when disconnected', async () => {
      const api = createFetchStorageApi(() => null);

      await expect(api.list({ bucket: 'b' })).rejects.toThrow(StorageError);
      await expect(api.list({ bucket: 'b' })).rejects.toMatchObject({ code: 'not_connected' });
    });

    it('throws StorageError on server error', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(null, { status: 500 }));

      await expect(api.list({ bucket: 'b' })).rejects.toMatchObject({ code: 'server_error' });
    });
  });

  describe('search', () => {
    it('searches a bucket and forwards its abort signal', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      const controller = new AbortController();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        ndjsonResponse([
          JSON.stringify({
            type: 'complete',
            results: [
              {
                key: 'report.txt',
                size: 1,
                lastModified: '2026-08-12T12:00:00.000Z',
                isDirectory: false
              }
            ],
            truncated: false
          })
        ])
      );

      const result = await api.search({
        bucket: 'documents',
        query: 'report',
        signal: controller.signal
      });

      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toContain('/api/storage/search?bucket=documents&q=report');
      expect(init?.signal).toBe(controller.signal);
      expect(result.results[0].lastModified).toBeInstanceOf(Date);
    });
  });

  describe('recent searches', () => {
    it('lists recent searches', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse([{ bucket: 'documents', query: 'report' }])
      );

      await expect(api.listRecentSearches()).resolves.toEqual([
        { bucket: 'documents', query: 'report' }
      ]);
      expect(vi.mocked(globalThis.fetch).mock.calls[0]![0]).toBe('/api/storage/search/history');
    });

    it('records and clears recent searches', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

      await api.recordRecentSearch({ bucket: 'documents', query: 'report' });
      await api.clearRecentSearches();

      expect(vi.mocked(globalThis.fetch).mock.calls[0]![1]).toMatchObject({ method: 'POST' });
      expect(vi.mocked(globalThis.fetch).mock.calls[1]![1]).toMatchObject({ method: 'DELETE' });
    });
  });

  describe('copy', () => {
    it('sends a POST request with JSON body', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      const copyResult = {
        results: [{ sourceKey: 'a.txt', destKey: 'dest/a.txt' }],
        failed: []
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(copyResult));

      const result = await api.copy({
        bucket: 'my-bucket',
        sourceKeys: ['a.txt'],
        destinationPrefix: 'dest/'
      });

      expect(result.results).toHaveLength(1);
      expect(result.failed).toBe(0);

      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toContain('/api/storage/copy');
      expect(url).toContain('bucket=my-bucket');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(init?.body as string);
      expect(body.sourceKeys).toEqual(['a.txt']);
      expect(body.destinationPrefix).toBe('dest/');
    });

    it('uses NDJSON streaming when progress=true', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      const lines = makeNdjsonLines({
        results: [{ sourceKey: 'a.txt', destKey: 'dest/a.txt' }]
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(ndjsonResponse(lines));

      const result = await api.copy({
        bucket: 'my-bucket',
        sourceKeys: ['a.txt'],
        destinationPrefix: 'dest/',
        progress: true
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].sourceKey).toBe('a.txt');
      expect(result.failed).toBe(0);
    });

    it('includes jobId in the request body when provided', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ results: [], failed: [] }));

      await api.copy({
        bucket: 'b',
        sourceKeys: ['x.txt'],
        destinationPrefix: 'd/',
        jobId: 'job-123'
      });

      const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      const body = JSON.parse(init?.body as string);
      expect(body.jobId).toBe('job-123');
    });

    it('forwards AbortSignal', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ results: [], failed: [] }));
      const controller = new AbortController();

      await api.copy({
        bucket: 'b',
        sourceKeys: ['x.txt'],
        destinationPrefix: 'd/',
        signal: controller.signal
      });

      const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(init?.signal).toBe(controller.signal);
    });
  });

  describe('move', () => {
    it('sends a POST to /api/storage/move', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ moved: [{ sourceKey: 'a.txt', destKey: 'dest/a.txt' }], failed: [] })
      );

      const result = await api.move({
        bucket: 'b',
        sourceKeys: ['a.txt'],
        destinationPrefix: 'dest/'
      });

      const [url] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toContain('/api/storage/move');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].sourceKey).toBe('a.txt');
    });

    it('uses NDJSON streaming when progress=true', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      const lines = makeNdjsonLines({
        results: [{ sourceKey: 'a.txt', destKey: 'dest/a.txt' }]
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(ndjsonResponse(lines));

      const result = await api.move({
        bucket: 'b',
        sourceKeys: ['a.txt'],
        destinationPrefix: 'dest/',
        progress: true
      });

      expect(result.results).toHaveLength(1);
      expect(result.failed).toBe(0);
    });

    it('reports failed items from NDJSON stream', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      const lines = makeNdjsonLines({
        failed: [{ sourceKey: 'bad.txt', error: 'Access denied' }]
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(ndjsonResponse(lines));

      const result = await api.move({
        bucket: 'b',
        sourceKeys: ['bad.txt'],
        destinationPrefix: 'dest/',
        progress: true
      });

      expect(result.results).toHaveLength(0);
      expect(result.failed).toBe(1);
    });
  });

  describe('rename', () => {
    it('sends a POST with key and newKey', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

      await api.rename({ bucket: 'b', key: 'old.txt', newKey: 'new.txt' });

      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toContain('/api/storage/rename');
      expect(url).toContain('bucket=b');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({ key: 'old.txt', newKey: 'new.txt' });
    });

    it('throws on non-ok response', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 409 }));

      await expect(api.rename({ bucket: 'b', key: 'a', newKey: 'b' })).rejects.toThrow(
        StorageError
      );
    });
  });

  describe('delete', () => {
    it('sends DELETE with keys as repeated query params', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ failed: [] }));

      const result = await api.delete({ bucket: 'b', keys: ['a.txt', 'b.txt'] });

      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toContain('/api/storage/delete');
      expect(url).toContain('bucket=b');
      expect(url).toContain('keys=a.txt');
      expect(url).toContain('keys=b.txt');
      expect(init?.method).toBe('DELETE');
      expect(result.failed).toEqual([]);
    });

    it('returns failed items from the server response', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({
          failed: [{ key: 'locked.txt', code: 'access_denied', message: 'No access' }]
        })
      );

      const result = await api.delete({ bucket: 'b', keys: ['locked.txt'] });
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].key).toBe('locked.txt');
    });
  });

  describe('create', () => {
    it('sends POST with bucket and key', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

      await api.create({ bucket: 'b', key: 'new-folder/' });

      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toContain('/api/storage/create');
      expect(url).toContain('bucket=b');
      expect(url).toContain('key=new-folder%2F');
      expect(init?.method).toBe('POST');
    });
  });

  describe('archiveExtract', () => {
    it('returns raw Response for blob download', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      const fakeBody = new ReadableStream();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(fakeBody, { status: 200 }));

      const res = await api.archiveExtract({ bucket: 'b', key: 'archive.zip', path: 'file.txt' });

      expect(res).toBeInstanceOf(Response);
      const [url] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toContain('/api/storage/archive/extract');
      expect(url).toContain('bucket=b');
      expect(url).toContain('key=archive.zip');
      expect(url).toContain('path=file.txt');
    });

    it('includes nestedArchivePath when provided', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

      await api.archiveExtract({
        bucket: 'b',
        key: 'outer.zip',
        path: 'inner.zip/file.txt',
        nestedArchivePath: 'inner.zip'
      });

      const [url] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toContain('nestedArchivePath=inner.zip');
    });
  });

  describe('archiveListing', () => {
    it('returns parsed archive listing', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      const listing = {
        entries: [
          { key: 'file.txt', size: 100, lastModified: new Date().toISOString(), isDirectory: false }
        ],
        hasMore: false
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(listing));

      const result = await api.archiveListing({ bucket: 'b', key: 'archive.zip' });

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].key).toBe('file.txt');
      expect(result.hasMore).toBe(false);
    });

    it('includes internalPrefix and nestedArchivePath', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ entries: [], hasMore: false })
      );

      await api.archiveListing({
        bucket: 'b',
        key: 'archive.zip',
        internalPrefix: 'subdir/',
        nestedArchivePath: 'inner.zip'
      });

      const [url] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toContain('internalPrefix=subdir%2F');
      expect(url).toContain('nestedArchivePath=inner.zip');
    });
  });

  describe('pollJob', () => {
    it('fetches job status by ID', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      const job = {
        status: 'running',
        progress: { completedBytes: 1024, currentFileName: 'data.bin' }
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(job));

      const result = await api.pollJob('job-abc');

      expect(result.status).toBe('running');
      expect(result.progress?.completedBytes).toBe(1024);
      const [url] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toContain('/api/storage/copy/job/job-abc');
    });
  });

  describe('checkObjectExists', () => {
    it('returns true for a successful HEAD request', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

      const exists = await api.checkObjectExists({ bucket: 'b', key: 'file.txt' });
      expect(exists).toBe(true);

      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toContain('/api/storage/download');
      expect(url).toContain('bucket=b');
      expect(url).toContain('key=file.txt');
      expect(init?.method).toBe('HEAD');
    });

    it('returns false for a 404 HEAD response', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));

      const exists = await api.checkObjectExists({ bucket: 'b', key: 'missing.txt' });
      expect(exists).toBe(false);
    });

    it('returns false when disconnected', async () => {
      const api = createFetchStorageApi(() => null);

      const exists = await api.checkObjectExists({ bucket: 'b', key: 'file.txt' });
      expect(exists).toBe(false);
    });
  });

  describe('saveText', () => {
    it('includes preview metadata required by the save endpoint', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

      await api.saveText({
        bucket: 'b',
        key: 'new file.txt',
        body: 'new text',
        originalSize: 0,
        previewBytes: 0,
        contentType: 'text/plain'
      });

      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toContain('/api/storage/save-text');
      expect(url).toContain('bucket=b');
      expect(url).toContain('key=new+file.txt');
      expect(url).toContain('originalSize=0');
      expect(url).toContain('previewBytes=0');
      expect(url).toContain('contentType=text%2Fplain');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe('new text');
    });
  });
});

describe('NDJSON streaming via copy', () => {
  it('calls onProgress callback during streaming', async () => {
    const api = createFetchStorageApi(() => 'conn-1');
    const onProgress = vi.fn();
    const lines = [
      JSON.stringify({
        type: 'progress',
        sourceKey: 'big.bin',
        destKey: 'dest/big.bin',
        loaded: 50,
        total: 100
      }),
      JSON.stringify({
        type: 'progress',
        sourceKey: 'big.bin',
        destKey: 'dest/big.bin',
        loaded: 100,
        total: 100
      }),
      JSON.stringify({ type: 'done', sourceKey: 'big.bin', destKey: 'dest/big.bin' }),
      JSON.stringify({
        type: 'complete',
        results: [{ sourceKey: 'big.bin', destKey: 'dest/big.bin' }],
        failed: []
      })
    ];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ndjsonResponse(lines));

    await api.copy({
      bucket: 'b',
      sourceKeys: ['big.bin'],
      destinationPrefix: 'dest/',
      progress: true,
      callbacks: { onProgress }
    });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledWith('big.bin', 'dest/big.bin', 50, 100);
    expect(onProgress).toHaveBeenCalledWith('big.bin', 'dest/big.bin', 100, 100);
  });

  it('calls onDone callback for each completed item', async () => {
    const api = createFetchStorageApi(() => 'conn-1');
    const onDone = vi.fn();
    const lines = [
      JSON.stringify({ type: 'done', sourceKey: 'a.txt', destKey: 'dest/a.txt' }),
      JSON.stringify({ type: 'done', sourceKey: 'b.txt', destKey: 'dest/b.txt' }),
      JSON.stringify({
        type: 'complete',
        results: [
          { sourceKey: 'a.txt', destKey: 'dest/a.txt' },
          { sourceKey: 'b.txt', destKey: 'dest/b.txt' }
        ],
        failed: []
      })
    ];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ndjsonResponse(lines));

    await api.copy({
      bucket: 'b',
      sourceKeys: ['a.txt', 'b.txt'],
      destinationPrefix: 'dest/',
      progress: true,
      callbacks: { onDone }
    });

    expect(onDone).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledWith('a.txt', 'dest/a.txt');
    expect(onDone).toHaveBeenCalledWith('b.txt', 'dest/b.txt');
  });

  it('calls onComplete with aggregated results', async () => {
    const api = createFetchStorageApi(() => 'conn-1');
    const onComplete = vi.fn();
    const lines = makeNdjsonLines({
      results: [{ sourceKey: 'a.txt', destKey: 'dest/a.txt' }],
      failed: [{ sourceKey: 'b.txt', error: 'Permission denied' }]
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ndjsonResponse(lines));

    await api.copy({
      bucket: 'b',
      sourceKeys: ['a.txt', 'b.txt'],
      destinationPrefix: 'dest/',
      progress: true,
      callbacks: { onComplete }
    });

    expect(onComplete).toHaveBeenCalledOnce();
    const [results, failed] = onComplete.mock.calls[0]!;
    expect(results).toHaveLength(1);
    expect(failed).toHaveLength(1);
  });
});
