import { describe, it, expect, vi, beforeEach } from 'vitest';
import { error } from '@sveltejs/kit';

vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ debug: vi.fn(), trace: vi.fn(), info: vi.fn(), warn: vi.fn() }) }
}));

import { HDFSStorageProvider } from './hdfs-provider.js';
import { processKeysSequentially } from './operations.js';
import type { WebHdfsClient } from './webhdfs-client.js';

/** SvelteKit's `error()` throws; capture the HttpError so mocks can reject with it. */
function httpError(status: number, message: string): unknown {
  try {
    error(status, message);
  } catch (err) {
    return err;
  }
}

function mockClient() {
  return {
    listStatusBatch: vi.fn(),
    getFileStatus: vi.fn(),
    getAclStatus: vi.fn(),
    open: vi.fn(),
    create: vi.fn().mockResolvedValue(undefined),
    mkdirs: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(true),
    delete: vi.fn().mockResolvedValue(true),
    getServerDefaults: vi.fn().mockResolvedValue({ trashInterval: 1440 }),
    getTrashRoot: vi.fn().mockResolvedValue('/user/alice/.Trash')
  };
}

let client: ReturnType<typeof mockClient>;
let provider: HDFSStorageProvider;

beforeEach(() => {
  client = mockClient();
  provider = new HDFSStorageProvider(
    { type: 'hdfs', host: 'nn', user: 'alice', bucket: '/data' },
    client as unknown as WebHdfsClient
  );
});

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

describe('putObject', () => {
  it('creates a directory for keys ending in /', async () => {
    await provider.putObject('new/', Buffer.alloc(0), 'application/x-directory', 0);
    expect(client.mkdirs).toHaveBeenCalledWith('/data/new');
    expect(client.create).not.toHaveBeenCalled();
  });

  it('writes buffers with overwrite', async () => {
    await provider.putObject('a.txt', Buffer.from('hi'), 'text/plain', 2);
    const [path, body, options] = client.create.mock.calls[0];
    expect(path).toBe('/data/a.txt');
    expect(Buffer.from(body as Uint8Array).toString()).toBe('hi');
    expect(options).toEqual({ overwrite: true });
  });

  it('reports progress while streaming', async () => {
    client.create.mockImplementation(async (_p: string, body: ReadableStream<Uint8Array>) => {
      await drain(body);
    });
    const onProgress = vi.fn();
    const body = new Response('hello world').body!;
    await provider.putObject('a.txt', body, 'text/plain', 11, onProgress);
    expect(onProgress).toHaveBeenLastCalledWith(11, 11);
  });
});

describe('deleteObjects', () => {
  it('deletes files and directories recursively and treats missing paths as deleted', async () => {
    client.delete.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const result = await provider.deleteObjects(['a.txt', 'dir/']);
    expect(client.delete).toHaveBeenNthCalledWith(1, '/data/a.txt', true);
    expect(client.delete).toHaveBeenNthCalledWith(2, '/data/dir', true);
    expect(result.failed).toEqual([]);
  });

  it('collects per-key failures', async () => {
    client.delete.mockRejectedValueOnce(httpError(403, 'Permission denied'));
    const result = await provider.deleteObjects(['locked.txt', 'ok.txt']);
    expect(result.failed).toEqual([
      { key: 'locked.txt', code: '403', message: 'Permission denied' }
    ]);
    expect(client.delete).toHaveBeenCalledTimes(2);
  });

  it('never deletes the base path itself', async () => {
    const result = await provider.deleteObjects(['', '/']);
    expect(client.delete).not.toHaveBeenCalled();
    expect(result.failed.map((f) => f.code)).toEqual(['InvalidKey', 'InvalidKey']);
  });
});

