import {
  createReadStream,
  createWriteStream,
  unlinkSync,
  existsSync,
  mkdtempSync,
  writeFileSync,
  rmSync
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { createGunzip } from 'node:zlib';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';
import * as tar from 'tar-stream';
import { Readable } from 'node:stream';
import { logger } from '$lib/server/logging';

const log = logger.child({ module: 'archive-service' });

const execAsync = promisify(exec);

export interface ArchiveEntry {
  key: string;
  size: number;
  lastModified: Date;
  isDirectory: boolean;
}

export interface ArchiveListing {
  entries: ArchiveEntry[];
  hasMore: boolean;
  /** When true, the archive exceeded the previewable size limit. */
  tooLarge?: boolean;
}

const CACHE_TTL = 30 * 60 * 1000;
const CLEANUP_INTERVAL = 60_000;

interface CacheEntry {
  path: string;
  expiresAt: number;
  bucket: string;
  key: string;
}

const archiveCache = new Map<string, CacheEntry>();

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [cacheKey, entry] of archiveCache) {
    if (now > entry.expiresAt) {
      try {
        if (existsSync(entry.path)) unlinkSync(entry.path);
      } catch (err) {
        log.warn({ err, cache_key: cacheKey }, 'failed to clean up archive temp file');
      }
      archiveCache.delete(cacheKey);
    }
  }
}, CLEANUP_INTERVAL);

if (cleanupTimer.unref) cleanupTimer.unref();

function cacheKey(bucket: string, key: string): string {
  return `${bucket}:${key}`;
}

function getCachedPath(bucket: string, key: string): string | null {
  const entry = archiveCache.get(cacheKey(bucket, key));
  if (entry && Date.now() < entry.expiresAt && existsSync(entry.path)) {
    return entry.path;
  }
  if (entry) archiveCache.delete(cacheKey(bucket, key));
  return null;
}

function cacheArchive(bucket: string, key: string, path: string): void {
  archiveCache.set(cacheKey(bucket, key), { path, expiresAt: Date.now() + CACHE_TTL, bucket, key });
}

function streamToTempFile(stream: ReadableStream, ext: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'archive-'));
    const tmpPath = join(tmpDir, `archive${ext}`);
    const writable = createWriteStream(tmpPath);
    const nodeStream = Readable.fromWeb(stream as import('stream/web').ReadableStream);
    nodeStream.pipe(writable);
    nodeStream.on('error', (err) => {
      writable.destroy();
      try {
        unlinkSync(tmpPath);
      } catch {
        /* noop */
      }
      reject(err);
    });
    writable.on('finish', () => resolve(tmpPath));
    writable.on('error', (err) => {
      try {
        unlinkSync(tmpPath);
      } catch {
        /* noop */
      }
      reject(err);
    });
  });
}

const ARCHIVE_EXT_PATTERNS = [
  { ext: '.zip', formats: ['zip'] as const },
  { ext: '.tar.gz', formats: ['tar.gz', 'tgz'] as const },
  { ext: '.tar', formats: ['tar'] as const },
  { ext: '.rar', formats: ['rar'] as const },
  { ext: '.7z', formats: ['7z'] as const }
];

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function ensureTrailingSlash(p: string): string {
  return p.endsWith('/') ? p : p + '/';
}

export function getArchiveFormat(key: string): string | null {
  const lower = key.toLowerCase();
  for (const { formats } of ARCHIVE_EXT_PATTERNS) {
    for (const fmt of formats) {
      if (lower.endsWith(`.${fmt}`)) return fmt;
    }
  }
  return null;
}

// ── ZIP ──────────────────────────────────────────────────────────────────────

