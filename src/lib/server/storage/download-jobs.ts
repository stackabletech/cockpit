import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { finished } from 'node:stream/promises';
import archiver from 'archiver';
import { logger } from '$lib/server/logging';
import {
  downloadArchiveWorkers,
  downloadJobConcurrency,
  downloadPartSizeBytes,
  downloadRetentionMs
} from '$lib/server/feature-flags';
import type { StorageProvider } from './provider.js';
import type { S3ConnectionConfig } from './types.js';
import { getProvider } from './utils.js';
import { wrapProvider } from './wrap-provider.js';

const log = logger.child({ module: 'storage-download-jobs' });
const DOWNLOAD_ROOT = join(tmpdir(), 'stackable-cockpit-downloads');
const RUNNING_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60_000;

export type DownloadJobStatus = 'queued' | 'running' | 'ready' | 'error' | 'cancelled';

/** Progress phase of an archive download job. */
export type DownloadPhase = 'downloading' | 'compressing';

export interface DownloadJob {
  id: string;
  userId: string;
  bucket: string;
  prefix: string;
  keys: string[];
  format: 'zip';
  status: DownloadJobStatus;
  createdAt: number;
  updatedAt: number;
  totalBytes: number;
  progress: {
    completedCount: number;
    completedBytes: number;
    currentFileName?: string;
    phase?: DownloadPhase;
  };
  files: DownloadFile[];
  /** Epoch milliseconds when this retained artefact is removed unless accessed again. */
  expiresAt?: number;
  error?: string;
}

export interface DownloadFile {
  filename: string;
  size: number;
  part: number;
  ready: boolean;
}

interface DownloadFileInternal extends DownloadFile {
  path: string;
}

export interface ArchiveEntry {
  key: string;
  size: number;
  isDirectory: boolean;
}

interface JobInternal extends Omit<DownloadJob, 'files'> {
  files: DownloadFileInternal[];
  config: S3ConnectionConfig;
  archive: boolean;
}

