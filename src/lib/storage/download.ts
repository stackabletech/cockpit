import type { StorageApi } from './api.js';

/**
 * Estimate the byte length of the stored (uncompressed) ZIP that a multi
 * download will produce. The exact archive size is deliberately not computed
 * server-side, so this client-side approximation (payload plus per-entry ZIP
 * structure overhead) drives the size/ETA display while downloading.
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

async function triggerDownload(manifestId: string, part: number, filename: string): Promise<void> {
  const anchor = document.createElement('a');
  anchor.href = `/api/storage/download/manifests/${encodeURIComponent(manifestId)}/${part}`;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  // Keep concurrent native downloads initiated by this user gesture alive long enough
  // for Firefox and Chromium to accept them.
  await new Promise((resolve) => setTimeout(resolve, 250));
  setTimeout(() => anchor.remove(), 10_000);
}

export async function triggerManifestDownloads(manifest: {
  id: string;
  files: Array<{ filename: string; part: number }>;
}): Promise<void> {
  for (const file of manifest.files) await triggerDownload(manifest.id, file.part, file.filename);
}

/** Prepare a final manifest, then immediately hand its streams to the browser. */
export async function startDownload(
  api: StorageApi,
  bucket: string,
  prefix: string,
  keys: string[],
  signal?: AbortSignal
): Promise<{ id: string; fileCount: number; totalBytes: number }> {
  const manifest = await api.createDownloadManifest({ bucket, prefix, keys }, signal);
  await triggerManifestDownloads(manifest);
  return {
    id: manifest.id,
    fileCount: manifest.files.length,
    totalBytes: manifest.files.reduce((total, file) => total + file.size, 0)
  };
}
