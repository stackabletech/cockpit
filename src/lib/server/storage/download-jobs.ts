import { logger } from '$lib/server/logging';
import { downloadRetentionMs } from '$lib/server/feature-flags';
import type { StorageProvider } from './provider.js';
import type { S3ConnectionConfig } from './types.js';
import { getProvider } from './utils.js';
import { wrapProvider } from './wrap-provider.js';
import { createZipStream, type ZipEntry } from './zip-stream.js';

const log = logger.child({ module: 'storage-download-jobs' });
const RUNNING_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60_000;

export type DownloadJobStatus = 'queued' | 'running' | 'ready' | 'error' | 'cancelled';

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
  progress: { completedCount: number; completedBytes: number; activeFiles: string[] };
  files: DownloadFile[];
  expiresAt?: number;
  error?: string;
}

export interface DownloadFile {
  filename: string;
  size: number;
  part: number;
  ready: boolean;
}

export type ArchiveEntry = ZipEntry;

interface JobInternal extends DownloadJob {
  config: S3ConnectionConfig;
  archive: boolean;
  entries: ArchiveEntry[];
}

const jobs = new Map<string, JobInternal>();
let lastCleanup = Date.now();

function isCancelled(job: JobInternal): boolean {
  return job.status === 'cancelled';
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

export function archiveFileName(base: string): string {
  return `${base}.zip`;
}

function shouldArchive(keys: string[]): boolean {
  return keys.length > 3 || keys.some((key) => key.endsWith('/'));
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

async function prepareJob(job: JobInternal): Promise<void> {
  job.status = 'running';
  job.updatedAt = Date.now();
  const provider = wrapProvider(getProvider(job.config, job.bucket));
  job.entries = job.archive
    ? await expandKeys(provider, job.keys)
    : await Promise.all(
        job.keys.map(async (key) => {
          const metadata = await provider.getMetadata(key);
          return { key, size: metadata.size, isDirectory: false };
        })
      );
  if (isCancelled(job)) return;
  job.totalBytes = job.entries.reduce((total, entry) => total + entry.size, 0);
  job.files = job.archive
    ? [
        {
          filename: archiveFileName(archiveBaseName(job)),
          size: job.totalBytes,
          part: 1,
          ready: true
        }
      ]
    : job.entries.map((entry, index) => ({
        filename: fileName(entry.key),
        size: entry.size,
        part: index + 1,
        ready: true
      }));
  job.progress = {
    completedCount: job.entries.filter((entry) => !entry.isDirectory).length,
    completedBytes: job.totalBytes,
    activeFiles: []
  };
  if (isCancelled(job)) return;
  job.status = 'ready';
  job.updatedAt = Date.now();
  log.info({ job_id: job.id, bucket: job.bucket, file_count: job.files.length }, 'download ready');
}

function cleanupExpired(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [id, job] of jobs) {
    const ttl =
      job.status === 'queued' || job.status === 'running' ? RUNNING_TTL_MS : downloadRetentionMs;
    if (now - job.updatedAt > ttl) {
      jobs.delete(id);
      log.trace({ job_id: id }, 'cleaned up expired download');
    }
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
    progress: { completedCount: 0, completedBytes: 0, activeFiles: [] },
    files: [],
    config,
    archive: shouldArchive(keys),
    entries: []
  };
  jobs.set(job.id, job);
  void prepareJob(job).catch((err: unknown) => {
    if (isCancelled(job)) return;
    job.status = 'error';
    job.error = err instanceof Error ? err.message : 'Download preparation failed';
    job.updatedAt = Date.now();
    log.error({ err, job_id: job.id, bucket: job.bucket }, 'download preparation failed');
  });
  return publicJob(job);
}

export function cancelDownloadJob(userId: string, id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.userId !== userId) return false;
  if (job.status === 'error' || job.status === 'cancelled') return true;
  job.status = 'cancelled';
  job.updatedAt = Date.now();
  job.progress.activeFiles = [];
  log.info({ job_id: id, bucket: job.bucket }, 'download job cancelled');
  return true;
}

function publicJob(job: JobInternal): DownloadJob {
  return {
    id: job.id,
    userId: job.userId,
    bucket: job.bucket,
    prefix: job.prefix,
    keys: job.keys,
    format: job.format,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    totalBytes: job.totalBytes,
    progress: job.progress,
    files: job.files,
    ...(job.error ? { error: job.error } : {}),
    ...(job.status === 'ready' ? { expiresAt: job.updatedAt + downloadRetentionMs } : {})
  };
}

export function getDownloadJob(userId: string, id: string): DownloadJob | null {
  cleanupExpired();
  const job = jobs.get(id);
  return job?.userId === userId ? publicJob(job) : null;
}

export function getDownloadFile(userId: string, id: string, part: number): DownloadFile | null {
  const job = jobs.get(id);
  if (!job || job.userId !== userId || job.status !== 'ready') return null;
  return job.files.find((file) => file.part === part && file.ready) ?? null;
}

export function openDownloadPart(
  userId: string,
  id: string,
  part: number
): { stream: ReadableStream; file: DownloadFile } | null {
  const job = jobs.get(id);
  const file = getDownloadFile(userId, id, part);
  if (!job || !file) return null;
  const provider = wrapProvider(getProvider(job.config, job.bucket));
  if (job.archive) return { stream: createZipStream(provider, job.entries), file };
  const entry = job.entries[part - 1];
  if (!entry) return null;
  return {
    stream: new ReadableStream({
      async start(controller) {
        try {
          const download = await provider.getObject(entry.key);
          await download.stream.pipeTo(
            new WritableStream({
              write(chunk) {
                controller.enqueue(chunk);
              }
            })
          );
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      }
    }),
    file
  };
}

export async function clearDownloadRootForTests(): Promise<void> {
  jobs.clear();
}
