import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { cancelJob, getJob } from '$lib/server/storage/job-store.js';

export const GET: RequestHandler = async ({ params }) => {
  const { jobId } = params;
  const job = getJob(jobId);
  if (!job) {
    return json({ status: 'not_found' }, { status: 404 });
  }
  return json(job);
};

export const DELETE: RequestHandler = async ({ params }) => {
  if (!(await cancelJob(params.jobId))) return json({ status: 'not_found' }, { status: 404 });
  return json({ status: 'cancelled' });
};