describe('deleteObjects with trash', () => {
  it('reports trash settings from the NameNode defaults', async () => {
    expect(await provider.getTrashInfo()).toEqual({ enabled: true, intervalMinutes: 1440 });
    client.getServerDefaults.mockResolvedValueOnce({ trashInterval: 0 });
    expect(await provider.getTrashInfo()).toEqual({ enabled: false, intervalMinutes: 0 });
  });

  it('moves keys into <trash root>/Current/<absolute path> like hdfs dfs -rm', async () => {
    client.getFileStatus.mockRejectedValue(httpError(404, 'missing'));
    const result = await provider.deleteObjects(['reports/q3.csv', 'old/'], { useTrash: true });

    expect(client.mkdirs).toHaveBeenCalledWith('/user/alice/.Trash/Current/data/reports');
    expect(client.rename).toHaveBeenCalledWith(
      '/data/reports/q3.csv',
      '/user/alice/.Trash/Current/data/reports/q3.csv'
    );
    expect(client.rename).toHaveBeenCalledWith('/data/old', '/user/alice/.Trash/Current/data/old');
    expect(client.delete).not.toHaveBeenCalled();
    expect(result).toEqual({ failed: [], trashed: 2 });
  });

  it('adds a timestamp suffix when the trash already holds that name', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    client.getFileStatus.mockResolvedValueOnce({ type: 'FILE' });
    await provider.deleteObjects(['a.txt'], { useTrash: true });
    expect(client.rename).toHaveBeenCalledWith(
      '/data/a.txt',
      '/user/alice/.Trash/Current/data/a.txt1234'
    );
    vi.restoreAllMocks();
  });

  it('deletes permanently when trash is disabled on the cluster', async () => {
    client.getServerDefaults.mockResolvedValue({ trashInterval: 0 });
    const result = await provider.deleteObjects(['a.txt'], { useTrash: true });
    expect(client.rename).not.toHaveBeenCalled();
    expect(client.delete).toHaveBeenCalledWith('/data/a.txt', true);
    expect(result).toEqual({ failed: [] });
  });

  it('deletes permanently without useTrash and does not query the NameNode defaults', async () => {
    await provider.deleteObjects(['a.txt']);
    expect(client.getServerDefaults).not.toHaveBeenCalled();
    expect(client.delete).toHaveBeenCalledWith('/data/a.txt', true);
  });

  it('deletes items that are already in the trash permanently', async () => {
    const home = new HDFSStorageProvider(
      { type: 'hdfs', host: 'nn', user: 'alice', bucket: '/user/alice' },
      client as unknown as WebHdfsClient
    );
    const result = await home.deleteObjects(['.Trash/Current/user/alice/a.txt'], {
      useTrash: true
    });
    expect(client.rename).not.toHaveBeenCalled();
    expect(client.delete).toHaveBeenCalledWith('/user/alice/.Trash/Current/user/alice/a.txt', true);
    expect(result).toEqual({ failed: [], trashed: 0 });
  });

  it('refuses to trash a directory that contains the trash', async () => {
    const root = new HDFSStorageProvider(
      { type: 'hdfs', host: 'nn', user: 'alice', bucket: '/' },
      client as unknown as WebHdfsClient
    );
    const result = await root.deleteObjects(['user/'], { useTrash: true });
    expect(client.rename).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
    expect(result.failed).toEqual([expect.objectContaining({ key: 'user/', code: '409' })]);
  });

  it('reports a failure when HDFS refuses the move', async () => {
    client.getFileStatus
      .mockRejectedValueOnce(httpError(404, 'missing')) // trash target free
      .mockResolvedValueOnce({ type: 'FILE' }); // source still there
    client.rename.mockResolvedValue(false);
    const result = await provider.deleteObjects(['a.txt'], { useTrash: true });
    expect(result.failed).toEqual([expect.objectContaining({ key: 'a.txt', code: '502' })]);
    expect(client.delete).not.toHaveBeenCalled();
  });
});

