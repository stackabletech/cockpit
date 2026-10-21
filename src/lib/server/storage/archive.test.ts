import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { readFileSync, readdirSync, statSync, unlinkSync, existsSync, mkdtempSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { threadId } from 'node:worker_threads';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';
import * as tar from 'tar-stream';
import { createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';

vi.mock('$lib/server/logging', () => import('$lib/test-utils/mock-logger.js'));

const DEFAULT_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const flags = vi.hoisted(() => ({ archiveCacheMaxBytes: 512 * 1024 * 1024 }));
vi.mock('$lib/server/feature-flags.js', () => ({
  get archiveCacheMaxBytes() {
    return flags.archiveCacheMaxBytes;
  }
}));

import {
  getArchiveFormat,
  listArchiveContents,
  extractArchiveEntry,
  clearArchiveCache,
  archiveCacheBytes,
  ArchiveCacheFullError,
  type ArchiveDownloadFn
} from './archive.js';
import { storageArchiveCacheEvictionsTotal } from '$lib/server/metrics.js';

const testDir = mkdtempSync(join(tmpdir(), 'archive-test-'));
const cleanupPaths: string[] = [];

function testPath(name: string): string {
  const p = join(testDir, name);
  cleanupPaths.push(p);
  return p;
}

function makeZip(path: string, entries: Record<string, string | Buffer>): void {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    if (typeof content === 'string') {
      zip.addFile(name, Buffer.from(content, 'utf-8'));
    } else {
      zip.addFile(name, content);
    }
  }
  zip.writeZip(path);
}

function makeTar(path: string, entries: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const pack = tar.pack();
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const ws = createWriteStream(path);
    pack.pipe(ws);
    for (const [name, content] of Object.entries(entries)) {
      pack.entry({ name }, Buffer.from(content, 'utf-8'));
    }
    pack.finalize();
    ws.on('finish', resolve);
    ws.on('error', reject);
  });
}

function makeTarGz(path: string, entries: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const pack = tar.pack();
    const gz = createGzip();
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const ws = createWriteStream(path);
    pack.pipe(gz).pipe(ws);
    for (const [name, content] of Object.entries(entries)) {
      pack.entry({ name }, Buffer.from(content, 'utf-8'));
    }
    pack.finalize();
    ws.on('finish', resolve);
    ws.on('error', reject);
  });
}

function makeNestedZip(): string {
  const innerZip = new AdmZip();
  innerZip.addFile('nested.txt', Buffer.from('nested content', 'utf-8'));
  const innerPath = testPath('inner.zip');
  innerZip.writeZip(innerPath);

  const outerZip = new AdmZip();
  outerZip.addFile('top.txt', Buffer.from('top content', 'utf-8'));
  outerZip.addLocalFile(innerPath, 'archives/');
  const outerPath = testPath('outer.zip');
  outerZip.writeZip(outerPath);
  return outerPath;
}

/** HEAD stub reporting a fixed ETag, so the archive is cached. */
function head(etag = '"v1"', size = 1024) {
  return vi.fn(async () => ({ size, etag }));
}

function bufferStream(data: Buffer): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(data));
      controller.close();
    }
  });
}

const dummyDownloadFn: ArchiveDownloadFn = (key: string) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  Promise.resolve({ stream: bufferStream(readFileSync(key)) });