function listZip(tempPath: string, internalPrefix: string, maxBytes?: number): ArchiveListing {
  const zip = new AdmZip(tempPath);
  const prefix = internalPrefix ? ensureTrailingSlash(normalizePath(internalPrefix)) : '';
  const entries = zip.getEntries();

  const seenDirs = new Set<string>();
  const result: ArchiveEntry[] = [];
  let totalDecompressed = 0;

  for (const entry of entries) {
    const entryPath = normalizePath(entry.entryName);

    if (!entryPath.startsWith(prefix)) continue;

    if (!entry.isDirectory) {
      if (maxBytes !== undefined) {
        totalDecompressed += entry.header.size;
        if (totalDecompressed > maxBytes) {
          return { entries: [], hasMore: false, tooLarge: true };
        }
      }
    }

    const relative = entryPath.slice(prefix.length);
    if (!relative) continue;

    if (entry.isDirectory) {
      if (!relative.includes('/') && !seenDirs.has(relative)) {
        seenDirs.add(relative);
        result.push({
          key: relative,
          size: 0,
          lastModified: new Date(entry.header.time),
          isDirectory: true
        });
      }
    } else {
      if (relative.includes('/')) {
        const dirName = relative.split('/')[0] + '/';
        if (!seenDirs.has(dirName)) {
          seenDirs.add(dirName);
          result.push({
            key: dirName,
            size: 0,
            lastModified: new Date(entry.header.time),
            isDirectory: true
          });
        }
      } else {
        result.push({
          key: relative,
          size: entry.header.size,
          lastModified: new Date(entry.header.time),
          isDirectory: false
        });
      }
    }
  }

  return { entries: result, hasMore: false };
}

function extractZipEntry(tempPath: string, internalPath: string): Buffer | null {
  const zip = new AdmZip(tempPath);
  const entry = zip.getEntry(internalPath);
  if (!entry || entry.isDirectory) return null;
  return entry.getData();
}

// ── TAR helpers (shared by plain .tar and .tar.gz) ────────────────────────────

interface TarListState {
  entries: ArchiveEntry[];
  seenDirs: Set<string>;
  totalDecompressed: number;
  tooLarge: boolean;
}

function onTarEntry(
  header: tar.Headers,
  stream: NodeJS.ReadableStream,
  next: (err?: Error | null) => void,
  prefix: string,
  state: TarListState,
  maxBytes?: number
): void {
  let entryPath = normalizePath(header.name);

  if (header.type === 'directory') {
    entryPath = ensureTrailingSlash(entryPath);
  }

  if (state.tooLarge) {
    stream.resume();
    stream.on('end', next);
    return;
  }

  if (!entryPath.startsWith(prefix)) {
    stream.resume();
    stream.on('end', next);
    return;
  }

  const relative = entryPath.slice(prefix.length);
  if (!relative) {
    stream.resume();
    stream.on('end', next);
    return;
  }

  if (header.type !== 'directory' && header.size && maxBytes !== undefined) {
    state.totalDecompressed += header.size;
    if (state.totalDecompressed > maxBytes) {
      state.tooLarge = true;
      stream.resume();
      stream.on('end', next);
      return;
    }
  }

  if (header.type === 'directory') {
    if (!relative.includes('/') && !state.seenDirs.has(relative)) {
      state.seenDirs.add(relative);
      state.entries.push({
        key: relative,
        size: 0,
        lastModified: new Date(header.mtime?.getTime() ?? 0),
        isDirectory: true
      });
    }
  } else {
    if (relative.includes('/')) {
      const dirName = relative.split('/')[0] + '/';
      if (!state.seenDirs.has(dirName)) {
        state.seenDirs.add(dirName);
        state.entries.push({
          key: dirName,
          size: 0,
          lastModified: new Date(0),
          isDirectory: true
        });
      }
    } else {
      state.entries.push({
        key: relative,
        size: header.size ?? 0,
        lastModified: new Date(header.mtime?.getTime() ?? 0),
        isDirectory: false
      });
    }
  }

  stream.resume();
  stream.on('end', next);
}

// ── TAR ───────────────────────────────────────────────────────────────────────

function listTar(
  tempPath: string,
  internalPrefix: string,
  maxBytes?: number
): Promise<ArchiveListing> {
  return new Promise((resolve, reject) => {
    const prefix = internalPrefix ? ensureTrailingSlash(normalizePath(internalPrefix)) : '';
    const state: TarListState = {
      entries: [],
      seenDirs: new Set(),
      totalDecompressed: 0,
      tooLarge: false
    };

    const extract = tar.extract();

    extract.on(
      'entry',
      (header: tar.Headers, stream: NodeJS.ReadableStream, next: (err?: Error | null) => void) => {
        onTarEntry(header, stream, next, prefix, state, maxBytes);
      }
    );

    extract.on('finish', () => {
      if (state.tooLarge) {
        resolve({ entries: [], hasMore: false, tooLarge: true });
      } else {
        resolve({ entries: state.entries, hasMore: false });
      }
    });
    extract.on('error', reject);

    createReadStream(tempPath).pipe(extract);
  });
}

