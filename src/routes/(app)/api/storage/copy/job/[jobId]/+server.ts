import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { cancelJob, getJob } from '$lib/server/storage/job-store.js';

export const GET: RequestHandler = async ({ params, locals }) => {
  const { jobId } = params;
  if (!z.uuid().safeParse(jobId).success) throw error(400, 'Invalid job ID');
  const job = getJob(jobId, locals.user?.id ?? 'anonymous');
  if (!job) {
    return json({ status: 'not_found' }, { status: 404 });
  }
  return json(job);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  if (!z.uuid().safeParse(params.jobId).success) throw error(400, 'Invalid job ID');
  if (!(await cancelJob(params.jobId, locals.user?.id ?? 'anonymous')))
    return json({ status: 'not_found' }, { status: 404 });
  return json({ status: 'cancelled' });
};
