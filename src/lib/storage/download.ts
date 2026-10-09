import type { StorageApi } from './api.js';

/**
 * Estimate the byte length of the stored (uncompressed) ZIP that a multi
 * download will produce while preparing the manifest. The server's exact
 * manifest size replaces this temporary estimate before transfer tracking.
 */
export function estimateArchiveSize(
  entries: Array<{ key: string; size: number; isDirectory?: boolean }>
): number {
  let payload = 0;
  // End-of-central-directory record.
  let overhead = 22;
  for (const entry of entries) {
    const nameLength = entry.key.length + (entry.isDirectory && !entry.key.endsWith('/') ? 1 : 0);
    // Local file header (30) + data descriptor (16) + central directory header
    // (46), with the entry name stored twice (local header + central directory).
    overhead += 92 + 2 * nameLength;
    if (!entry.isDirectory) payload += entry.size;
  }
  return payload + overhead;
}

async function triggerDownload(
  manifestId: string,
  part: number,
  filename: string,
  jobId: string
): Promise<void> {
  const anchor = document.createElement('a');
  anchor.href = `/api/storage/download/manifests/${encodeURIComponent(manifestId)}/${part}?${new URLSearchParams({ jobId })}`;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  // Keep concurrent native downloads initiated by this user gesture alive long enough
  // for Firefox and Chromium to accept them.
  await new Promise((resolve) => setTimeout(resolve, 250));
  setTimeout(() => anchor.remove(), 10_000);
}

export async function triggerManifestDownloads(
  manifest: {
    id: string;
    files: Array<{ filename: string; part: number }>;
  },
  signal?: AbortSignal,
  onJobIds?: (jobIds: string[]) => void
): Promise<string[]> {
  const jobIds: string[] = [];
  for (const file of manifest.files) {
    signal?.throwIfAborted();
    const jobId = crypto.randomUUID();
    jobIds.push(jobId);
    onJobIds?.([...jobIds]);
    await triggerDownload(manifest.id, file.part, file.filename, jobId);
  }
  return jobIds;
}

/** Prepare a final manifest, then immediately hand its streams to the browser. */
export async function startDownload(
  api: StorageApi,
  bucket: string,
  prefix: string,
  keys: string[],
  signal?: AbortSignal,
  onJobIds?: (jobIds: string[]) => void
): Promise<{ id: string; fileCount: number; totalBytes: number; jobIds: string[] }> {
  const manifest = await api.createDownloadManifest({ bucket, prefix, keys }, signal);
  const jobIds = await triggerManifestDownloads(manifest, signal, onJobIds);
  return {
    id: manifest.id,
    fileCount: manifest.files.length,
    totalBytes: manifest.files.reduce((total, file) => total + file.size, 0),
    jobIds
  };
}
