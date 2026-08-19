import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cancelDownloadJob, getDownloadJob } from '$lib/server/storage/download-jobs.js';

export const GET: RequestHandler = async ({ locals, params }) => {
  const job = getDownloadJob(locals.user?.id ?? 'anonymous', params.jobId);
  if (!job) return json({ status: 'not_found' }, { status: 404 });
  return json(job);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const cancelled = cancelDownloadJob(locals.user?.id ?? 'anonymous', params.jobId);
  if (!cancelled) return json({ status: 'not_found' }, { status: 404 });
  return json({ cancelled: true });
};
