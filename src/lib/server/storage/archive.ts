import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { threadId } from 'node:worker_threads';
import { createGunzip } from 'node:zlib';
import AdmZip from 'adm-zip';
import * as tar from 'tar-stream';
import { logger } from '$lib/server/logging';
import { archiveCacheMaxBytes } from '$lib/server/feature-flags.js';
import {
  storageArchiveCacheBytes,
  storageArchiveCacheEvictionsTotal
} from '$lib/server/metrics.js';

const log = logger.child({ module: 'archive-service' });

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

/** Thrown when an archive does not fit into the cache because every cached
 *  archive is in use. Callers should answer with 503. */
export class ArchiveCacheFullError extends Error {
  constructor() {
    super('Archive preview cache is full');
    this.name = 'ArchiveCacheFullError';
  }
}

/** Thrown when an archive exceeds the preview size limit while downloading. */
class ArchiveTooLargeError extends Error {
  constructor(limit: number) {
    super(`Archive exceeds the preview size limit of ${limit} bytes`);
    this.name = 'ArchiveTooLargeError';
  }
}

// ── Disk cache ───────────────────────────────────────────────────────────────
//
// Archives are downloaded to `<tmpdir>/cockpit-archive-cache/<pid>.<thread>-*/`
// and kept for CACHE_TTL. The total size is capped at `archiveCacheMaxBytes`:
// space is reserved before a download starts, and the least recently used idle
// archive is evicted to make room. Readers hold a lease on an entry, and leased
// entries are never deleted. Concurrent requests for the same archive share one
// download, which is aborted once every waiting request has gone away.

const CACHE_TTL = 30 * 60 * 1000;
const CLEANUP_INTERVAL = 60_000;
const CACHE_ROOT = join(tmpdir(), 'cockpit-archive-cache');

interface CacheEntry {
  dir: string;
  path: string;
  size: number;
  expiresAt: number;
  lastUsed: number;
  leases: number;
  /** Replaced by a newer entry for the same key; removed once no longer leased. */
  superseded: boolean;
  removed: boolean;
}

interface ArchiveLease {
  path: string;
  release(): void;
}

interface InflightJob {
  promise: Promise<void>;
  waiters: number;
  controller: AbortController;
}

const archiveCache = new Map<string, CacheEntry>();
const inflight = new Map<string, InflightJob>();
let cachedBytes = 0;
let reservedBytes = 0;
let processCacheDir: string | null = null;

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of archiveCache) {
    if (now > entry.expiresAt && entry.leases === 0) removeEntry(key, entry, 'expired');
  }
}, CLEANUP_INTERVAL);

if (cleanupTimer.unref) cleanupTimer.unref();

function cacheKey(connectionId: string, bucket: string, key: string): string {
  return `${connectionId}:${bucket}:${key}`;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Remove cache directories left behind by earlier processes. `/tmp` is an
 * emptyDir that survives container restarts, and the restarted process often
 * gets the same PID, so directories of this PID and thread are stale as well.
 */
function removeStaleCacheDirs(): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  for (const name of readdirSync(CACHE_ROOT)) {
    const match = /^(\d+)\.(\d+)-/.exec(name);
    if (match) {
      const pid = Number(match[1]);
      const ownProcess = pid === process.pid;
      if (ownProcess && Number(match[2]) !== threadId) continue;
      if (!ownProcess && isProcessAlive(pid)) continue;
    }
    try {
      rmRecursive(join(CACHE_ROOT, name));
      log.info({ dir: name }, 'removed stale archive cache directory');
    } catch (err) {
      log.warn({ err, dir: name }, 'failed to remove stale archive cache directory');
    }
  }
}

function cacheDir(): string {
  if (!processCacheDir) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    mkdirSync(CACHE_ROOT, { recursive: true });
    removeStaleCacheDirs();
    processCacheDir = mkdtempSync(join(CACHE_ROOT, `${process.pid}.${threadId}-`));
  }
  return processCacheDir;
}

function updateCacheGauge(): void {
  storageArchiveCacheBytes.set(cachedBytes);
}