function extractTarEntry(tempPath: string, internalPath: string): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const normalized = normalizePath(internalPath);
    let found: Buffer | null = null;

    const extract = tar.extract();

    extract.on(
      'entry',
      (header: tar.Headers, stream: NodeJS.ReadableStream, next: (err?: Error | null) => void) => {
        const entryPath = normalizePath(header.name);
        if (header.type === 'file' && entryPath === normalized && !found) {
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            found = Buffer.concat(chunks);
            next();
          });
        } else {
          stream.resume();
          stream.on('end', next);
        }
      }
    );

    extract.on('finish', () => resolve(found));
    extract.on('error', reject);

    createReadStream(tempPath).pipe(extract);
  });
}

// ── TAR.GZ / TGZ ─────────────────────────────────────────────────────────────

function listTarGz(
  tempPath: string,
  internalPrefix: string,
  maxBytes?: number
): Promise<ArchiveListing> {
  return new Promise((resolve, reject) => {
    const prefix = internalPrefix ? ensureTrailingSlash(normalizePath(internalPrefix)) : '';
    const state: TarListState = {
      entries: [],
      seenDirs: new Set(),
      totalDecompressed: 0,
      tooLarge: false
    };

    const extract = tar.extract();
    const gunzip = createGunzip();

    extract.on(
      'entry',
      (header: tar.Headers, stream: NodeJS.ReadableStream, next: (err?: Error | null) => void) => {
        onTarEntry(header, stream, next, prefix, state, maxBytes);
      }
    );

    extract.on('finish', () => {
      if (state.tooLarge) {
        resolve({ entries: [], hasMore: false, tooLarge: true });
      } else {
        resolve({ entries: state.entries, hasMore: false });
      }
    });
    extract.on('error', reject);
    gunzip.on('error', reject);

    createReadStream(tempPath).pipe(gunzip).pipe(extract);
  });
}

function extractTarGzEntry(tempPath: string, internalPath: string): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const normalized = normalizePath(internalPath);
    let found: Buffer | null = null;

    const extract = tar.extract();
    const gunzip = createGunzip();

    extract.on(
      'entry',
      (header: tar.Headers, stream: NodeJS.ReadableStream, next: (err?: Error | null) => void) => {
        const entryPath = normalizePath(header.name);
        if (header.type === 'file' && entryPath === normalized && !found) {
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            found = Buffer.concat(chunks);
            next();
          });
        } else {
          stream.resume();
          stream.on('end', next);
        }
      }
    );

    extract.on('finish', () => resolve(found));
    extract.on('error', reject);
    gunzip.on('error', reject);

    createReadStream(tempPath).pipe(gunzip).pipe(extract);
  });
}

// ── RAR ──────────────────────────────────────────────────────────────────────

async function listRar(tempPath: string, internalPrefix: string): Promise<ArchiveListing> {
  const prefix = internalPrefix ? ensureTrailingSlash(normalizePath(internalPrefix)) : '';

  try {
    const { stdout } = await execAsync(`unrar lb "${tempPath}"`, { timeout: 30000 });
    const allEntries = stdout
      .split('\n')
      .map((l) => normalizePath(l.trim()))
      .filter(Boolean);

    const seenDirs = new Set<string>();
    const entries: ArchiveEntry[] = [];

    for (const entryPath of allEntries) {
      const isDir = entryPath.endsWith('/');
      const path = isDir ? entryPath : entryPath;

      if (!path.startsWith(prefix)) continue;
      const relative = path.slice(prefix.length);
      if (!relative) continue;

      if (isDir) {
        if (!relative.includes('/') && !seenDirs.has(relative)) {
          seenDirs.add(relative);
          entries.push({
            key: relative,
            size: 0,
            lastModified: new Date(0),
            isDirectory: true
          });
        }
      } else {
        if (relative.includes('/')) {
          const dirName = relative.split('/')[0] + '/';
          if (!seenDirs.has(dirName)) {
            seenDirs.add(dirName);
            entries.push({ key: dirName, size: 0, lastModified: new Date(0), isDirectory: true });
          }
        } else {
          entries.push({
            key: relative,
            size: 0,
            lastModified: new Date(0),
            isDirectory: false
          });
        }
      }
    }

    return { entries, hasMore: false };
  } catch (err) {
    throw new Error(
      'RAR support requires the "unrar" command to be installed on the server. ' +
        (err instanceof Error ? err.message : String(err))
    );
  }
}

