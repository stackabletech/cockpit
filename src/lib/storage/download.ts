import type { DownloadJobStatus, StorageApi } from './api.js';

const MAX_INDIVIDUAL_DOWNLOADS = 3;
const POLL_INTERVAL_MS = 1_000;
const DOWNLOADS_KEY = 'storage_download_jobs';

interface PersistedDownloadJob {
  id: string;
  connectionId: string;
  startedAt: number;
}

async function triggerDownload(jobId: string, part: number, filename: string): Promise<void> {
  const anchor = document.createElement('a');
  anchor.href = `/api/storage/download/jobs/${encodeURIComponent(jobId)}/${part}`;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  // Browsers can cancel concurrent native downloads when their initiating
  // anchors are detached immediately. Keep each link alive briefly and stagger
  // the clicks while the downloads themselves proceed in parallel.
  await new Promise((resolve) => setTimeout(resolve, 250));
  setTimeout(() => anchor.remove(), 10_000);
}

export async function downloadAgain(api: StorageApi, jobId: string): Promise<void> {
  const job = await api.pollDownloadJob(jobId);
  if (job.status !== 'ready') throw new Error(job.error ?? 'Download is no longer available');
  for (const file of job.files) {
    if (file.ready) await triggerDownload(job.id, file.part, file.filename);
  }
}

function loadJobs(): PersistedDownloadJob[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(DOWNLOADS_KEY) ?? '[]'
    ) as PersistedDownloadJob[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistJobs(jobs: PersistedDownloadJob[]): void {
  localStorage.setItem(DOWNLOADS_KEY, JSON.stringify(jobs));
}

function saveJob(job: PersistedDownloadJob): void {
  persistJobs([...loadJobs().filter((existing) => existing.id !== job.id), job]);
}

function removeJob(id: string): void {
  persistJobs(loadJobs().filter((job) => job.id !== id));
}

async function waitForDownload(
  api: StorageApi,
  jobId: string,
  onUpdate: (job: DownloadJobStatus) => void,
  onComplete: (job: DownloadJobStatus) => void,
  signal?: AbortSignal
): Promise<void> {
  const downloaded = new Set<number>();
  while (true) {
    if (signal?.aborted) {
      removeJob(jobId);
      return;
    }
    let job: DownloadJobStatus;
    try {
      job = await api.pollDownloadJob(jobId, signal);
    } catch (err) {
      if (signal?.aborted) {
        removeJob(jobId);
        return;
      }
      throw err;
    }
    onUpdate(job);
    for (const file of job.files) {
      if (file.ready && !downloaded.has(file.part)) {
        await triggerDownload(job.id, file.part, file.filename);
        downloaded.add(file.part);
      }
    }
    if (job.status === 'ready') {
      removeJob(jobId);
      onComplete(job);
      return;
    }
    if (job.status === 'error') {
      removeJob(jobId);
      throw new Error(job.error ?? 'Download preparation failed');
    }
    if (job.status === 'cancelled') {
      removeJob(jobId);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

export async function startDownload(
  api: StorageApi,
  bucket: string,
  prefix: string,
  keys: string[],
  connectionId: string,
  signal: AbortSignal | undefined,
  onCreated: (job: DownloadJobStatus) => void,
  onUpdate: (job: DownloadJobStatus) => void,
  onComplete: (job: DownloadJobStatus) => void
): Promise<void> {
  let job: DownloadJobStatus;
  try {
    job = await api.createDownloadJob({ bucket, prefix, keys }, signal);
  } catch (err) {
    if (signal?.aborted) return;
    throw err;
  }
  saveJob({ id: job.id, connectionId, startedAt: Date.now() });
  onCreated(job);
  await waitForDownload(api, job.id, onUpdate, onComplete, signal);
}

/** Reacquire download preparation that outlived the previous tab. */
export async function reacquireDownloads(
  api: StorageApi,
  connectionId: string,
  onUpdate: (job: DownloadJobStatus) => void,
  onComplete: (job: DownloadJobStatus) => void
): Promise<void> {
  const jobs = loadJobs().filter((job) => job.connectionId === connectionId);
  await Promise.all(
    jobs.map(async (job) => {
      try {
        await waitForDownload(api, job.id, onUpdate, onComplete);
      } catch {
        removeJob(job.id);
      }
    })
  );
}

export function downloadsNeedArchive(keys: string[]): boolean {
  return keys.length > MAX_INDIVIDUAL_DOWNLOADS || keys.some((key) => key.endsWith('/'));
}
