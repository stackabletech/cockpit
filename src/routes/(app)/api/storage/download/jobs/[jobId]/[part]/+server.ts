import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDownloadPart } from '$lib/server/storage/download-jobs.js';

export const GET: RequestHandler = async ({ locals, params }) => {
  const part = Number.parseInt(params.part, 10);
  if (!Number.isSafeInteger(part) || part < 1) throw error(400, 'Invalid download part');
  const download = openDownloadPart(locals.user?.id ?? 'anonymous', params.jobId, part);
  if (!download) throw error(404, 'Download is not ready or has expired');

  const filename = encodeURIComponent(download.file.filename);
  return new Response(download.stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${download.file.filename}"; filename*=UTF-8''${filename}`,
      'Cache-Control': 'private, no-store'
    }
  });
};