describe('getArchiveFormat', () => {
  it('detects .zip', () => {
    expect(getArchiveFormat('archive.zip')).toBe('zip');
  });

  it('detects .tar.gz', () => {
    expect(getArchiveFormat('archive.tar.gz')).toBe('tar.gz');
  });

  it('detects .tgz', () => {
    expect(getArchiveFormat('archive.tgz')).toBe('tgz');
  });

  it('detects .tar', () => {
    expect(getArchiveFormat('archive.tar')).toBe('tar');
  });

  it('does not support RAR or 7z archives', () => {
    expect(getArchiveFormat('archive.rar')).toBeNull();
    expect(getArchiveFormat('ARCHIVE.RAR')).toBeNull();
    expect(getArchiveFormat('archive.7z')).toBeNull();
  });

  it('returns null for non-archive files', () => {
    expect(getArchiveFormat('readme.txt')).toBeNull();
    expect(getArchiveFormat('script.js')).toBeNull();
    expect(getArchiveFormat('data.csv')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(getArchiveFormat('ARCHIVE.ZIP')).toBe('zip');
    expect(getArchiveFormat('Archive.Tar.Gz')).toBe('tar.gz');
  });
});

describe('listArchiveContents', () => {
  beforeEach(() => {
    clearArchiveCache();
  });

  afterAll(() => {
    clearArchiveCache();
    for (const p of cleanupPaths) {
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (existsSync(p)) unlinkSync(p);
      } catch {
        /* noop */
      }
    }
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      if (existsSync(testDir)) unlinkSync(testDir);
    } catch {
      /* noop */
    }
  });

  describe('ZIP', () => {
    it('lists top-level files and directories', async () => {
      const path = testPath('test.zip');
      makeZip(path, {
        'README.md': '# Test',
        'src/index.js': 'console.log("hello")',
        'src/lib/util.js': 'export const x = 1',
        'docs/guide.md': '# Guide'
      });

      const listing = await listArchiveContents('test-bucket', path, '', dummyDownloadFn, head());

      const dirs = listing.entries.filter((e) => e.isDirectory).map((e) => e.key);
      const files = listing.entries.filter((e) => !e.isDirectory).map((e) => e.key);

      expect(dirs.sort()).toEqual(['docs/', 'src/']);
      expect(files).toEqual(['README.md']);
    });

    it('lists contents under an internal prefix', async () => {
      const path = testPath('nested.zip');
      makeZip(path, {
        'a/b/c/file1.txt': 'one',
        'a/b/c/file2.txt': 'two',
        'a/b/other.md': 'other',
        'a/top.txt': 'top'
      });

      const listing = await listArchiveContents(
        'test-bucket',
        path,
        'a/b/',
        dummyDownloadFn,
        head()
      );

      const dirs = listing.entries.filter((e) => e.isDirectory).map((e) => e.key);
      const files = listing.entries.filter((e) => !e.isDirectory).map((e) => e.key);

      expect(dirs.sort()).toEqual(['c/']);
      expect(files).toEqual(['other.md']);
    });

    it('filters out deep nested entries at prefix root', async () => {
      const path = testPath('deep.zip');
      makeZip(path, {
        'top.txt': 'top',
        'alpha/beta/gamma/deep.txt': 'deep',
        'alpha/beta/other.txt': 'other',
        'alpha/surface.txt': 'surface'
      });

      const listing = await listArchiveContents(
        'test-bucket',
        path,
        'alpha/',
        dummyDownloadFn,
        head()
      );

      const dirs = listing.entries.filter((e) => e.isDirectory).map((e) => e.key);
      const files = listing.entries.filter((e) => !e.isDirectory).map((e) => e.key);

      expect(dirs).toEqual(['beta/']);
      expect(files).toEqual(['surface.txt']);
    });

    it('handles empty archive', async () => {
      const path = testPath('empty.zip');
      makeZip(path, {});

      const listing = await listArchiveContents('test-bucket', path, '', dummyDownloadFn, head());

      expect(listing.entries).toHaveLength(0);
    });

    it('handles prefix with no matches', async () => {
      const path = testPath('nomatch.zip');
      makeZip(path, { 'only.txt': 'content' });

      const listing = await listArchiveContents(
        'test-bucket',
        path,
        'nonexistent/',
        dummyDownloadFn,
        head()
      );

      expect(listing.entries).toHaveLength(0);
    });
  });

  describe('TAR', () => {
    it('lists top-level files and directories', async () => {
      const path = testPath('test.tar');
      await makeTar(path, {
        'README.md': '# Test',
        'src/index.js': 'console.log("hello")',
        'src/lib/util.js': 'export const x = 1',
        'docs/guide.md': '# Guide'
      });

      const listing = await listArchiveContents('test-bucket', path, '', dummyDownloadFn, head());

      const dirs = listing.entries.filter((e) => e.isDirectory).map((e) => e.key);
      const files = listing.entries.filter((e) => !e.isDirectory).map((e) => e.key);

      expect(dirs.sort()).toEqual(['docs/', 'src/']);
      expect(files).toEqual(['README.md']);
    });

    it('lists contents under an internal prefix', async () => {
      const path = testPath('nested.tar');
      await makeTar(path, {
        'x/y/z/data.txt': 'data',
        'x/y/other.txt': 'other',
        'x/root.txt': 'root'
      });

      const listing = await listArchiveContents(
        'test-bucket',
        path,
        'x/y/',
        dummyDownloadFn,
        head()
      );

      const dirs = listing.entries.filter((e) => e.isDirectory).map((e) => e.key);
      const files = listing.entries.filter((e) => !e.isDirectory).map((e) => e.key);

      expect(dirs).toEqual(['z/']);
      expect(files).toEqual(['other.txt']);
    });
  });

  describe('TAR.GZ', () => {
    it('lists contents of a compressed tar', async () => {
      const path = testPath('test.tar.gz');
      await makeTarGz(path, {
        'data/file1.csv': 'a,b,c',
        'data/file2.csv': 'd,e,f',
        'summary.txt': 'summary'
      });

      const listing = await listArchiveContents('test-bucket', path, '', dummyDownloadFn, head());

      const dirs = listing.entries.filter((e) => e.isDirectory).map((e) => e.key);
      const files = listing.entries.filter((e) => !e.isDirectory).map((e) => e.key);

      expect(dirs).toEqual(['data/']);
      expect(files).toEqual(['summary.txt']);
    });
  });

  it('rejects RAR listing before downloading the archive', async () => {
    const download = vi.fn<ArchiveDownloadFn>();
    await expect(
      listArchiveContents('test-bucket', 'archive.rar', '', download, head())
    ).rejects.toThrow('Unsupported archive format: archive.rar');
    expect(download).not.toHaveBeenCalled();
  });

  describe('Nested archives', () => {
    it('lists contents of a nested zip inside outer zip', async () => {
      const outerPath = makeNestedZip();

      const listing = await listArchiveContents(
        'test-bucket',
        outerPath,
        '',
        dummyDownloadFn,
        head(),
        { nestedArchivePath: 'archives/inner.zip' }
      );

      const files = listing.entries.filter((e) => !e.isDirectory).map((e) => e.key);
      expect(files).toEqual(['nested.txt']);
    });
  });
});

