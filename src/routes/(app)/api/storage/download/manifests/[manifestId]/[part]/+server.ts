import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDownloadManifestPart } from '$lib/server/storage/download-manifests.js';

export const GET: RequestHandler = async ({ locals, params }) => {
  const part = Number.parseInt(params.part, 10);
  if (!Number.isSafeInteger(part) || part < 1) throw error(400, 'Invalid download part');
  const download = await openDownloadManifestPart(
    locals.user?.id ?? 'anonymous',
    params.manifestId,
    part
  );
  if (!download)
    throw error(404, 'Download manifest, storage connection, or object is unavailable');
  const filename = encodeURIComponent(download.file.filename);
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${download.file.filename}"; filename*=UTF-8''${filename}`,
    'Cache-Control': 'private, no-store'
  };
  // A size of 0 means the exact byte length is unknown (streamed ZIP
  // archives), so no Content-Length is sent and the response is chunked.
  if (download.file.size > 0) headers['Content-Length'] = String(download.file.size);
  return new Response(download.stream, { headers });
};