const jobs = new Map<string, JobInternal>();
const jobAbortControllers = new Map<string, AbortController>();
const queue: string[] = [];
let running = 0;
let lastCleanup = Date.now();
const cleanupTimer = setInterval(cleanupExpired, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

function abortError(): Error {
  return new DOMException('Download cancelled', 'AbortError');
}

function fileName(key: string): string {
  return key.split('/').filter(Boolean).pop() ?? key;
}

function archiveBaseName(job: JobInternal): string {
  if (job.keys.length === 1 && job.keys[0].endsWith('/')) {
    return fileName(job.keys[0]).replace(/\/$/, '') || job.bucket;
  }
  return fileName(job.prefix).replace(/\/$/, '') || job.bucket;
}

export function archiveFileName(base: string, part?: number): string {
  if (part === undefined) return `${base}.zip`;
  return `${base}.z${String(part).padStart(2, '0')}`;
}

function jobDirectory(id: string): string {
  return join(DOWNLOAD_ROOT, id);
}

function shouldArchive(keys: string[]): boolean {
  return keys.length > 3 || keys.some((key) => key.endsWith('/'));
}

async function streamToFile(
  source: ReadableStream,
  path: string,
  onProgress: ((bytes: number) => void) | undefined,
  signal: AbortSignal
): Promise<void> {
  const output = createWriteStream(path);
  const progress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      onProgress?.(chunk.length);
      callback(null, chunk);
    }
  });
  const input = Readable.fromWeb(source as import('node:stream/web').ReadableStream);
  const abort = () => {
    input.destroy();
    progress.destroy();
    output.destroy();
  };
  if (signal.aborted) {
    abort();
    throw abortError();
  }
  signal.addEventListener('abort', abort, { once: true });
  try {
    await finished(input.pipe(progress).pipe(output));
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function appendObject(
  provider: StorageProvider,
  key: string,
  archive: archiver.Archiver,
  onProgress: (bytes: number) => void,
  signal: AbortSignal
): Promise<void> {
  const download = await provider.getObject(key);
  const nodeStream = Readable.fromWeb(download.stream as import('node:stream/web').ReadableStream);
  const progress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      onProgress(chunk.length);
      callback(null, chunk);
    }
  });
  const piped = nodeStream.pipe(progress);
  archive.append(piped, { name: key });
  const abort = () => {
    nodeStream.destroy();
    progress.destroy();
  };
  if (signal.aborted) {
    abort();
    throw abortError();
  }
  signal.addEventListener('abort', abort, { once: true });
  try {
    await finished(progress);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function expandKeys(provider: StorageProvider, keys: string[]): Promise<ArchiveEntry[]> {
  const expanded = await Promise.all(
    keys.map(async (key) =>
      key.endsWith('/') ? [key, ...(await provider.listAllKeys(key))] : [key]
    )
  );
  const uniqueKeys = [...new Set(expanded.flat())];
  return Promise.all(
    uniqueKeys.map(async (key) => {
      if (key.endsWith('/')) return { key, size: 0, isDirectory: true };
      const metadata = await provider.getMetadata(key);
      return { key, size: metadata.size, isDirectory: false };
    })
  );
}

function safeStagingPath(root: string, key: string): string {
  const path = join(root, key);
  if (relative(root, path).startsWith('..'))
    throw new Error('Archive entry path escapes staging directory');
  return path;
}

async function appendEntry(
  provider: StorageProvider,
  entry: ArchiveEntry,
  archive: archiver.Archiver,
  onProgress: (bytes: number) => void,
  signal: AbortSignal
): Promise<void> {
  if (entry.isDirectory) {
    archive.append(Buffer.alloc(0), {
      name: entry.key.endsWith('/') ? entry.key : `${entry.key}/`
    });
    return;
  }
  await appendObject(provider, entry.key, archive, onProgress, signal);
}

async function writeArchive(
  job: JobInternal,
  provider: StorageProvider,
  entries: ArchiveEntry[],
  path: string,
  signal: AbortSignal
): Promise<void> {
  const archive = archiver('zip', { zlib: { level: 6 } });
  const output = createWriteStream(path);
  archive.pipe(output);
  job.progress.phase = 'downloading';
  for (const entry of entries) {
    if (signal.aborted) throw abortError();
    job.progress.currentFileName = fileName(entry.key);
    job.updatedAt = Date.now();
    await appendEntry(
      provider,
      entry,
      archive,
      (bytes) => {
        job.progress.completedBytes += bytes;
        job.updatedAt = Date.now();
      },
      signal
    );
    if (!entry.isDirectory) job.progress.completedCount++;
  }
  await archive.finalize();
  await finished(output);
}

async function stageZipEntries(
  job: JobInternal,
  provider: StorageProvider,
  entries: ArchiveEntry[],
  stagingDirectory: string,
  signal: AbortSignal
): Promise<void> {
  job.progress.phase = 'downloading';
  const pending = [...entries];
  const worker = async (): Promise<void> => {
    while (true) {
      if (signal.aborted) throw abortError();
      const entry = pending.shift();
      if (!entry) return;
      const path = safeStagingPath(stagingDirectory, entry.key);
      if (entry.isDirectory) {
        await mkdir(path, { recursive: true });
        continue;
      }
      job.progress.currentFileName = fileName(entry.key);
      job.updatedAt = Date.now();
      await mkdir(dirname(path), { recursive: true });
      const download = await provider.getObject(entry.key);
      await streamToFile(
        download.stream,
        path,
        (bytes) => {
          job.progress.completedBytes += bytes;
          job.updatedAt = Date.now();
        },
        signal
      );
      job.progress.completedCount++;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(downloadArchiveWorkers, entries.length) }, worker)
  );
}