describe('extractArchiveEntry', () => {
  beforeEach(() => {
    clearArchiveCache();
  });

  it('rejects RAR extraction before downloading the archive', async () => {
    const download = vi.fn<ArchiveDownloadFn>();
    await expect(
      extractArchiveEntry('test-bucket', 'archive.rar', 'file.txt', download, head())
    ).rejects.toThrow('Unsupported archive format: archive.rar');
    expect(download).not.toHaveBeenCalled();
  });

  it('extracts a file from a ZIP', async () => {
    const path = testPath('extract.zip');
    makeZip(path, { 'hello.txt': 'Hello, World!' });

    const buf = await extractArchiveEntry(
      'test-bucket',
      path,
      'hello.txt',
      dummyDownloadFn,
      head()
    );

    expect(buf).toBeInstanceOf(Buffer);
    expect(buf!.toString('utf-8')).toBe('Hello, World!');
  });

  it('extracts a file from a TAR', async () => {
    const path = testPath('extract.tar');
    await makeTar(path, { 'greeting.txt': 'Hi there' });

    const buf = await extractArchiveEntry(
      'test-bucket',
      path,
      'greeting.txt',
      dummyDownloadFn,
      head()
    );

    expect(buf!.toString('utf-8')).toBe('Hi there');
  });

  it('extracts a file from a TAR.GZ', async () => {
    const path = testPath('extract.tar.gz');
    await makeTarGz(path, { 'compressed.txt': 'was compressed' });

    const buf = await extractArchiveEntry(
      'test-bucket',
      path,
      'compressed.txt',
      dummyDownloadFn,
      head()
    );

    expect(buf!.toString('utf-8')).toBe('was compressed');
  });

  it('returns null for non-existent file', async () => {
    const path = testPath('missing.zip');
    makeZip(path, { 'exists.txt': 'content' });

    const buf = await extractArchiveEntry(
      'test-bucket',
      path,
      'not-found.txt',
      dummyDownloadFn,
      head()
    );

    expect(buf).toBeNull();
  });

  it('extracts a file from a nested archive', async () => {
    const outerPath = makeNestedZip();

    const buf = await extractArchiveEntry(
      'test-bucket',
      outerPath,
      'nested.txt',
      dummyDownloadFn,
      head(),
      { nestedArchivePath: 'archives/inner.zip' }
    );

    expect(buf!.toString('utf-8')).toBe('nested content');
  });
});