function removeEntry(key: string, entry: CacheEntry, reason: 'expired' | 'evicted' | 'missing') {
  if (entry.removed) return;
  entry.removed = true;
  if (archiveCache.get(key) === entry) archiveCache.delete(key);
  cachedBytes -= entry.size;
  updateCacheGauge();
  storageArchiveCacheEvictionsTotal.inc({ reason });
  log.debug({ cache_key: key, size: entry.size, reason }, 'removing cached archive');
  try {
    rmRecursive(entry.dir);
  } catch (err) {
    log.warn({ err, cache_key: key }, 'failed to clean up archive temp file');
  }
}

/** Lease a cached archive so it is not deleted while it is being read. */
function acquire(key: string): ArchiveLease | null {
  const entry = archiveCache.get(key);
  if (!entry) return null;
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (Date.now() > entry.expiresAt || !existsSync(entry.path)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (entry.leases === 0) removeEntry(key, entry, existsSync(entry.path) ? 'expired' : 'missing');
    return null;
  }
  entry.leases++;
  entry.lastUsed = Date.now();
  let released = false;
  return {
    path: entry.path,
    release() {
      if (released) return;
      released = true;
      entry.leases--;
      entry.lastUsed = Date.now();
      if (entry.leases === 0 && (entry.superseded || Date.now() > entry.expiresAt)) {
        removeEntry(key, entry, 'expired');
      }
    }
  };
}

/**
 * Reserve `bytes` of cache space, evicting idle archives (least recently used
 * first) as needed. Returns a function that gives the reservation back.
 */
function reserve(bytes: number): () => void {
  while (cachedBytes + reservedBytes + bytes > archiveCacheMaxBytes) {
    let victim: [string, CacheEntry] | null = null;
    for (const item of archiveCache) {
      if (item[1].leases === 0 && (!victim || item[1].lastUsed < victim[1].lastUsed)) {
        victim = item;
      }
    }
    if (!victim) {
      log.info(
        {
          requested_bytes: bytes,
          cached_bytes: cachedBytes,
          reserved_bytes: reservedBytes,
          max_bytes: archiveCacheMaxBytes
        },
        'archive cache full, all cached archives in use'
      );
      throw new ArchiveCacheFullError();
    }
    removeEntry(victim[0], victim[1], 'evicted');
  }
  reservedBytes += bytes;
  let returned = false;
  return () => {
    if (returned) return;
    returned = true;
    reservedBytes -= bytes;
  };
}

/**
 * Add a freshly written file to the cache. Two fills for the same key can
 * overlap (e.g. an aborted job that still finished while a new one started):
 * a valid existing entry wins, and an outdated one is removed, or marked so
 * that its last reader removes it.
 */
function addEntry(key: string, dir: string, path: string): void {
  const existing = archiveCache.get(key);
  if (existing) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (Date.now() <= existing.expiresAt && existsSync(existing.path)) {
      log.debug({ cache_key: key }, 'archive already cached, discarding duplicate download');
      rmRecursive(dir);
      return;
    }
    archiveCache.delete(key);
    if (existing.leases === 0) removeEntry(key, existing, 'expired');
    else existing.superseded = true;
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const size = statSync(path).size;
  const now = Date.now();
  archiveCache.set(key, {
    dir,
    path,
    size,
    expiresAt: now + CACHE_TTL,
    lastUsed: now,
    leases: 0,
    superseded: false,
    removed: false
  });
  cachedBytes += size;
  updateCacheGauge();
}

/** Resolve with `promise`, or reject as soon as `signal` aborts. */
function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Return a lease on the cached file for `key`, running `fill` to create it on a
 * cache miss. Concurrent callers share one `fill`. The signal passed to `fill`
 * aborts once every caller waiting for it has aborted.
 */
