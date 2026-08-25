import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDownloadManifestPart } from '$lib/server/storage/download-manifests.js';
import {
  completeJob,
  createJob,
  failJob,
  updateJobProgress
} from '$lib/server/storage/job-store.js';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  const part = Number.parseInt(params.part, 10);
  if (!Number.isSafeInteger(part) || part < 1) throw error(400, 'Invalid download part');
  const download = await openDownloadManifestPart(
    locals.user?.id ?? 'anonymous',
    params.manifestId,
    part
  );
  if (!download)
    throw error(404, 'Download manifest, storage connection, or object is unavailable');
  const jobId = url.searchParams.get('jobId');
  if (jobId) {
    createJob(jobId);
    updateJobProgress(jobId, { currentFileName: download.file.filename });
  }
  const filename = encodeURIComponent(download.file.filename);
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${download.file.filename}"; filename*=UTF-8''${filename}`,
    'Cache-Control': 'private, no-store'
  };
  if (download.file.size > 0) headers['Content-Length'] = String(download.file.size);
  let completedBytes = 0;
  const reader = download.stream.getReader();
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (jobId) {
            updateJobProgress(jobId, { completedCount: 1, completedBytes });
            completeJob(jobId, null);
          }
          controller.close();
          return;
        }
        completedBytes += value.byteLength;
        if (jobId) updateJobProgress(jobId, { completedBytes });
        controller.enqueue(value);
      } catch (err) {
        if (jobId) failJob(jobId, err instanceof Error ? err.message : 'Download failed');
        controller.error(err);
      }
    },
    async cancel() {
      await reader.cancel();
      if (jobId) failJob(jobId, 'Download cancelled');
    }
  });
  return new Response(stream, { headers });
};