describe('Caching', () => {
  it('reuses cached archive across listing calls', async () => {
    clearArchiveCache();
    const path = testPath('cached.zip');
    makeZip(path, { 'file.txt': 'content' });

    const downloadSpy = vi.fn(dummyDownloadFn);

    const first = await listArchiveContents('test-bucket', path, '', downloadSpy, head());
    expect(first.entries).toHaveLength(1);
    expect(downloadSpy).toHaveBeenCalledTimes(1);

    const second = await listArchiveContents('test-bucket', path, '', downloadSpy, head());
    expect(second.entries).toHaveLength(1);
    // downloadFn should NOT be called again — result comes from cache
    expect(downloadSpy).toHaveBeenCalledTimes(1);

    clearArchiveCache();
  });

  it('does not share cached archives between connections', async () => {
    clearArchiveCache();
    const archiveStream = (contents: string) => ({
      stream: bufferStream(zipBuffer('file.txt', contents))
    });
    const firstDownload = vi.fn(async () => archiveStream('first connection'));
    const secondDownload = vi.fn(async () => archiveStream('second connection'));

    const first = await listArchiveContents(
      'shared-bucket',
      'archive.zip',
      '',
      firstDownload,
      head(),
      { connectionId: 'connection-a' }
    );
    const second = await listArchiveContents(
      'shared-bucket',
      'archive.zip',
      '',
      secondDownload,
      head(),
      { connectionId: 'connection-b' }
    );

    expect(firstDownload).toHaveBeenCalledOnce();
    expect(secondDownload).toHaveBeenCalledOnce();
    expect(first.entries).toHaveLength(1);
    expect(second.entries).toHaveLength(1);
    clearArchiveCache();
  });
});