async function ensureCached(
  key: string,
  fill: (signal: AbortSignal) => Promise<void>,
  signal?: AbortSignal
): Promise<ArchiveLease> {
  const cached = acquire(key);
  if (cached) {
    log.debug({ cache_key: key }, 'archive cache hit');
    return cached;
  }

  let job = inflight.get(key);
  if (job) {
    log.debug({ cache_key: key }, 'joining in-flight archive download');
  } else {
    const controller = new AbortController();
    const promise = fill(controller.signal).finally(() => {
      if (inflight.get(key) === newJob) inflight.delete(key);
    });
    promise.catch(() => {});
    const newJob: InflightJob = { promise, waiters: 0, controller };
    inflight.set(key, newJob);
    job = newJob;
  }

  job.waiters++;
  try {
    await waitFor(job.promise, signal);
  } finally {
    job.waiters--;
    if (job.waiters === 0) {
      // Nobody waits any more: stop the download (a no-op if it has finished)
      // and make sure later requests do not join the aborted job.
      if (inflight.get(key) === job) inflight.delete(key);
      job.controller.abort();
    }
  }

  const lease = acquire(key);
  // Only possible if the archive was evicted right after it was cached.
  if (!lease) throw new ArchiveCacheFullError();
  return lease;
}

/** A pass-through stream that fails once more than `limit` bytes went through. */
function byteLimit(limit: number): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      if (total > limit) callback(new ArchiveTooLargeError(limit));
      else callback(null, chunk);
    }
  });
}

/**
 * Write the result of `write` to a new cache entry, reserving `reserveBytes`
 * up front. On failure the partial file is removed.
 */
async function fillEntry(
  key: string,
  ext: string,
  reserveBytes: number,
  write: (path: string) => Promise<void>
): Promise<void> {
  const unreserve = reserve(reserveBytes);
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(cacheDir(), 'archive-'));
    const path = join(dir, `archive${ext}`);
    await write(path);
    addEntry(key, dir, path);
  } catch (err) {
    try {
      if (dir) rmRecursive(dir);
    } catch (rmErr) {
      log.warn({ err: rmErr, cache_key: key }, 'failed to clean up partial archive temp file');
    }
    throw err;
  } finally {
    unreserve();
  }
}

const ARCHIVE_EXT_PATTERNS = [
  { ext: '.zip', formats: ['zip'] as const },
  { ext: '.tar.gz', formats: ['tar.gz', 'tgz'] as const },
  { ext: '.tar', formats: ['tar'] as const }
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

function extractZipEntry(tempPath: string, internalPath: string, maxBytes?: number): Buffer | null {
  const zip = new AdmZip(tempPath);
  const entry = zip.getEntry(internalPath);
  if (!entry || entry.isDirectory) return null;
  if (maxBytes !== undefined && entry.header.size > maxBytes) return null;
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

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    createReadStream(tempPath).pipe(extract);
  });
}

function extractTarEntry(
  tempPath: string,
  internalPath: string,
  maxBytes?: number
): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const normalized = normalizePath(internalPath);
    let found: Buffer | null = null;

    const extract = tar.extract();

    extract.on(
      'entry',
      (header: tar.Headers, stream: NodeJS.ReadableStream, next: (err?: Error | null) => void) => {
        const entryPath = normalizePath(header.name);
        if (header.type === 'file' && entryPath === normalized && !found) {
          if (maxBytes !== undefined && (header.size ?? 0) > maxBytes) {
            stream.resume();
            stream.on('end', next);
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          let tooLarge = false;
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (maxBytes !== undefined && size > maxBytes) {
              tooLarge = true;
              return;
            }
            if (!tooLarge) chunks.push(chunk);
          });
          stream.on('end', () => {
            if (!tooLarge) found = Buffer.concat(chunks);
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

    // eslint-disable-next-line security/detect-non-literal-fs-filename
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

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    createReadStream(tempPath).pipe(gunzip).pipe(extract);
  });
}

function extractTarGzEntry(
  tempPath: string,
  internalPath: string,
  maxBytes?: number
): Promise<Buffer | null> {
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
          if (maxBytes !== undefined && (header.size ?? 0) > maxBytes) {
            stream.resume();
            stream.on('end', next);
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          let tooLarge = false;
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (maxBytes !== undefined && size > maxBytes) {
              tooLarge = true;
              return;
            }
            if (!tooLarge) chunks.push(chunk);
          });
          stream.on('end', () => {
            if (!tooLarge) found = Buffer.concat(chunks);
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

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    createReadStream(tempPath).pipe(gunzip).pipe(extract);
  });
}

