import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { computeZipArchiveSize, createZipStream } from './zip-stream.js';
import type { StorageProvider } from './provider.js';

function objectStream(value: string): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    }
  });
}

describe('createZipStream', () => {
  it('streams readable, uncompressed entries without staging object contents', async () => {
    const objects = new Map([
      ['reports/one.txt', 'first report'],
      ['reports/two.txt', 'second report']
    ]);
    const provider = {
      getObject: async (key: string) => ({ stream: objectStream(objects.get(key) ?? '') })
    } as StorageProvider;

    const archive = new Uint8Array(
      await new Response(
        createZipStream(provider, [
          { key: 'reports/', size: 0, isDirectory: true },
          { key: 'reports/one.txt', size: 12, isDirectory: false },
          { key: 'reports/two.txt', size: 13, isDirectory: false }
        ])
      ).arrayBuffer()
    );
    const zip = new AdmZip(Buffer.from(archive));

    expect(zip.getEntry('reports/')?.isDirectory).toBe(true);
    expect(zip.readAsText('reports/one.txt')).toBe('first report');
    expect(zip.readAsText('reports/two.txt')).toBe('second report');
    expect(zip.getEntry('reports/one.txt')?.header.method).toBe(0);
    expect(
      computeZipArchiveSize([
        { key: 'reports/', size: 0, isDirectory: true },
        { key: 'reports/one.txt', size: 12, isDirectory: false },
        { key: 'reports/two.txt', size: 13, isDirectory: false }
      ])
    ).toBe(archive.length);
  });

  it('uses ZIP64 records when the central directory has 65,535 entries', async () => {
    const provider = {} as StorageProvider;
    const entries = Array.from({ length: 65_535 }, (_, index) => ({
      key: `empty-${index}/`,
      size: 0,
      isDirectory: true
    }));
    const archive = new Uint8Array(
      await new Response(createZipStream(provider, entries)).arrayBuffer()
    );
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const eocdOffset = archive.length - 22;

    expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50);
    expect(view.getUint16(eocdOffset + 8, true)).toBe(0xffff);
    expect(view.getUint32(eocdOffset - 20, true)).toBe(0x07064b50);
    expect(computeZipArchiveSize(entries)).toBe(archive.length);
  }, 30_000);

  it('computes the archive size for a single ZIP64 entry', () => {
    const huge = 2 ** 32;
    expect(computeZipArchiveSize([{ key: 'huge.bin', size: huge, isDirectory: false }])).toBe(
      4_294_967_550
    );
  });
});