describe('Cache invalidation', () => {
  beforeEach(() => {
    clearArchiveCache();
    storageArchiveCacheEvictionsTotal.reset();
  });

  async function evictions(reason: string): Promise<number> {
    const { values } = await storageArchiveCacheEvictionsTotal.get();
    return values.find((v) => v.labels.reason === reason)?.value ?? 0;
  }

  afterEach(() => {
    clearArchiveCache();
  });

  /** An object store holding one archive whose content and ETag can change. */
  function mutableArchive(name: string, content: string) {
    const object = { data: zipBuffer(name, content), etag: '"v1"' };
    const download = vi.fn<ArchiveDownloadFn>(async () => ({
      stream: bufferStream(object.data),
      etag: object.etag
    }));
    const metadata = vi.fn(async () => ({ size: object.data.length, etag: object.etag }));
    return {
      download,
      metadata,
      replace(newName: string, newContent: string, etag: string) {
        object.data = zipBuffer(newName, newContent);
        object.etag = etag;
      }
    };
  }

  it('downloads the archive again once its ETag changes', async () => {
    const archive = mutableArchive('old.txt', 'old');
    const list = () =>
      listArchiveContents('test-bucket', 'changing.zip', '', archive.download, archive.metadata);

    expect((await list()).entries.map((e) => e.key)).toEqual(['old.txt']);
    expect((await list()).entries.map((e) => e.key)).toEqual(['old.txt']);
    expect(archive.download).toHaveBeenCalledOnce();

    archive.replace('new.txt', 'new', '"v2"');

    expect((await list()).entries.map((e) => e.key)).toEqual(['new.txt']);
    expect(archive.download).toHaveBeenCalledTimes(2);
    // The old version is removed as soon as the new one is cached.
    expect(cachedFileCount()).toBe(1);
    expect(await evictions('stale')).toBe(1);
    expect(archiveCacheBytes()).toBe(zipBuffer('new.txt', 'new').length);
  });

  it('refreshes a nested archive when the outer archive changes', async () => {
    const outer = (innerFile: string) => {
      const zip = new AdmZip();
      zip.addFile('inner.zip', zipBuffer(innerFile, 'content'));
      return zip.toBuffer();
    };
    const object = { data: outer('first.txt'), etag: '"v1"' };
    const download = vi.fn<ArchiveDownloadFn>(async () => ({
      stream: bufferStream(object.data),
      etag: object.etag
    }));
    const metadata = vi.fn(async () => ({ size: object.data.length, etag: object.etag }));
    const list = () =>
      listArchiveContents('test-bucket', 'outer.zip', '', download, metadata, {
        nestedArchivePath: 'inner.zip'
      });

    expect((await list()).entries.map((e) => e.key)).toEqual(['first.txt']);
    object.data = outer('second.txt');
    object.etag = '"v2"';

    expect((await list()).entries.map((e) => e.key)).toEqual(['second.txt']);
    expect(download).toHaveBeenCalledTimes(2);
    // Outer and nested entry of the new version only.
    expect(cachedFileCount()).toBe(2);
  });

  it('does not cache the archive when HEAD fails', async () => {
    const path = testPath('head-error.zip');
    makeZip(path, { 'file.txt': 'content' });
    const downloadSpy = vi.fn(dummyDownloadFn);
    const metadataFn = vi.fn().mockRejectedValue(new Error('HEAD failed'));
    const options = { maxBytes: 1024 * 1024 };

    const first = await listArchiveContents(
      'test-bucket',
      path,
      '',
      downloadSpy,
      metadataFn,
      options
    );
    expect(first.entries.map((e) => e.key)).toEqual(['file.txt']);
    expect(cachedFileCount()).toBe(0);
    expect(archiveCacheBytes()).toBe(0);

    await listArchiveContents('test-bucket', path, '', downloadSpy, metadataFn, options);
    expect(downloadSpy).toHaveBeenCalledTimes(2);
    expect(cachedFileCount()).toBe(0);
    expect(await evictions('single_use')).toBe(2);
    expect(await evictions('expired')).toBe(0);
  });

  it('does not cache a download whose ETag differs from the HEAD', async () => {
    // HEAD still reports v1, but the GET already returns v2.
    const download = vi.fn<ArchiveDownloadFn>(async () => ({
      stream: bufferStream(zipBuffer('new.txt', 'new')),
      etag: '"v2"'
    }));
    const list = () => listArchiveContents('test-bucket', 'racing.zip', '', download, head('"v1"'));

    expect((await list()).entries.map((e) => e.key)).toEqual(['new.txt']);
    expect(cachedFileCount()).toBe(0);
    expect(archiveCacheBytes()).toBe(0);

    await list();
    expect(download).toHaveBeenCalledTimes(2);
  });

  it('does not cache a nested archive extracted from an uncached download', async () => {
    const outerPath = makeNestedZip();
    const options = { nestedArchivePath: 'archives/inner.zip', maxBytes: 1024 * 1024 };
    const failingHead = vi.fn().mockRejectedValue(new Error('HEAD failed'));
    const mismatchingDownload = vi.fn<ArchiveDownloadFn>(async (key) => ({
      ...(await dummyDownloadFn(key)),
      etag: '"v2"'
    }));

    for (const [download, metadata] of [
      [dummyDownloadFn, failingHead],
      [mismatchingDownload, head('"v1"')]
    ] as const) {
      const listing = await listArchiveContents(
        'test-bucket',
        outerPath,
        '',
        download,
        metadata,
        options
      );
      expect(listing.entries.map((e) => e.key)).toEqual(['nested.txt']);
      expect(cachedFileCount()).toBe(0);
      expect(archiveCacheBytes()).toBe(0);
    }
  });

  it('does not cache an archive whose only version is an epoch Last-Modified', async () => {
    const path = testPath('epoch.zip');
    makeZip(path, { 'file.txt': 'content' });
    const downloadSpy = vi.fn(dummyDownloadFn);
    const metadataFn = vi.fn(async () => ({ size: 100, lastModified: new Date(0) }));

    await listArchiveContents('test-bucket', path, '', downloadSpy, metadataFn);
    await listArchiveContents('test-bucket', path, '', downloadSpy, metadataFn);

    expect(downloadSpy).toHaveBeenCalledTimes(2);
    expect(cachedFileCount()).toBe(0);
  });

  it('does not cache the archive when HEAD returns no version', async () => {
    const path = testPath('no-etag.zip');
    makeZip(path, { 'file.txt': 'content' });
    const downloadSpy = vi.fn(dummyDownloadFn);
    const metadataFn = vi.fn(async () => ({ size: 100 }));

    await listArchiveContents('test-bucket', path, '', downloadSpy, metadataFn);
    await listArchiveContents('test-bucket', path, '', downloadSpy, metadataFn);

    expect(downloadSpy).toHaveBeenCalledTimes(2);
    expect(cachedFileCount()).toBe(0);
  });

  it('uses size and last-modified time when there is no ETag', async () => {
    const path = testPath('last-modified.zip');
    makeZip(path, { 'file.txt': 'content' });
    const downloadSpy = vi.fn(dummyDownloadFn);
    const meta = { size: 100, lastModified: new Date('2026-10-15T10:00:00Z') };
    const metadataFn = vi.fn(async () => meta);

    await listArchiveContents('test-bucket', path, '', downloadSpy, metadataFn);
    await listArchiveContents('test-bucket', path, '', downloadSpy, metadataFn);
    expect(downloadSpy).toHaveBeenCalledOnce();

    meta.lastModified = new Date('2026-10-15T10:05:00Z');
    await listArchiveContents('test-bucket', path, '', downloadSpy, metadataFn);
    expect(downloadSpy).toHaveBeenCalledTimes(2);
    expect(cachedFileCount()).toBe(1);
  });
});

