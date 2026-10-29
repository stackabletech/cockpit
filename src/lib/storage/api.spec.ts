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
            ]
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
        jsonResponse([{ buckets: ['documents'], query: 'report' }])
      );

      await expect(api.listRecentSearches()).resolves.toEqual([
        { buckets: ['documents'], query: 'report' }
      ]);
      expect(vi.mocked(globalThis.fetch).mock.calls[0]![0]).toBe('/api/storage/search/history');
    });

    it('records and clears recent searches', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

      await api.recordRecentSearch({
        buckets: ['documents', 'archive'],
        query: 'report',
        useRegex: true,
        excludePatterns: ['_temp'],
        searchPath: 'events/',
        maxDepth: 3
      });
      await api.clearRecentSearches();

      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toBe('/api/storage/search/history');
      expect(init).toMatchObject({ method: 'POST' });
      expect(JSON.parse(String(init?.body))).toEqual({
        buckets: ['documents', 'archive'],
        query: 'report',
        useRegex: true,
        excludePatterns: ['_temp'],
        searchPath: 'events/',
        maxDepth: 3
      });
      expect(vi.mocked(globalThis.fetch).mock.calls[1]![1]).toMatchObject({ method: 'DELETE' });
    });
  });

  describe('delete', () => {
    it('sends DELETE with keys in a JSON body', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ failed: [] }));

      const result = await api.delete({ bucket: 'b', keys: ['a.txt', 'b.txt'] });

      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toContain('/api/storage/delete');
      expect(url).toContain('bucket=b');
      expect(init?.method).toBe('DELETE');
      expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
      expect(JSON.parse(init?.body as string)).toEqual({ keys: ['a.txt', 'b.txt'] });
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

  describe('transfers', () => {
    it('posts a plan and returns its items', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      const items = [{ sourceKey: 'a', kind: 'file', destKey: 'd/a', conflict: 'none' }];
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ items }));
      const body = {
        op: 'copy' as const,
        source: { bucket: 'b', keys: ['a'] },
        dest: { bucket: 'b', prefix: 'd/' }
      };

      expect(await api.planTransfer(body)).toEqual(items);

      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toBe('/api/storage/transfer/plan');
      expect(JSON.parse(init?.body as string)).toEqual(body);
    });

    it('passes every transfer event on and reports whether complete arrived', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      const events = [
        { type: 'item-start', sourceKey: 'a', destRoot: 'd/a', totalObjects: 1, totalBytes: 3 },
        {
          type: 'item-done',
          sourceKey: 'a',
          destRoot: 'd/a',
          status: 'done',
          copied: 1,
          failed: [],
          deletedOriginals: 0
        },
        { type: 'complete', summary: { done: 1, partial: 0, failed: 0, refused: 0, cancelled: 0 } }
      ];
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        ndjsonResponse(events.map((event) => JSON.stringify(event)))
      );
      const onEvent = vi.fn();

      const result = await api.transfer(
        {
          op: 'copy',
          jobId: 'job-1',
          source: { bucket: 'b' },
          dest: { bucket: 'b', prefix: 'd/' },
          items: [{ sourceKey: 'a' }]
        },
        onEvent
      );

      expect(result).toEqual({ complete: true });
      expect(onEvent.mock.calls.map(([event]) => event)).toEqual(events);
      expect(vi.mocked(globalThis.fetch).mock.calls[0]![0]).toBe('/api/storage/transfer');
    });

    it('raises errors from the event handler and malformed lines instead of polling', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      const body = { op: 'rename' as const, jobId: 'j', source: { bucket: 'b' }, items: [] };
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(ndjsonResponse(['{"type":"complete","summary":{}}']))
        .mockResolvedValueOnce(ndjsonResponse(['{"type":']));

      await expect(
        api.transfer(body, () => {
          throw new Error('client bug');
        })
      ).rejects.toThrow('client bug');
      await expect(api.transfer(body, vi.fn())).rejects.toThrow('Malformed NDJSON line');
    });

    it('treats a dropped connection as an incomplete stream', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"type":"progress"}\n'));
          controller.error(new TypeError('network error'));
        }
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }));

      expect(
        await api.transfer(
          { op: 'rename', jobId: 'j', source: { bucket: 'b' }, items: [] },
          vi.fn()
        )
      ).toEqual({ complete: false });
    });

    it('reports a stream that ends without complete', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(ndjsonResponse([]));

      expect(
        await api.transfer(
          { op: 'rename', jobId: 'job-1', source: { bucket: 'b' }, items: [] },
          vi.fn()
        )
      ).toEqual({ complete: false });
    });

    it('raises request-level errors as StorageError', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ message: 'Job already exists' }, { status: 409 })
      );

      await expect(
        api.transfer({ op: 'rename', jobId: 'j', source: { bucket: 'b' }, items: [] }, vi.fn())
      ).rejects.toMatchObject({ code: 'conflict' });
    });

    it('reads a transfer job, reporting a missing one as not_found', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse({ status: 'done', items: [] }))
        .mockResolvedValueOnce(jsonResponse({ message: 'Job not found' }, { status: 404 }));

      expect(await api.readTransferJob('job-1')).toEqual({ status: 'done', items: [] });
      expect(await api.readTransferJob('job-2')).toEqual({ status: 'not_found' });
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

    it('reports a missing job as not_found instead of throwing', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ message: 'Job not found' }, { status: 404 })
      );

      await expect(api.pollJob('job-abc')).resolves.toEqual({ status: 'not_found' });
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

    it('throws when disconnected instead of reporting absence', async () => {
      const api = createFetchStorageApi(() => null);

      await expect(api.checkObjectExists({ bucket: 'b', key: 'file.txt' })).rejects.toMatchObject({
        code: 'not_connected'
      });
    });
  });

  describe('saveText', () => {
    it('sends the loaded ETag and returns the new one', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ etag: '"new"' }), { status: 200 })
      );

      const result = await api.saveText({
        bucket: 'b',
        key: 'new file.txt',
        body: 'new text',
        etag: '"old"',
        contentType: 'text/plain'
      });

      expect(result).toEqual({ etag: '"new"' });

      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toContain('/api/storage/save-text');
      expect(url).toContain('bucket=b');
      expect(url).toContain('key=new+file.txt');
      expect(url).toContain('etag=%22old%22');
      expect(url).not.toContain('previewBytes');
      expect(url).toContain('contentType=text%2Fplain');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe('new text');
    });

    it('maps a 409 response to a conflict error', async () => {
      const api = createFetchStorageApi(() => 'conn-1');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ message: 'modified' }), { status: 409 })
      );

      await expect(
        api.saveText({ bucket: 'b', key: 'k', body: 'x', etag: '"old"', contentType: 'text/plain' })
      ).rejects.toMatchObject({ code: 'conflict' });
    });
  });
});
