import { describe, it, expect, vi, beforeEach } from 'vitest';
import { error } from '@sveltejs/kit';

vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ debug: vi.fn(), trace: vi.fn(), info: vi.fn(), warn: vi.fn() }) }
}));

import { HDFSStorageProvider } from './hdfs-provider.js';
import type { HdfsFileStatus, WebHdfsClient } from './webhdfs-client.js';
import type { HDFSConfig } from './types.js';

const config: HDFSConfig = {
  type: 'hdfs',
  host: 'namenode.example.com',
  port: 9870,
  user: 'testuser',
  bucket: '/data'
};

function file(name: string, length = 10): HdfsFileStatus {
  return {
    pathSuffix: name,
    type: 'FILE',
    length,
    modificationTime: 1_700_000_000_000,
    owner: 'alice',
    group: 'staff',
    permission: '644',
    replication: 3,
    blockSize: 134217728
  };
}

function dir(name: string): HdfsFileStatus {
  return { ...file(name, 0), type: 'DIRECTORY', permission: '755', replication: 0, blockSize: 0 };
}

/** SvelteKit's `error()` throws; capture the HttpError so mocks can reject with it. */
function httpError(status: number, message: string): unknown {
  try {
    error(status, message);
  } catch (err) {
    return err;
  }
}

const notFound = () => httpError(404, 'File does not exist');

/** Directory tree keyed by absolute path, served in fixed-size batches. */
function treeClient(tree: Record<string, HdfsFileStatus[]>, batchSize = 1000) {
  const dirs = new Map(Object.entries(tree));
  const listStatusBatch = vi.fn(async (path: string, startAfter?: string) => {
    // Real HDFS listings are sorted by name, which `startAfter` relies on.
    const entries = dirs.get(path)?.toSorted((a, b) => a.pathSuffix.localeCompare(b.pathSuffix));
    if (!entries) throw notFound();
    const rest = startAfter ? entries.filter((e) => e.pathSuffix > startAfter) : entries;
    const statuses = rest.slice(0, batchSize);
    return { statuses, remainingEntries: rest.length - statuses.length };
  });
  return {
    listStatusBatch,
    getFileStatus: vi.fn(),
    getAclStatus: vi.fn(),
    open: vi.fn(),
    create: vi.fn(),
    mkdirs: vi.fn(),
    rename: vi.fn(),
    delete: vi.fn()
  };
}

function provider(client: ReturnType<typeof treeClient>, bucket = '/data') {
  return new HDFSStorageProvider({ ...config, bucket }, client as unknown as WebHdfsClient);
}

