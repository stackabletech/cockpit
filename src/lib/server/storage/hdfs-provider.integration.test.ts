/**
 * Integration test against a real HDFS (NameNode WebHDFS or HttpFS).
 * Skipped unless HDFS_INTEGRATION_URL is set, e.g. `http://172.18.0.2:32669`.
 * For an HA cluster, pass all NameNodes comma-separated (put the standby
 * first to exercise failover).
 * HDFS_INTEGRATION_SUPERUSER (default `stackable`) prepares a scratch
 * directory owned by HDFS_INTEGRATION_USER (default `cockpit-it`).
 * The runner must be able to reach the DataNode addresses the NameNode
 * redirects to.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ debug: vi.fn(), trace: vi.fn(), info: vi.fn(), warn: vi.fn() }) }
}));

import { HDFSStorageProvider } from './hdfs-provider.js';
import { WebHdfsClient } from './webhdfs-client.js';

const url = process.env.HDFS_INTEGRATION_URL;
const nameNodeUrls = (url ?? '')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);
const superuser = process.env.HDFS_INTEGRATION_SUPERUSER ?? 'stackable';
const user = process.env.HDFS_INTEGRATION_USER ?? 'cockpit-it';
const base = `/cockpit-it-${Date.now()}`;

function provider(asUser = user, bucket = base) {
  const nameNodes = nameNodeUrls.map((u) => new URL(u).host);
  return new HDFSStorageProvider({
    type: 'hdfs',
    host: new URL(nameNodeUrls[0]).hostname,
    nameNodes,
    user: asUser,
    bucket
  });
}

async function text(stream: ReadableStream): Promise<string> {
  return new Response(stream).text();
}

describe.skipIf(!url)('HDFSStorageProvider against a real HDFS', () => {
  let admin: WebHdfsClient;

  beforeAll(async () => {
    admin = new WebHdfsClient({ baseUrls: nameNodeUrls, user: superuser });
    await admin.mkdirs(base);
    const res = await fetch(admin.url(base, 'SETOWNER', { owner: user }), { method: 'PUT' });
    expect(res.ok).toBe(true);
    // The trash lives in the user's home directory.
    await admin.mkdirs(`/user/${user}`);
    const home = await fetch(admin.url(`/user/${user}`, 'SETOWNER', { owner: user }), {
      method: 'PUT'
    });
    expect(home.ok).toBe(true);
  });

  afterAll(async () => {
    await admin?.delete(base, true);
    await admin?.delete(`/user/${user}`, true);
  });

  it('checks connectivity via listContainers', async () => {
    expect(await provider().listContainers()).toEqual(['/']);
  });

  it('creates directories and files (following the DataNode redirect)', async () => {
    const p = provider();
    await p.putObject('docs/', Buffer.alloc(0), 'application/x-directory', 0);
    await p.putObject('docs/readme.md', Buffer.from('# Hello HDFS\n'), 'text/markdown', 13);
    await p.putObject('empty/', Buffer.alloc(0), 'application/x-directory', 0);

    const progress = vi.fn();
    const body = new Response('a,b\n1,2\n').body!;
    await p.putObject('data.csv', body, 'text/csv', 8, progress);
    expect(progress).toHaveBeenLastCalledWith(8, 8);

    expect(await p.exists('docs/readme.md')).toBe(true);
    expect(await p.exists('nope.txt')).toBe(false);
  });

  it('streams a multi-megabyte upload and reads it back by range', async () => {
    const p = provider();
    const size = 6 * 1024 * 1024;
    const data = Buffer.alloc(size, 'x');
    data.write('START', 0);
    data.write('END', size - 3);
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= size) return controller.close();
        const chunk = data.subarray(offset, offset + 256 * 1024);
        offset += chunk.length;
        controller.enqueue(chunk);
      }
    });
    await p.putObject('big.bin', stream, 'application/octet-stream', size);

    const meta = await p.getMetadata('big.bin');
    expect(meta.size).toBe(size);
    expect(await text(await p.getObjectRange('big.bin', 0, 4))).toBe('START');
    expect(await text(await p.getObjectRange('big.bin', size - 3, size - 1))).toBe('END');

    const download = await p.getObject('big.bin');
    expect(download.contentLength).toBe(size);
    expect((await new Response(download.stream).arrayBuffer()).byteLength).toBe(size);
  });

  it('returns POSIX metadata and a guessed content type', async () => {
    const meta = await provider().getMetadata('docs/readme.md');
    expect(meta).toMatchObject({
      size: 13,
      contentType: 'text/markdown',
      owner: user,
      replication: 1
    });
    expect(meta.permission).toMatch(/^\d{3,4}$/);
    const dirMeta = await provider().getMetadata('docs/');
    expect(dirMeta.contentType).toBe('application/x-directory');
  });

  it('lists with directories first and paginates with a token', async () => {
    const p = provider();
    for (const name of ['p1.txt', 'p2.txt', 'p3.txt']) {
      await p.putObject(`paged/${name}`, Buffer.from(name), 'text/plain', name.length);
    }
    await p.putObject('paged/sub/', Buffer.alloc(0), 'application/x-directory', 0);

    const first = await p.listObjects('paged/', 2);
    expect(first.objects.map((o) => o.key)).toEqual(['paged/p1.txt', 'paged/p2.txt']);
    expect(first.hasNextPage).toBe(true);
    const second = await p.listObjects('paged/', 2, first.nextContinuationToken);
    expect(second.objects.map((o) => o.key)).toEqual(['paged/sub/', 'paged/p3.txt']);
    expect(second.hasNextPage).toBe(false);

    const root = await p.listObjects('', 100);
    expect(root.objects.filter((o) => o.isDirectory).map((o) => o.key)).toEqual(
      expect.arrayContaining(['docs/', 'empty/', 'paged/'])
    );
    expect(await p.listObjects('missing/', 10)).toMatchObject({ objects: [] });
  });

  it('walks recursively including empty directories, and searches', async () => {
    const p = provider();
    const keys = await p.listAllKeys('');
    expect(keys).toEqual(expect.arrayContaining(['empty/', 'docs/', 'docs/readme.md']));

    const { results } = await p.search('readme');
    expect(results.map((r) => r.key)).toEqual(['docs/readme.md']);
  });

  it('copies files and directories, and moves natively', async () => {
    const p = provider();
    await p.copyObject('docs/readme.md', 'copy/readme.md');
    expect(await text((await p.getObject('copy/readme.md')).stream)).toBe('# Hello HDFS\n');

    await p.copyObject('empty/', 'empty-copy/');
    expect((await p.getMetadata('empty-copy/')).contentType).toBe('application/x-directory');

    await p.move('copy/', 'moved/deeper/copy/');
    expect(await p.exists('copy/')).toBe(false);
    expect(await p.exists('moved/deeper/copy/readme.md')).toBe(true);

    await expect(p.move('docs/', 'paged/')).rejects.toMatchObject({ status: 409 });
    await expect(p.move('ghost/', 'ghost2/')).rejects.toMatchObject({ status: 404 });
  });

  it('deletes recursively and reports per-key failures', async () => {
    const p = provider();
    const result = await p.deleteObjects(['moved/', 'missing.txt', '']);
    expect(result.failed.map((f) => f.key)).toEqual(['']);
    expect(await p.exists('moved/')).toBe(false);
  });

  it('moves deleted keys to the user trash when the cluster has trash enabled', async (ctx) => {
    const p = provider();
    const trash = await p.getTrashInfo();
    if (!trash.enabled) ctx.skip();

    await p.putObject('trash-me/file.txt', Buffer.from('bye'), 'text/plain', 3);
    const result = await p.deleteObjects(['trash-me/'], { useTrash: true });
    expect(result).toEqual({ failed: [], trashed: 1 });
    expect(await p.exists('trash-me/')).toBe(false);

    const trashed = await admin.getFileStatus(
      `/user/${user}/.Trash/Current${base}/trash-me/file.txt`
    );
    expect(trashed.length).toBe(3);

    // Deleting the same name again keeps both copies (timestamp suffix).
    await p.putObject('trash-me/', Buffer.alloc(0), 'application/x-directory', 0);
    expect(await p.deleteObjects(['trash-me/'], { useTrash: true })).toEqual({
      failed: [],
      trashed: 1
    });
    const listing = await admin.listStatus(`/user/${user}/.Trash/Current${base}`);
    expect(listing.filter((s) => s.pathSuffix.startsWith('trash-me')).length).toBe(2);
  });

  it('maps HDFS permission errors to 403', async () => {
    // The scratch directory is owned by the test user with mode 755.
    const other = provider('someone-else');
    await expect(
      other.putObject('intruder.txt', Buffer.from('x'), 'text/plain', 1)
    ).rejects.toMatchObject({ status: 403 });
    await expect(other.deleteObjects(['docs/'])).resolves.toMatchObject({
      failed: [{ key: 'docs/', code: '403' }]
    });
  });

  it('scopes keys to a nested base path and 404s a missing base path', async () => {
    const scoped = provider(user, `${base}/docs`);
    expect((await scoped.listObjects('', 10)).objects.map((o) => o.key)).toEqual(['readme.md']);
    await expect(provider(user, `${base}/nope`).listObjects('', 1)).rejects.toMatchObject({
      status: 404
    });
  });

  it('reports the base path ACL from POSIX permissions', async () => {
    const acl = await provider().getBucketAcl();
    expect(acl.owner).toBe(`${user}:supergroup`);
    expect(acl.grants[0]).toEqual({ grantee: 'owner', permission: 'rwx' });
  });
});