function rmRecursive(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// ── Public API ───────────────────────────────────────────────────────────────

export type ArchiveDownloadFn = (key: string) => Promise<ReadableStream>;
export type ArchiveMetadataFn = (key: string) => Promise<{ size: number; contentType?: string }>;

export interface ArchiveOptions {
  /** Path of an archive inside the outer archive to operate on instead. */
  nestedArchivePath?: string;
  /** Preview size limit for the downloaded archive, the total decompressed
   *  listing size and a single extracted entry. */
  maxBytes?: number;
  /** Storage connection the archive belongs to. Part of the cache key. */
  connectionId?: string;
  /** Stops waiting for the archive, and stops its download once no other
   *  request waits for it either. */
  signal?: AbortSignal;
}

async function extractEntry(
  format: string,
  tempPath: string,
  internalPath: string,
  maxBytes?: number
): Promise<Buffer | null> {
  switch (format) {
    case 'zip':
      return extractZipEntry(tempPath, internalPath, maxBytes);
    case 'tar':
      return extractTarEntry(tempPath, internalPath, maxBytes);
    case 'tar.gz':
    case 'tgz':
      return extractTarGzEntry(tempPath, internalPath, maxBytes);
    default:
      return null;
  }
}

/**
 * Lease the outer archive from the cache, downloading it on a cache miss.
 * The download is refused when the object is larger than the limit, checked
 * via HEAD first and enforced while streaming in any case.
 */
function leaseOuterArchive(
  bucket: string,
  key: string,
  downloadFn: ArchiveDownloadFn,
  metadataFn: ArchiveMetadataFn,
  options: ArchiveOptions
): Promise<ArchiveLease> {
  const { maxBytes, connectionId = '', signal } = options;
  const limit = maxBytes ?? archiveCacheMaxBytes;
  const outerCacheKey = cacheKey(connectionId, bucket, key);

  return ensureCached(
    outerCacheKey,
    async (jobSignal) => {
      let size: number | undefined;
      try {
        size = (await metadataFn(key)).size;
      } catch (err) {
        log.debug(
          { err, bucket, key },
          'archive metadata unavailable, checking size while downloading'
        );
      }
      // HEAD cannot be aborted; do not reserve space or start a GET for nobody.
      jobSignal.throwIfAborted();
      if (size !== undefined && size > limit) {
        log.info(
          { bucket, key, compressed_size: size, max_bytes: limit },
          'archive compressed size exceeds limit'
        );
        throw new ArchiveTooLargeError(limit);
      }

      log.info({ bucket, key }, 'downloading archive');
      await fillEntry(
        outerCacheKey,
        extname(key) || '.bin',
        Math.min(size ?? limit, limit),
        async (path) => {
          const stream = await downloadFn(key);
          await pipeline(
            Readable.fromWeb(stream as import('stream/web').ReadableStream),
            byteLimit(limit),
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            createWriteStream(path),
            { signal: jobSignal }
          );
        }
      );
    },
    signal
  );
}

/**
 * Lease the archive to operate on. For nested archives, the outer archive is
 * leased first and the nested one is extracted from it into its own cache entry.
 */
function leaseArchive(
  bucket: string,
  key: string,
  downloadFn: ArchiveDownloadFn,
  metadataFn: ArchiveMetadataFn,
  options: ArchiveOptions
): Promise<ArchiveLease> {
  const { nestedArchivePath, maxBytes, connectionId = '', signal } = options;
  if (!nestedArchivePath) return leaseOuterArchive(bucket, key, downloadFn, metadataFn, options);

  const nestedCacheKey = cacheKey(connectionId, bucket, `${key}!/${nestedArchivePath}`);
  return ensureCached(
    nestedCacheKey,
    async (jobSignal) => {
      const outer = await leaseOuterArchive(bucket, key, downloadFn, metadataFn, {
        maxBytes,
        connectionId,
        signal: jobSignal
      });
      try {
        log.info(
          { bucket, key, nested_archive_path: nestedArchivePath },
          'extracting nested archive'
        );
        const format = getArchiveFormat(key);
        if (!format) throw new Error(`Unsupported archive format: ${key}`);

        const nestedData = await extractEntry(
          format,
          outer.path,
          normalizePath(nestedArchivePath),
          maxBytes
        );
        if (!nestedData) {
          throw new Error(`Nested archive "${nestedArchivePath}" not found in ${key}`);
        }
        jobSignal.throwIfAborted();

        await fillEntry(
          nestedCacheKey,
          extname(nestedArchivePath) || '.bin',
          nestedData.length,
          (path) =>
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            writeFile(path, nestedData, { signal: jobSignal })
        );
      } finally {
        outer.release();
      }
    },
    signal
  );
}

/**
 * List the contents of an archive at a given internal prefix.
 * Downloads the archive once and caches it on local disk for 30 minutes.
 * Supports nested archives via `options.nestedArchivePath`.
 */
export async function listArchiveContents(
  bucket: string,
  key: string,
  internalPrefix: string,
  downloadFn: ArchiveDownloadFn,
  metadataFn: ArchiveMetadataFn,
  options: ArchiveOptions = {}
): Promise<ArchiveListing> {
  const { nestedArchivePath, maxBytes } = options;
  const effectiveKey = nestedArchivePath ? `${key}!/${nestedArchivePath}` : key;
  const format = getArchiveFormat(effectiveKey);
  if (!format) throw new Error(`Unsupported archive format: ${key}`);

  let lease: ArchiveLease;
  try {
    lease = await leaseArchive(bucket, key, downloadFn, metadataFn, options);
  } catch (err) {
    if (err instanceof ArchiveTooLargeError) return { entries: [], hasMore: false, tooLarge: true };
    throw err;
  }

  try {
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
        return listZip(lease.path, internalPrefix, maxBytes);
      case 'tar':
        return await listTar(lease.path, internalPrefix, maxBytes);
      case 'tar.gz':
      case 'tgz':
        return await listTarGz(lease.path, internalPrefix, maxBytes);
      default:
        throw new Error(`Unsupported archive format: ${format}`);
    }
  } finally {
    lease.release();
  }
}