describe('HDFSStorageProvider construction and paths', () => {
  it('rejects a relative or traversing base path', () => {
    expect(() => provider(treeClient({}), 'data')).toThrow(
      expect.objectContaining({ status: 400 })
    );
    expect(() => provider(treeClient({}), '/data/../etc')).toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('rejects keys with dot segments before any request', async () => {
    const client = treeClient({});
    await expect(provider(client).getMetadata('a/../../etc/passwd')).rejects.toMatchObject({
      status: 400
    });
    expect(client.getFileStatus).not.toHaveBeenCalled();
  });

  it('listContainers checks connectivity on / and returns it', async () => {
    const client = treeClient({});
    client.getFileStatus.mockResolvedValue(dir(''));
    expect(await provider(client).listContainers()).toEqual(['/']);
    expect(client.getFileStatus).toHaveBeenCalledWith('/');
  });
});

describe('HDFSStorageProvider.listObjects', () => {
  const tree = {
    '/data': [file('a.csv'), dir('b'), file('c.txt'), dir('d'), file('e.json')],
    '/data/b': [file('inner.txt')]
  };

  it('returns keys relative to the base path with directories first', async () => {
    const page = await provider(treeClient(tree)).listObjects('', 25);
    expect(page.objects.map((o) => o.key)).toEqual(['b/', 'd/', 'a.csv', 'c.txt', 'e.json']);
    expect(page.objects[0]).toMatchObject({ isDirectory: true, size: 0 });
    expect(page.objects[2]).toMatchObject({
      isDirectory: false,
      size: 10,
      contentType: 'text/csv'
    });
    expect(page.hasNextPage).toBe(false);
    expect(page.nextContinuationToken).toBeNull();
  });

  it('lists a sub-directory using the prefix as key parent', async () => {
    const page = await provider(treeClient(tree)).listObjects('b/', 25);
    expect(page.objects.map((o) => o.key)).toEqual(['b/inner.txt']);
  });

  it('paginates with a URL-safe token across server batches', async () => {
    const client = treeClient(tree, 2);
    const p = provider(client);

    const first = await p.listObjects('', 3);
    expect(first.objects.map((o) => o.key).sort()).toEqual(['a.csv', 'b/', 'c.txt']);
    expect(first.hasNextPage).toBe(true);
    expect(first.nextContinuationToken).toMatch(/^[A-Za-z0-9_-]+$/);

    const second = await p.listObjects('', 3, first.nextContinuationToken);
    expect(second.objects.map((o) => o.key)).toEqual(['d/', 'e.json']);
    expect(second.hasNextPage).toBe(false);
    expect(second.continuationToken).toBe(first.nextContinuationToken);
  });

  it('returns an empty page for a missing prefix, like S3', async () => {
    const page = await provider(treeClient(tree)).listObjects('missing/', 25);
    expect(page.objects).toEqual([]);
    expect(page.hasNextPage).toBe(false);
  });

  it('returns 404 when the base path itself is missing, like a missing S3 bucket', async () => {
    await expect(provider(treeClient(tree), '/nope').listObjects('', 1)).rejects.toMatchObject({
      status: 404
    });
  });

  it('propagates other errors', async () => {
    const client = treeClient(tree);
    client.listStatusBatch.mockRejectedValue(httpError(403, 'denied'));
    await expect(provider(client).listObjects('', 25)).rejects.toMatchObject({ status: 403 });
  });
});

describe('HDFSStorageProvider metadata and reads', () => {
  let client: ReturnType<typeof treeClient>;
  beforeEach(() => {
    client = treeClient({});
  });

  it('getMetadata returns POSIX fields and a guessed content type for files', async () => {
    client.getFileStatus.mockResolvedValue(file('x.pdf', 42));
    const metadata = await provider(client).getMetadata('docs/x.pdf');
    expect(client.getFileStatus).toHaveBeenCalledWith('/data/docs/x.pdf');
    expect(metadata).toMatchObject({
      size: 42,
      contentType: 'application/pdf',
      etag: undefined,
      owner: 'alice',
      group: 'staff',
      permission: '644',
      replication: 3,
      blockSize: 134217728
    });
  });

  it('getMetadata on a directory key returns the directory status', async () => {
    client.getFileStatus.mockResolvedValue(dir('docs'));
    const metadata = await provider(client).getMetadata('docs/');
    expect(client.getFileStatus).toHaveBeenCalledWith('/data/docs');
    expect(metadata).toMatchObject({ size: 0, contentType: 'application/x-directory' });
    expect(metadata.replication).toBeUndefined();
  });

  it('getObject reports a length equal to the file size', async () => {
    const stream = new ReadableStream();
    client.getFileStatus.mockResolvedValue(file('a.txt', 123));
    client.open.mockResolvedValue(stream);
    const result = await provider(client).getObject('a.txt');
    expect(result).toMatchObject({ stream, contentLength: 123, contentType: 'text/plain' });
  });

  it('getObject refuses directories', async () => {
    client.getFileStatus.mockResolvedValue(dir('d'));
    await expect(provider(client).getObject('d')).rejects.toMatchObject({ status: 400 });
  });

  it('getObjectRange converts the inclusive end into a length', async () => {
    client.open.mockResolvedValue(new ReadableStream());
    await provider(client).getObjectRange('a.txt', 10, 19);
    expect(client.open).toHaveBeenCalledWith('/data/a.txt', { offset: 10, length: 10 });
  });

  it('exists is false only for not-found', async () => {
    client.getFileStatus.mockRejectedValueOnce(notFound());
    expect(await provider(client).exists('a')).toBe(false);
    client.getFileStatus.mockResolvedValueOnce(file('a'));
    expect(await provider(client).exists('a')).toBe(true);
    client.getFileStatus.mockRejectedValueOnce(httpError(403, 'denied'));
    await expect(provider(client).exists('a')).rejects.toMatchObject({ status: 403 });
  });

  it('getBucketAcl expands permissions and ACL entries', async () => {
    client.getAclStatus.mockResolvedValue({
      owner: 'hdfs',
      group: 'supergroup',
      permission: '1750',
      entries: ['user:bob:r-x', 'group:analysts:r--']
    });
    expect(await provider(client).getBucketAcl()).toEqual({
      owner: 'hdfs:supergroup',
      grants: [
        { grantee: 'owner', permission: 'rwx' },
        { grantee: 'group', permission: 'r-x' },
        { grantee: 'other', permission: '---' },
        { grantee: 'user:bob', permission: 'r-x' },
        { grantee: 'group:analysts', permission: 'r--' }
      ]
    });
  });

  it('S3-only bucket details return neutral values', async () => {
    const p = provider(client);
    expect(await p.getBucketVersioning()).toBe('Disabled');
    expect(await p.getBucketLifecycleRules()).toEqual([]);
    expect(await p.getBucketTags()).toEqual({});
  });
});

describe('HDFSStorageProvider recursive listing and search', () => {
  const tree = {
    '/data': [dir('logs'), file('readme.md'), dir('empty')],
    '/data/logs': [file('app.log'), dir('2026')],
    '/data/logs/2026': [file('app-1.log'), file('app-2.log')],
    '/data/empty': []
  };

  it('listAllKeys includes empty directories and excludes the prefix itself', async () => {
    const keys = await provider(treeClient(tree, 1)).listAllKeys('logs/');
    expect(keys.sort()).toEqual([
      'logs/2026/',
      'logs/2026/app-1.log',
      'logs/2026/app-2.log',
      'logs/app.log'
    ]);
    const all = await provider(treeClient(tree)).listAllKeys('');
    expect(all).toContain('empty/');
  });

  it('listAllKeys with a partial name prefix filters siblings', async () => {
    const keys = await provider(treeClient(tree)).listAllKeys('re');
    expect(keys).toEqual(['readme.md']);
  });

  it('listAllKeysProgressively stops when onBatch returns false', async () => {
    const client = treeClient(tree, 1);
    const onBatch = vi.fn(() => false);
    await provider(client).listAllKeysProgressively('', onBatch);
    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(client.listStatusBatch).toHaveBeenCalledTimes(1);
  });

  it('search matches files and directories and honours maxDepth without descending', async () => {
    const client = treeClient(tree);
    const onMatch = vi.fn();
    const { results } = await provider(client).search('app', { maxDepth: 2, onMatch });
    expect(results.map((r) => r.key)).toEqual(['logs/app.log']);
    expect(onMatch).toHaveBeenCalledTimes(1);
    expect(client.listStatusBatch).not.toHaveBeenCalledWith(
      '/data/logs/2026',
      undefined,
      undefined
    );

    const dirs = await provider(treeClient(tree)).search('2026');
    expect(dirs.results.map((r) => [r.key, r.isDirectory])).toEqual([
      ['logs/2026/', true],
      ['logs/2026/app-1.log', false],
      ['logs/2026/app-2.log', false]
    ]);
  });

  it('search aborts with AbortError', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider(treeClient(tree)).search('x', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
