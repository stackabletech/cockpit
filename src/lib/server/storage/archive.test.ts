import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { readFileSync, unlinkSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';
import * as tar from 'tar-stream';
import { createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';

vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn() }) }
}));

import {
  getArchiveFormat,
  listArchiveContents,
  extractArchiveEntry,
  clearArchiveCache,
  type ArchiveDownloadFn
} from './archive.js';

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

const dummyDownloadFn: ArchiveDownloadFn = (key: string) => {
  const buf = readFileSync(key);
  return Promise.resolve(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(buf));
        controller.close();
      }
    })
  );
};

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

  it('detects .rar', () => {
    expect(getArchiveFormat('archive.rar')).toBe('rar');
  });

  it('detects .7z', () => {
    expect(getArchiveFormat('archive.7z')).toBe('7z');
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
        if (existsSync(p)) unlinkSync(p);
      } catch {}
    }
    try {
      if (existsSync(testDir)) unlinkSync(testDir);
    } catch {}
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

      const listing = await listArchiveContents('test-bucket', path, '', dummyDownloadFn, vi.fn());

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
        vi.fn()
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
        vi.fn()
      );

      const dirs = listing.entries.filter((e) => e.isDirectory).map((e) => e.key);
      const files = listing.entries.filter((e) => !e.isDirectory).map((e) => e.key);

      expect(dirs).toEqual(['beta/']);
      expect(files).toEqual(['surface.txt']);
    });

    it('handles empty archive', async () => {
      const path = testPath('empty.zip');
      makeZip(path, {});

      const listing = await listArchiveContents('test-bucket', path, '', dummyDownloadFn, vi.fn());

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
        vi.fn()
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

      const listing = await listArchiveContents('test-bucket', path, '', dummyDownloadFn, vi.fn());

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
        vi.fn()
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

      const listing = await listArchiveContents('test-bucket', path, '', dummyDownloadFn, vi.fn());

      const dirs = listing.entries.filter((e) => e.isDirectory).map((e) => e.key);
      const files = listing.entries.filter((e) => !e.isDirectory).map((e) => e.key);

      expect(dirs).toEqual(['data/']);
      expect(files).toEqual(['summary.txt']);
    });
  });

  describe('Nested archives', () => {
    it('lists contents of a nested zip inside outer zip', async () => {
      const outerPath = makeNestedZip();

      const listing = await listArchiveContents(
        'test-bucket',
        outerPath,
        '',
        dummyDownloadFn,
        vi.fn(),
        'archives/inner.zip'
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

  it('extracts a file from a ZIP', async () => {
    const path = testPath('extract.zip');
    makeZip(path, { 'hello.txt': 'Hello, World!' });

    const buf = await extractArchiveEntry(
      'test-bucket',
      path,
      'hello.txt',
      dummyDownloadFn,
      vi.fn()
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
      vi.fn()
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
      vi.fn()
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
      vi.fn()
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
      vi.fn(),
      'archives/inner.zip'
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

    const first = await listArchiveContents('test-bucket', path, '', downloadSpy, vi.fn());
    expect(first.entries).toHaveLength(1);
    expect(downloadSpy).toHaveBeenCalledTimes(1);

    const second = await listArchiveContents('test-bucket', path, '', downloadSpy, vi.fn());
    expect(second.entries).toHaveLength(1);
    // downloadFn should NOT be called again — result comes from cache
    expect(downloadSpy).toHaveBeenCalledTimes(1);

    clearArchiveCache();
  });
});