async function extractRarEntry(tempPath: string, internalPath: string): Promise<Buffer | null> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'rar-extract-'));
  try {
    const { stdout } = await execAsync(`unrar p -inul "${tempPath}" "${internalPath}"`, {
      timeout: 30000,
      maxBuffer: 100 * 1024 * 1024
    });
    if (!stdout) return null;
    return Buffer.from(stdout, 'binary');
  } catch (err) {
    throw new Error('RAR extraction failed: ' + (err instanceof Error ? err.message : String(err)));
  } finally {
    try {
      unlinkSync(tmpDir);
    } catch {
      /* noop */
    }
  }
}

// ── 7z ───────────────────────────────────────────────────────────────────────

const SEVEN_ZIP_BINARIES = ['7zz', '7zr', '7z'];

async function find7zBinary(): Promise<string | null> {
  for (const bin of SEVEN_ZIP_BINARIES) {
    try {
      await execAsync(`which ${bin}`, { timeout: 5000 });
      return bin;
    } catch {
      /* noop */
    }
  }
  return null;
}

async function list7z(
  tempPath: string,
  internalPrefix: string,
  maxBytes?: number
): Promise<ArchiveListing> {
  const bin = await find7zBinary();
  if (!bin) throw new Error('7z support requires 7-Zip to be installed on the server.');

  const prefix = internalPrefix ? ensureTrailingSlash(normalizePath(internalPrefix)) : '';

  try {
    const { stdout } = await execAsync(`"${bin}" l -slt -ba "${tempPath}"`, { timeout: 30000 });
    return parse7zListing(stdout, prefix, maxBytes);
  } catch (err) {
    throw new Error('7z listing failed: ' + (err instanceof Error ? err.message : String(err)));
  }
}

function parse7zListing(stdout: string, prefix: string, maxBytes?: number): ArchiveListing {
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const entries: ArchiveEntry[] = [];
  const seenDirs = new Set<string>();
  let currentPath = '';
  let currentSize = 0;
  let isDir = false;
  let totalDecompressed = 0;

  for (const line of lines) {
    if (line.startsWith('Path = ')) {
      const path = normalizePath(line.slice(6).trim());
      if (currentPath && currentPath.startsWith(prefix)) {
        const relative = currentPath.slice(prefix.length);
        if (relative) {
          if (isDir && !relative.includes('/') && !seenDirs.has(ensureTrailingSlash(relative))) {
            seenDirs.add(ensureTrailingSlash(relative));
            entries.push({
              key: ensureTrailingSlash(relative),
              size: 0,
              lastModified: new Date(0),
              isDirectory: true
            });
          } else if (!isDir) {
            if (maxBytes !== undefined) {
              totalDecompressed += currentSize;
              if (totalDecompressed > maxBytes) {
                return { entries: [], hasMore: false, tooLarge: true };
              }
            }
            if (relative.includes('/')) {
              const dirName = relative.split('/')[0] + '/';
              if (!seenDirs.has(dirName)) {
                seenDirs.add(dirName);
                entries.push({
                  key: dirName,
                  size: 0,
                  lastModified: new Date(0),
                  isDirectory: true
                });
              }
            } else {
              entries.push({
                key: relative,
                size: currentSize,
                lastModified: new Date(0),
                isDirectory: false
              });
            }
          }
        }
      }
      currentPath = path;
      currentSize = 0;
      isDir = false;
    } else if (line.startsWith('Size = ')) {
      currentSize = parseInt(line.slice(6).trim(), 10) || 0;
    } else if (line.startsWith('Folder = ')) {
      isDir = line.slice(8).trim() === '+';
    }
  }

  if (currentPath && currentPath.startsWith(prefix)) {
    const relative = currentPath.slice(prefix.length);
    if (relative) {
      if (isDir && !relative.includes('/') && !seenDirs.has(ensureTrailingSlash(relative))) {
        entries.push({
          key: ensureTrailingSlash(relative),
          size: 0,
          lastModified: new Date(0),
          isDirectory: true
        });
      } else if (!isDir) {
        entries.push({
          key: relative,
          size: currentSize,
          lastModified: new Date(0),
          isDirectory: false
        });
      }
    }
  }

  return { entries, hasMore: false };
}

