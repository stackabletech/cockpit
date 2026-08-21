import type { StorageApi } from './api.js';

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