// ── Cache limits, deduplication and aborts ──────────────────────────────────

/** Number of archive files this test worker currently has on disk. */
function cachedFileCount(): number {
  const root = join(tmpdir(), 'cockpit-archive-cache');
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!existsSync(root)) return 0;
  let count = 0;
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  for (const name of readdirSync(root)) {
    if (!name.startsWith(`${process.pid}.${threadId}-`)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    count += readdirSync(join(root, name)).length;
  }
  return count;
}

/** A download whose stream only delivers `data` once `finish()` is called. */
function controlledDownload(data: Buffer) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const state = { cancelled: false };
  const fn = vi.fn(async () => ({
    stream: new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
      cancel() {
        state.cancelled = true;
      }
    })
  }));
  return {
    fn,
    state,
    finish() {
      controller.enqueue(new Uint8Array(data));
      controller.close();
    }
  };
}

function zipBuffer(name: string, content: Buffer | string): Buffer {
  const zip = new AdmZip();
  zip.addFile(name, typeof content === 'string' ? Buffer.from(content) : content);
  return zip.toBuffer();
}

describe('Cache limits', () => {
  beforeEach(() => {
    clearArchiveCache();
  });

  afterEach(() => {
    clearArchiveCache();
    flags.archiveCacheMaxBytes = DEFAULT_CACHE_MAX_BYTES;
  });

  it('enforces the size limit while downloading when HEAD fails', async () => {
    const path = testPath('head-fails.zip');
    makeZip(path, { 'random.bin': randomBytes(4096) });
    const metadataFn = vi.fn().mockRejectedValue(new Error('HEAD failed'));

    const listing = await listArchiveContents(
      'test-bucket',
      path,
      '',
      dummyDownloadFn,
      metadataFn,
      {
        maxBytes: 1024
      }
    );

    expect(listing.tooLarge).toBe(true);
    expect(archiveCacheBytes()).toBe(0);
    expect(cachedFileCount()).toBe(0);
  });

  it('shares one download between concurrent requests', async () => {
    const path = testPath('concurrent.zip');
    makeZip(path, { 'file.txt': 'content' });
    const downloadSpy = vi.fn(dummyDownloadFn);

    const [first, second] = await Promise.all([
      listArchiveContents('test-bucket', path, '', downloadSpy, head()),
      listArchiveContents('test-bucket', path, '', downloadSpy, head())
    ]);

    expect(downloadSpy).toHaveBeenCalledOnce();
    expect(first.entries).toHaveLength(1);
    expect(second.entries).toHaveLength(1);
    expect(cachedFileCount()).toBe(1);
  });

  it('aborts the download and removes the partial file when the client goes away', async () => {
    const download = controlledDownload(zipBuffer('file.txt', 'content'));
    const abort = new AbortController();

    const listing = listArchiveContents('test-bucket', 'abort.zip', '', download.fn, head(), {
      signal: abort.signal
    });
    await vi.waitFor(() => expect(download.fn).toHaveBeenCalled());
    abort.abort();

    await expect(listing).rejects.toThrow();
    await vi.waitFor(() => expect(download.state.cancelled).toBe(true));
    await vi.waitFor(() => expect(cachedFileCount()).toBe(0));
    expect(archiveCacheBytes()).toBe(0);
  });

  it('does not start the download when the client goes away during HEAD', async () => {
    let resolveHead!: (meta: { size: number }) => void;
    const metadataFn = vi.fn(
      () =>
        new Promise<{ size: number }>((resolve) => {
          resolveHead = resolve;
        })
    );
    const downloadSpy = vi.fn(dummyDownloadFn);
    const abort = new AbortController();

    const listing = listArchiveContents('test-bucket', 'head.zip', '', downloadSpy, metadataFn, {
      signal: abort.signal
    });
    await vi.waitFor(() => expect(metadataFn).toHaveBeenCalled());
    abort.abort();
    await expect(listing).rejects.toThrow();
    resolveHead({ size: 100 });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(downloadSpy).not.toHaveBeenCalled();
    expect(cachedFileCount()).toBe(0);
  });

  it('keeps the download running while another request still waits for it', async () => {
    const download = controlledDownload(zipBuffer('file.txt', 'content'));
    const abort = new AbortController();

    const aborted = listArchiveContents('test-bucket', 'shared.zip', '', download.fn, head(), {
      signal: abort.signal
    });
    const waiting = listArchiveContents('test-bucket', 'shared.zip', '', download.fn, head());
    await vi.waitFor(() => expect(download.fn).toHaveBeenCalled());
    abort.abort();
    await expect(aborted).rejects.toThrow();

    download.finish();
    const listing = await waiting;

    expect(listing.entries.map((e) => e.key)).toEqual(['file.txt']);
    expect(download.fn).toHaveBeenCalledOnce();
    expect(download.state.cancelled).toBe(false);
  });

  it('evicts the least recently used archive when the cache is full', async () => {
    const paths = ['lru-a.zip', 'lru-b.zip', 'lru-c.zip'].map((name) => {
      const path = testPath(name);
      makeZip(path, { 'random.bin': randomBytes(1000) });
      return path;
    });
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const sizes = paths.map((path) => statSync(path).size);
    flags.archiveCacheMaxBytes = sizes[0] + sizes[1] + 10;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const metadataFn = vi.fn(async (key: string) => ({ size: statSync(key).size, etag: '"v1"' }));
    const downloadSpy = vi.fn(dummyDownloadFn);

    for (const path of paths) {
      await listArchiveContents('test-bucket', path, '', downloadSpy, metadataFn);
    }

    expect(archiveCacheBytes()).toBe(sizes[1] + sizes[2]);
    expect(cachedFileCount()).toBe(2);

    // The evicted archive is downloaded again, the others come from the cache.
    await listArchiveContents('test-bucket', paths[2], '', downloadSpy, metadataFn);
    expect(downloadSpy).toHaveBeenCalledTimes(3);
    await listArchiveContents('test-bucket', paths[0], '', downloadSpy, metadataFn);
    expect(downloadSpy).toHaveBeenCalledTimes(4);
  });

  it('rejects a download when the space is held by archives in use', async () => {
    const busy = zipBuffer('random.bin', randomBytes(1000));
    const download = controlledDownload(busy);
    flags.archiveCacheMaxBytes = busy.length + 10;
    const metadataFn = head('"v1"', busy.length);

    const running = listArchiveContents('test-bucket', 'busy.zip', '', download.fn, metadataFn);
    await vi.waitFor(() => expect(download.fn).toHaveBeenCalled());

    await expect(
      listArchiveContents('test-bucket', 'other.zip', '', dummyDownloadFn, metadataFn)
    ).rejects.toBeInstanceOf(ArchiveCacheFullError);

    download.finish();
    expect((await running).entries).toHaveLength(1);
  });

  it('counts nested archives towards the cache size', async () => {
    const outerPath = makeNestedZip();
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const innerSize = statSync(testPath('inner.zip')).size;

    await listArchiveContents('test-bucket', outerPath, '', dummyDownloadFn, head(), {
      nestedArchivePath: 'archives/inner.zip'
    });

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    expect(archiveCacheBytes()).toBe(statSync(outerPath).size + innerSize);
    expect(cachedFileCount()).toBe(2);
  });
});
