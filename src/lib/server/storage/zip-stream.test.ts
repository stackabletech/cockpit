import AdmZip from 'adm-zip';
import { describe, expect, it, vi } from 'vitest';
import { createZipStream, zipStreamSize } from './zip-stream.js';
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
  it('reads objects only on demand and releases the provider on cancellation', async () => {
    const cancel = vi.fn();
    const pull = vi.fn((controller: ReadableStreamDefaultController) =>
      controller.enqueue(new Uint8Array([1]))
    );
    const object = new ReadableStream({ pull, cancel }, { highWaterMark: 0 });
    const getObject = vi.fn(async () => ({ stream: object }));
    const reader = createZipStream({ getObject } as unknown as StorageProvider, [
      { key: 'large.bin', size: 100_000, isDirectory: false }
    ]).getReader();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getObject).not.toHaveBeenCalled();
    await reader.read(); // Local header.
    expect(pull).not.toHaveBeenCalled();
    await reader.read(); // First object chunk.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pull).toHaveBeenCalledTimes(1);
    await reader.cancel();
    expect(cancel).toHaveBeenCalledOnce();
    expect(object.locked).toBe(false);
  });
  it('calculates the exact length of the generated stream', async () => {
    const entries = [{ key: 'file.txt', size: 3, isDirectory: false }];
    const provider = {
      getObject: async () => ({ stream: new Response('abc').body! })
    } as unknown as StorageProvider;

    const stream = createZipStream(provider, entries);
    expect(zipStreamSize(entries)).toBe((await new Response(stream).arrayBuffer()).byteLength);
  });
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
  }, 60_000);
});