async function extract7zEntry(tempPath: string, internalPath: string): Promise<Buffer | null> {
  const bin = await find7zBinary();
  if (!bin) throw new Error('7z support requires 7-Zip to be installed on the server.');

  const tmpDir = mkdtempSync(join(tmpdir(), '7z-extract-'));
  try {
    await execAsync(`"${bin}" x -y -o"${tmpDir}" "${tempPath}" "${internalPath}"`, {
      timeout: 60000
    });
    const outPath = join(tmpDir, internalPath);
    if (!existsSync(outPath)) return null;
    return readFile(outPath);
  } catch (err) {
    throw new Error('7z extraction failed: ' + (err instanceof Error ? err.message : String(err)));
  } finally {
    try {
      rmRecursive(tmpDir);
    } catch {
      /* noop */
    }
  }
}

function rmRecursive(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// ── Public API ───────────────────────────────────────────────────────────────

export type ArchiveDownloadFn = (key: string) => Promise<ReadableStream>;
export type ArchiveMetadataFn = (key: string) => Promise<{ size: number; contentType?: string }>;

/**
 * Resolve the archive file to a local temp path.
 * For nested archives, first download the outer archive, then extract the nested one.
 */
async function resolveArchivePath(
  bucket: string,
  key: string,
  nestedArchivePath: string | undefined,
  downloadFn: ArchiveDownloadFn
): Promise<string> {
  let tempPath = getCachedPath(bucket, key);
  if (!tempPath) {
    log.info({ bucket, key }, 'downloading archive');
    const ext = extname(key) || '.bin';
    const stream = await downloadFn(key);
    tempPath = await streamToTempFile(stream, ext);
    cacheArchive(bucket, key, tempPath);
  }

  if (!nestedArchivePath) return tempPath;

  // Resolve nested archive — cache it under a composite key
  const nestedCacheKey = cacheKey(bucket, `${key}!/${nestedArchivePath}`);
  const cachedEntry = archiveCache.get(nestedCacheKey);
  if (cachedEntry && Date.now() < cachedEntry.expiresAt && existsSync(cachedEntry.path)) {
    return cachedEntry.path;
  }
  if (cachedEntry) archiveCache.delete(nestedCacheKey);

  log.info({ bucket, key, nested_archive_path: nestedArchivePath }, 'extracting nested archive');

  // Extract nested archive from outer archive
  const format = getArchiveFormat(key);
  if (!format) throw new Error(`Unsupported archive format: ${key}`);

  let nestedData: Buffer | null = null;
  const normNestedPath = normalizePath(nestedArchivePath);

  switch (format) {
    case 'zip':
      nestedData = extractZipEntry(tempPath, normNestedPath) ?? null;
      break;
    case 'tar':
      nestedData = await extractTarEntry(tempPath, normNestedPath);
      break;
    case 'tar.gz':
    case 'tgz':
      nestedData = await extractTarGzEntry(tempPath, normNestedPath);
      break;
    case 'rar':
      nestedData = await extractRarEntry(tempPath, normNestedPath);
      break;
    case '7z':
      nestedData = await extract7zEntry(tempPath, normNestedPath);
      break;
  }

  if (!nestedData) throw new Error(`Nested archive "${nestedArchivePath}" not found in ${key}`);

  // Save nested archive to temp file and cache it
  const nestedExt = extname(nestedArchivePath) || '.bin';
  const nestedDir = mkdtempSync(join(tmpdir(), 'archive-nested-'));
  const nestedPath = join(nestedDir, `archive${nestedExt}`);

  writeFileSync(nestedPath, nestedData);

  archiveCache.set(nestedCacheKey, {
    path: nestedPath,
    expiresAt: Date.now() + CACHE_TTL,
    bucket,
    key: `${key}!/${nestedArchivePath}`
  });

  return nestedPath;
}

/**
 * List the contents of an archive at a given internal prefix.
 * Downloads the archive from S3 once and caches it server-side for 30 minutes.
 * Supports nested archives via the optional `nestedArchivePath` parameter.
 */
export async function listArchiveContents(
  bucket: string,
  key: string,
  internalPrefix: string,
  downloadFn: ArchiveDownloadFn,
  metadataFn: ArchiveMetadataFn,
  nestedArchivePath?: string,
  maxBytes?: number
): Promise<ArchiveListing> {
  const effectiveKey = nestedArchivePath ? `${key}!/${nestedArchivePath}` : key;
  const format = getArchiveFormat(effectiveKey);
  if (!format) throw new Error(`Unsupported archive format: ${key}`);

  // Pre-check: if compressed size exceeds the limit, bail out before downloading
  if (maxBytes !== undefined && !nestedArchivePath) {
    try {
      const meta = await metadataFn(key);
      if (meta.size > maxBytes) {
        log.info(
          { bucket, key, compressed_size: meta.size, max_bytes: maxBytes },
          'archive compressed size exceeds limit'
        );
        return { entries: [], hasMore: false, tooLarge: true };
      }
    } catch {
      // metadataFn failure is non-fatal — proceed with download
    }
  }

  const tempPath = await resolveArchivePath(bucket, key, nestedArchivePath, downloadFn);

  log.debug(
    {
      bucket,
      key,
      internal_prefix: internalPrefix,
      nested_archive_path: nestedArchivePath,
      format
    },
    'listing archive contents'
  );

  switch (format) {
    case 'zip':
      return listZip(tempPath, internalPrefix, maxBytes);
    case 'tar':
      return listTar(tempPath, internalPrefix, maxBytes);
    case 'tar.gz':
    case 'tgz':
      return listTarGz(tempPath, internalPrefix, maxBytes);
    case 'rar':
      return listRar(tempPath, internalPrefix);
    case '7z':
      return list7z(tempPath, internalPrefix, maxBytes);
    default:
      throw new Error(`Unsupported archive format: ${format}`);
  }
}

/**
 * Extract a single file from an archive and return its content as a Buffer.
 * Supports nested archives via the optional `nestedArchivePath` parameter.
 */
export async function extractArchiveEntry(
  bucket: string,
  key: string,
  internalPath: string,
  downloadFn: ArchiveDownloadFn,
  metadataFn: ArchiveMetadataFn,
  nestedArchivePath?: string,
  maxBytes?: number
): Promise<Buffer | null> {
  const effectiveKey = nestedArchivePath ? `${key}!/${nestedArchivePath}` : key;
  const format = getArchiveFormat(effectiveKey);
  if (!format) throw new Error(`Unsupported archive format: ${key}`);

  // Pre-check: if compressed size exceeds the limit, bail out before downloading
  if (maxBytes !== undefined && !nestedArchivePath) {
    try {
      const meta = await metadataFn(key);
      if (meta.size > maxBytes) {
        log.info(
          { bucket, key, compressed_size: meta.size, max_bytes: maxBytes },
          'archive compressed size exceeds limit, extraction aborted'
        );
        return null;
      }
    } catch {
      // metadataFn failure is non-fatal
    }
  }

  const tempPath = await resolveArchivePath(bucket, key, nestedArchivePath, downloadFn);

  log.debug(
    { bucket, key, internal_path: internalPath, nested_archive_path: nestedArchivePath, format },
    'extracting archive entry'
  );

  const normalizedPath = normalizePath(internalPath);

  let data: Buffer | null = null;
  switch (format) {
    case 'zip':
      data = extractZipEntry(tempPath, normalizedPath) ?? null;
      break;
    case 'tar':
      data = await extractTarEntry(tempPath, normalizedPath);
      break;
    case 'tar.gz':
    case 'tgz':
      data = await extractTarGzEntry(tempPath, normalizedPath);
      break;
    case 'rar':
      data = await extractRarEntry(tempPath, normalizedPath);
      break;
    case '7z':
      data = await extract7zEntry(tempPath, normalizedPath);
      break;
    default:
      return null;
  }

  // Post-extraction size check
  if (data && maxBytes !== undefined && data.length > maxBytes) {
    log.info(
      {
        bucket,
        key,
        internal_path: internalPath,
        extracted_size: data.length,
        max_bytes: maxBytes
      },
      'extracted entry size exceeds limit'
    );
    return null;
  }

  return data;
}

/**
 * Clean up all cached archive temp files. Useful for testing.
 */
export function clearArchiveCache(): void {
  for (const [cacheKey, entry] of archiveCache) {
    try {
      if (existsSync(entry.path)) unlinkSync(entry.path);
    } catch {
      /* noop */
    }
    archiveCache.delete(cacheKey);
  }
}
