import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDownloadFile, openDownloadPart } from '$lib/server/storage/download-jobs.js';

export const GET: RequestHandler = async ({ locals, params, request }) => {
  const part = Number.parseInt(params.part, 10);
  if (!Number.isSafeInteger(part) || part < 1) throw error(400, 'Invalid download part');
  const file = getDownloadFile(locals.user?.id ?? 'anonymous', params.jobId, part);
  if (!file) throw error(404, 'Download part is not ready or has expired');

  const range = request.headers.get('range');
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  const requestedStart = match?.[1] ? Number.parseInt(match[1], 10) : 0;
  const requestedEnd = match?.[2] ? Number.parseInt(match[2], 10) : file.size - 1;
  if (
    !Number.isSafeInteger(requestedStart) ||
    !Number.isSafeInteger(requestedEnd) ||
    requestedStart < 0 ||
    requestedStart > requestedEnd ||
    requestedStart >= file.size
  ) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${file.size}` }
    });
  }
  const end = Math.min(requestedEnd, file.size - 1);
  const length = end - requestedStart + 1;
  const filename = encodeURIComponent(file.filename);
  return new Response(openDownloadPart(file, requestedStart, end) as unknown as ReadableStream, {
    status: match ? 206 : 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(length),
      'Content-Disposition': `attachment; filename="${file.filename}"; filename*=UTF-8''${filename}`,
      'Cache-Control': 'private, no-store',
      'Accept-Ranges': 'bytes',
      ...(match ? { 'Content-Range': `bytes ${requestedStart}-${end}/${file.size}` } : {})
    }
  });
};