/**
 * Extract a single file from an archive and return its content as a Buffer.
 * Returns null if the file does not exist or exceeds the size limit.
 * Supports nested archives via `options.nestedArchivePath`.
 */
export async function extractArchiveEntry(
  bucket: string,
  key: string,
  internalPath: string,
  downloadFn: ArchiveDownloadFn,
  metadataFn: ArchiveMetadataFn,
  options: ArchiveOptions = {}
): Promise<Buffer | null> {
  const { nestedArchivePath, maxBytes } = options;
  const effectiveKey = nestedArchivePath ? `${key}!/${nestedArchivePath}` : key;
  const format = getArchiveFormat(effectiveKey);
  if (!format) throw new Error(`Unsupported archive format: ${key}`);

  let lease: ArchiveLease;
  try {
    lease = await leaseArchive(bucket, key, downloadFn, metadataFn, options);
  } catch (err) {
    if (err instanceof ArchiveTooLargeError) {
      log.info({ bucket, key }, 'archive exceeds size limit, extraction aborted');
      return null;
    }
    throw err;
  }

  let data: Buffer | null;
  try {
    log.debug(
      { bucket, key, internal_path: internalPath, nested_archive_path: nestedArchivePath, format },
      'extracting archive entry'
    );
    data = await extractEntry(format, lease.path, normalizePath(internalPath), maxBytes);
  } finally {
    lease.release();
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
 * Abort in-flight downloads and remove all cached archive temp files.
 * Useful for testing.
 */
export function clearArchiveCache(): void {
  for (const job of inflight.values()) job.controller.abort();
  inflight.clear();
  for (const [key, entry] of archiveCache) removeEntry(key, entry, 'evicted');
}

/** Bytes currently held by the archive cache. Useful for testing. */
export function archiveCacheBytes(): number {
  return cachedBytes;
}
