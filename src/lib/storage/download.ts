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
  onComplete: (jobId: string) => void
): Promise<void> {
  const downloaded = new Set<number>();
  while (true) {
    const job = await api.pollDownloadJob(jobId);
    onUpdate(job);
    for (const file of job.files) {
      if (file.ready && !downloaded.has(file.part)) {
        await triggerDownload(job.id, file.part, file.filename);
        downloaded.add(file.part);
      }
    }
    if (job.status === 'ready') {
      removeJob(jobId);
      onComplete(jobId);
      return;
    }
    if (job.status === 'error') {
      removeJob(jobId);
      throw new Error(job.error ?? 'Download preparation failed');
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
  onCreated: (job: DownloadJobStatus) => void,
  onUpdate: (job: DownloadJobStatus) => void,
  onComplete: (jobId: string) => void
): Promise<void> {
  const job = await api.createDownloadJob({ bucket, prefix, keys });
  saveJob({ id: job.id, connectionId, startedAt: Date.now() });
  onCreated(job);
  await waitForDownload(api, job.id, onUpdate, onComplete);
}

/** Reacquire download preparation that outlived the previous tab. */
export async function reacquireDownloads(
  api: StorageApi,
  connectionId: string,
  onUpdate: (job: DownloadJobStatus) => void,
  onComplete: (jobId: string) => void
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