describe('copyObject', () => {
  it('streams file data from OPEN into CREATE with progress', async () => {
    client.getFileStatus.mockResolvedValue({ type: 'FILE', length: 5 });
    client.open.mockResolvedValue(new Response('hello').body);
    let written = '';
    client.create.mockImplementation(async (_p: string, body: ReadableStream<Uint8Array>) => {
      written = await drain(body);
    });
    const onProgress = vi.fn();

    await provider.copyObject('src.txt', 'dst.txt', onProgress);

    expect(client.open).toHaveBeenCalledWith('/data/src.txt');
    expect(client.create).toHaveBeenCalledWith('/data/dst.txt', expect.anything(), {
      overwrite: true
    });
    expect(written).toBe('hello');
    expect(onProgress).toHaveBeenLastCalledWith(5, 5);
  });

  it('creates the destination directory for directory keys', async () => {
    client.getFileStatus.mockResolvedValue({ type: 'DIRECTORY', length: 0 });
    await provider.copyObject('src/', 'dst/');
    expect(client.mkdirs).toHaveBeenCalledWith('/data/dst');
    expect(client.open).not.toHaveBeenCalled();
  });

  it('fails with 404 when the source is missing', async () => {
    client.getFileStatus.mockRejectedValue(httpError(404, 'missing'));
    await expect(provider.copyObject('nope.txt', 'x.txt')).rejects.toMatchObject({ status: 404 });
    expect(client.create).not.toHaveBeenCalled();
  });
});

describe('move', () => {
  it('renames after creating the destination parent', async () => {
    client.getFileStatus.mockRejectedValue(httpError(404, 'missing'));
    await provider.move('a/file.txt', 'b/c/file.txt');
    expect(client.mkdirs).toHaveBeenCalledWith('/data/b/c');
    expect(client.rename).toHaveBeenCalledWith('/data/a/file.txt', '/data/b/c/file.txt');
  });

  it('refuses to move onto an existing destination', async () => {
    client.getFileStatus.mockResolvedValue({ type: 'DIRECTORY' });
    await expect(provider.move('a/', 'b/')).rejects.toMatchObject({ status: 409 });
    expect(client.rename).not.toHaveBeenCalled();
  });

  it('reports 404 when HDFS refuses because the source is gone', async () => {
    client.getFileStatus.mockRejectedValue(httpError(404, 'missing'));
    client.rename.mockResolvedValue(false);
    await expect(provider.move('a.txt', 'b.txt')).rejects.toMatchObject({ status: 404 });
  });
});

describe('processKeysSequentially with a native move', () => {
  it('moves each selected item once instead of copying and deleting expanded keys', async () => {
    // Destinations do not exist yet; sources do.
    client.getFileStatus.mockImplementation(async (path: string) => {
      if (path.startsWith('/data/target/')) throw httpError(404, 'missing');
      return { type: 'DIRECTORY' };
    });
    const onCopySuccess = vi.fn();

    const result = await processKeysSequentially(provider, ['logs/', 'a.txt'], 'target/', {
      deleteOriginals: true,
      onCopySuccess
    });

    expect(client.rename).toHaveBeenCalledWith('/data/logs', '/data/target/logs');
    expect(client.rename).toHaveBeenCalledWith('/data/a.txt', '/data/target/a.txt');
    expect(client.listStatusBatch).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
    expect(client.create).not.toHaveBeenCalled();
    expect(result.succeeded).toEqual([
      { sourceKey: 'logs/', destKey: 'target/logs/' },
      { sourceKey: 'a.txt', destKey: 'target/a.txt' }
    ]);
    expect(onCopySuccess).toHaveBeenCalledTimes(2);
  });

  it('reports HTTP error messages for failed moves', async () => {
    client.getFileStatus.mockRejectedValue(httpError(404, 'missing'));
    client.rename.mockResolvedValue(false);
    const result = await processKeysSequentially(provider, ['gone.txt'], 'target/', {
      deleteOriginals: true
    });
    expect(result.failed).toEqual([
      { sourceKey: 'gone.txt', error: 'Source "gone.txt" not found' }
    ]);
  });
});