async function runSplitZip(
  stagingDirectory: string,
  archivePath: string,
  signal: AbortSignal
): Promise<void> {
  const size = `${Math.ceil(downloadPartSizeBytes / 1024)}k`;
  await new Promise<void>((resolve, reject) => {
    const process = spawn('zip', ['-q', '-s', size, archivePath, '-r', '.'], {
      cwd: stagingDirectory
    });
    const onAbort = () => process.kill('SIGTERM');
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    if (signal.aborted) {
      process.kill('SIGTERM');
      reject(abortError());
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    process.once('error', (err) => {
      cleanup();
      reject(err);
    });
    process.once('exit', (code) => {
      cleanup();
      if (code === 0) resolve();
      else if (signal.aborted) reject(abortError());
      else reject(new Error(`zip exited with status ${code ?? 'unknown'}`));
    });
  });
}

async function prepareArchive(
  job: JobInternal,
  provider: StorageProvider,
  signal: AbortSignal
): Promise<void> {
  const directory = jobDirectory(job.id);
  const entries = await expandKeys(provider, job.keys);
  const archivePath = join(directory, archiveFileName(archiveBaseName(job)));
  const totalSize = entries.reduce((total, entry) => total + entry.size, 0);
  job.totalBytes = totalSize;

  if (totalSize <= downloadPartSizeBytes) {
    await writeArchive(job, provider, entries, archivePath, signal);
    const size = (await stat(archivePath)).size;
    job.files.push({
      filename: archiveFileName(archiveBaseName(job)),
      path: archivePath,
      size,
      part: 1,
      ready: true
    });
    return;
  }

  const stagingDirectory = join(directory, '.zip-staging');
  await mkdir(stagingDirectory, { recursive: true });
  try {
    await stageZipEntries(job, provider, entries, stagingDirectory, signal);
    job.progress.phase = 'compressing';
    job.progress.currentFileName = undefined;
    job.updatedAt = Date.now();
    await runSplitZip(stagingDirectory, archivePath, signal);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }

  const files = await readdir(directory);
  const base = archiveBaseName(job);
  const volumes = files
    .filter(
      (filename) =>
        filename === `${base}.zip` ||
        (filename.startsWith(`${base}.z`) && /^\d+$/.test(filename.slice(`${base}.z`.length)))
    )
    .sort((left, right) => {
      if (left === `${base}.zip`) return 1;
      if (right === `${base}.zip`) return -1;
      return left.localeCompare(right, undefined, { numeric: true });
    });
  for (const [index, filename] of volumes.entries()) {
    const path = join(directory, filename);
    job.files.push({
      filename,
      path,
      size: (await stat(path)).size,
      part: index + 1,
      ready: true
    });
  }
}

async function prepareFiles(
  job: JobInternal,
  provider: StorageProvider,
  signal: AbortSignal
): Promise<void> {
  const directory = jobDirectory(job.id);
  const metadata = await Promise.all(job.keys.map((key) => provider.getMetadata(key)));
  job.totalBytes = metadata.reduce((total, item) => total + item.size, 0);
  const pending = [...job.keys.entries()];
  const worker = async () => {
    while (pending.length > 0) {
      if (signal.aborted) throw abortError();
      const entry = pending.shift();
      if (!entry) return;
      const [index, key] = entry;
      job.progress.currentFileName = fileName(key);
      const download = await provider.getObject(key);
      const path = join(directory, `${index}-${fileName(key)}`);
      await streamToFile(
        download.stream,
        path,
        (bytes) => {
          job.progress.completedBytes += bytes;
          job.updatedAt = Date.now();
        },
        signal
      );
      const size = (await stat(path)).size;
      job.files.push({ filename: fileName(key), path, size, part: index + 1, ready: true });
      job.progress.completedCount++;
      job.updatedAt = Date.now();
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
}

async function runJob(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;
  const signal = jobAbortControllers.get(id)?.signal ?? new AbortController().signal;
  job.status = 'running';
  job.updatedAt = Date.now();
  try {
    await mkdir(jobDirectory(job.id), { recursive: true });
    const provider = wrapProvider(getProvider(job.config, job.bucket));
    if (job.archive) await prepareArchive(job, provider, signal);
    else await prepareFiles(job, provider, signal);
    job.status = 'ready';
    job.progress.currentFileName = undefined;
    job.updatedAt = Date.now();
    log.info(
      { job_id: job.id, bucket: job.bucket, file_count: job.files.length },
      'download ready'
    );
  } catch (err) {
    if (signal?.aborted) {
      job.status = 'cancelled';
      job.progress.currentFileName = undefined;
      job.updatedAt = Date.now();
      log.info({ job_id: job.id, bucket: job.bucket }, 'download cancelled');
    } else {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : 'Download preparation failed';
      job.updatedAt = Date.now();
      log.error({ err, job_id: job.id, bucket: job.bucket }, 'download preparation failed');
    }
  } finally {
    running--;
    void dequeue();
  }
}

async function dequeue(): Promise<void> {
  cleanupExpired();
  while (running < Math.max(1, downloadJobConcurrency) && queue.length > 0) {
    const id = queue.shift();
    if (!id || !jobs.has(id) || jobs.get(id)?.status === 'cancelled') continue;
    running++;
    void runJob(id);
  }
}

function cleanupExpired(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [id, job] of jobs) {
    const ttl =
      job.status === 'queued' || job.status === 'running' ? RUNNING_TTL_MS : downloadRetentionMs;
    if (now - job.updatedAt <= ttl) continue;
    jobs.delete(id);
    jobAbortControllers.delete(id);
    void rm(jobDirectory(id), { recursive: true, force: true });
    log.trace({ job_id: id }, 'cleaned up expired download');
  }
}

export function createDownloadJob(
  userId: string,
  bucket: string,
  prefix: string,
  keys: string[],
  config: S3ConnectionConfig
): DownloadJob {
  cleanupExpired();
  const now = Date.now();
  const job: JobInternal = {
    id: crypto.randomUUID(),
    userId,
    bucket,
    prefix,
    keys,
    format: 'zip',
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    totalBytes: 0,
    progress: { completedCount: 0, completedBytes: 0 },
    files: [],
    config,
    archive: shouldArchive(keys)
  };
  jobs.set(job.id, job);
  jobAbortControllers.set(job.id, new AbortController());
  queue.push(job.id);
  void dequeue();
  return publicJob(job);
}

/** Cancel an in-flight or queued download job and clean up its artefact. */
export function cancelDownloadJob(userId: string, id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.userId !== userId) return false;
  if (job.status === 'ready' || job.status === 'error' || job.status === 'cancelled') return true;
  const queued = job.status === 'queued';
  job.status = 'cancelled';
  job.updatedAt = Date.now();
  job.progress.currentFileName = undefined;
  if (queued) {
    const index = queue.indexOf(id);
    if (index !== -1) queue.splice(index, 1);
  }
  jobAbortControllers.get(id)?.abort();
  void rm(jobDirectory(id), { recursive: true, force: true });
  log.info({ job_id: id, bucket: job.bucket }, 'download job cancelled');
  return true;
}

function publicJob(job: JobInternal): DownloadJob {
  return {
    ...job,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    files: job.files.map(({ path: _path, ...file }) => file),
    ...(job.status === 'ready' ? { expiresAt: job.updatedAt + downloadRetentionMs } : {})
  };
}

export function getDownloadJob(userId: string, id: string): DownloadJob | null {
  cleanupExpired();
  const job = jobs.get(id);
  return job?.userId === userId ? publicJob(job) : null;
}

export function getDownloadFile(
  userId: string,
  id: string,
  part: number
): DownloadFileInternal | null {
  const job = jobs.get(id);
  if (
    !job ||
    job.userId !== userId ||
    job.status === 'queued' ||
    job.status === 'error' ||
    job.status === 'cancelled'
  )
    return null;
  const file = job.files.find((file) => file.part === part && file.ready) ?? null;
  if (file) job.updatedAt = Date.now();
  return file;
}

export function openDownloadPart(
  file: DownloadFileInternal,
  start = 0,
  end = file.size - 1
): ReturnType<typeof createReadStream> {
  return createReadStream(file.path, { start, end });
}

export async function clearDownloadRootForTests(): Promise<void> {
  jobs.clear();
  jobAbortControllers.clear();
  queue.splice(0);
  await rm(DOWNLOAD_ROOT, { recursive: true, force: true });
  try {
    await readdir(DOWNLOAD_ROOT);
  } catch {
    // Expected after cleanup.
  }
}
