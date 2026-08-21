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
  return new Response(download.stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(download.file.size),
      'Content-Disposition': `attachment; filename="${download.file.filename}"; filename*=UTF-8''${filename}`,
      'Cache-Control': 'private, no-store'
    }
  });
};
