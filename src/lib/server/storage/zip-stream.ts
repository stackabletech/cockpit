import type { StorageProvider } from './provider.js';

const ZIP_VERSION = 20;
const ZIP64_VERSION = 45;
const DATA_DESCRIPTOR_FLAG = 0x08;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_value, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return value >>> 0;
});

export interface ZipEntry {
  key: string;
  size: number;
  isDirectory: boolean;
}

interface CentralDirectoryEntry {
  name: Uint8Array;
  crc32: number;
  size: number;
  offset: number;
  zip64: boolean;
  isDirectory: boolean;
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function uint16(value: number): Uint8Array {
  const result = new Uint8Array(2);
  new DataView(result.buffer).setUint16(0, value, true);
  return result;
}

function uint32(value: number): Uint8Array {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, true);
  return result;
}

function uint64(value: number): Uint8Array {
  const result = new Uint8Array(8);
  const view = new DataView(result.buffer);
  const bigint = BigInt(value);
  view.setUint32(0, Number(bigint & BigInt(UINT32_MAX)), true);
  view.setUint32(4, Number(bigint >> BigInt(32)), true);
  return result;
}

function crc32Update(crc: number, chunk: Uint8Array): number {
  let result = crc ^ UINT32_MAX;
  for (const byte of chunk) {
    result = CRC32_TABLE[(result ^ byte) & 0xff]! ^ (result >>> 8);
  }
  return (result ^ UINT32_MAX) >>> 0;
}

function localHeader(name: Uint8Array, zip64: boolean): Uint8Array {
  const extra = zip64 ? concat(uint16(0x0001), uint16(16), uint64(0), uint64(0)) : new Uint8Array();
  return concat(
    uint32(0x04034b50),
    uint16(zip64 ? ZIP64_VERSION : ZIP_VERSION),
    uint16(DATA_DESCRIPTOR_FLAG | UTF8_FLAG),
    uint16(STORE_METHOD),
    uint16(0),
    uint16(0),
    uint32(0),
    uint32(zip64 ? UINT32_MAX : 0),
    uint32(zip64 ? UINT32_MAX : 0),
    uint16(name.length),
    uint16(extra.length),
    name,
    extra
  );
}

function dataDescriptor(crc32: number, size: number, zip64: boolean): Uint8Array {
  return concat(
    uint32(0x08074b50),
    uint32(crc32),
    zip64 ? uint64(size) : uint32(size),
    zip64 ? uint64(size) : uint32(size)
  );
}

function centralHeader(entry: CentralDirectoryEntry): Uint8Array {
  const zip64Size = entry.size >= UINT32_MAX;
  const zip64Offset = entry.offset >= UINT32_MAX;
  const extraValues = [
    ...(zip64Size ? [uint64(entry.size), uint64(entry.size)] : []),
    ...(zip64Offset ? [uint64(entry.offset)] : [])
  ];
  const extra = extraValues.length
    ? concat(
        uint16(0x0001),
        uint16(extraValues.reduce((size, value) => size + value.length, 0)),
        ...extraValues
      )
    : new Uint8Array();
  return concat(
    uint32(0x02014b50),
    uint16(extra.length ? ZIP64_VERSION : ZIP_VERSION),
    uint16(entry.zip64 ? ZIP64_VERSION : ZIP_VERSION),
    uint16(DATA_DESCRIPTOR_FLAG | UTF8_FLAG),
    uint16(STORE_METHOD),
    uint16(0),
    uint16(0),
    uint32(entry.crc32),
    uint32(zip64Size ? UINT32_MAX : entry.size),
    uint32(zip64Size ? UINT32_MAX : entry.size),
    uint16(entry.name.length),
    uint16(extra.length),
    uint16(0),
    uint16(0),
    uint16(0),
    uint32(entry.isDirectory ? 0x10 : 0),
    uint32(zip64Offset ? UINT32_MAX : entry.offset),
    entry.name,
    extra
  );
}

function endOfCentralDirectory(count: number, size: number, offset: number): Uint8Array {
  const zip64 = count >= UINT16_MAX || size >= UINT32_MAX || offset >= UINT32_MAX;
  if (!zip64) {
    return concat(
      uint32(0x06054b50),
      uint16(0),
      uint16(0),
      uint16(count),
      uint16(count),
      uint32(size),
      uint32(offset),
      uint16(0)
    );
  }
  const zip64Offset = offset + size;
  return concat(
    uint32(0x06064b50),
    uint64(44),
    uint16(ZIP64_VERSION),
    uint16(ZIP64_VERSION),
    uint32(0),
    uint32(0),
    uint64(count),
    uint64(count),
    uint64(size),
    uint64(offset),
    uint32(0x07064b50),
    uint32(0),
    uint64(zip64Offset),
    uint32(1),
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(UINT16_MAX),
    uint16(UINT16_MAX),
    uint32(UINT32_MAX),
    uint32(UINT32_MAX),
    uint16(0)
  );
}

