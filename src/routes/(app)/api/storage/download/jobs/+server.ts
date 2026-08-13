import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDownloadJob } from '$lib/server/storage/download-jobs.js';
import { requireBucket, requireConfig } from '$lib/server/storage/request-context.js';

export const POST: RequestHandler = async (event) => {
  const bucket = requireBucket(event);
  const config = requireConfig(event);
  const prefix = event.url.searchParams.get('prefix')?.trim() ?? '';
  const keys = ((await event.request.json()) as { keys?: unknown }).keys;
  if (
    !Array.isArray(keys) ||
    keys.length === 0 ||
    keys.some((key) => typeof key !== 'string' || !key)
  ) {
    throw error(400, 'Request body must contain one or more object keys');
  }

  const userId = event.locals.user?.id ?? 'anonymous';
  const job = createDownloadJob(userId, bucket, prefix, [...new Set(keys)], config);
  event.locals.logger.info(
    { download_id: job.id, bucket, key_count: job.keys.length },
    'download job queued'
  );
  return json(job, { status: 202 });
};