function entryName(entry: ZipEntry): Uint8Array {
  return bytes(entry.isDirectory && !entry.key.endsWith('/') ? `${entry.key}/` : entry.key);
}

/**
 * Computes the exact byte length of the archive that `createZipStream` emits
 * for the given entries. It mirrors the encoder's zip64 decisions exactly, so
 * the result can be used as a `Content-Length` header before the stream is
 * consumed. The archive uses the STORE method and data descriptors, so the
 * total only depends on the entry sizes and names.
 */
export function computeZipArchiveSize(entries: ZipEntry[]): number {
  let offset = 0;
  let total = 0;
  const central: Array<{ nameLength: number; size: number; offset: number }> = [];
  for (const entry of entries) {
    const nameLength = entryName(entry).length;
    const sizeZip64 = entry.size >= UINT32_MAX;
    const localLength = 30 + nameLength + (sizeZip64 ? 20 : 0);
    const descriptorLength = sizeZip64 ? 24 : 16;
    central.push({ nameLength, size: entry.size, offset });
    offset += localLength + entry.size + descriptorLength;
    total += localLength + entry.size + descriptorLength;
  }
  const centralOffset = offset;
  for (const entry of central) {
    const zip64Size = entry.size >= UINT32_MAX;
    const zip64Offset = entry.offset >= UINT32_MAX;
    const extraLength =
      zip64Size || zip64Offset ? 4 + (zip64Size ? 16 : 0) + (zip64Offset ? 8 : 0) : 0;
    const headerLength = 46 + entry.nameLength + extraLength;
    offset += headerLength;
    total += headerLength;
  }
  const size = offset - centralOffset;
  const count = entries.length;
  const zip64 = count >= UINT16_MAX || size >= UINT32_MAX || centralOffset >= UINT32_MAX;
  total += zip64 ? 98 : 22;
  return total;
}
/**
 * Creates a standards-compliant, uncompressed ZIP stream. Object bytes are
 * forwarded directly from the provider; only central-directory metadata stays
 * in memory.
 */
export function createZipStream(provider: StorageProvider, entries: ZipEntry[]): ReadableStream {
  let cancelled = false;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  return new ReadableStream({
    async start(controller) {
      let offset = 0;
      const centralEntries: CentralDirectoryEntry[] = [];
      try {
        for (const entry of entries) {
          if (cancelled) return;
          const name = entryName(entry);
          if (name.length > UINT16_MAX) throw new Error('Archive entry name is too long');
          const sizeZip64 = entry.size >= UINT32_MAX;
          controller.enqueue(localHeader(name, sizeZip64));
          const localOffset = offset;
          offset += 30 + name.length + (sizeZip64 ? 20 : 0);

          let crc32 = 0;
          let actualSize = 0;
          if (!entry.isDirectory) {
            const download = await provider.getObject(entry.key);
            activeReader = download.stream.getReader();
            while (!cancelled) {
              const { done, value } = await activeReader.read();
              if (done) break;
              crc32 = crc32Update(crc32, value);
              actualSize += value.length;
              offset += value.length;
              controller.enqueue(value);
            }
            activeReader.releaseLock();
            activeReader = undefined;
          }
          if (cancelled) return;
          if (actualSize !== entry.size) {
            throw new Error(`Object size changed while creating archive: ${entry.key}`);
          }
          const entryZip64 = sizeZip64 || actualSize >= UINT32_MAX;
          const descriptor = dataDescriptor(crc32, actualSize, entryZip64);
          controller.enqueue(descriptor);
          offset += descriptor.length;
          centralEntries.push({
            name,
            crc32,
            size: actualSize,
            offset: localOffset,
            zip64: entryZip64,
            isDirectory: entry.isDirectory
          });
        }

        const centralOffset = offset;
        for (const entry of centralEntries) {
          const header = centralHeader(entry);
          controller.enqueue(header);
          offset += header.length;
        }
        controller.enqueue(
          endOfCentralDirectory(centralEntries.length, offset - centralOffset, centralOffset)
        );
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      cancelled = true;
      await activeReader?.cancel();
    }
  });
}
