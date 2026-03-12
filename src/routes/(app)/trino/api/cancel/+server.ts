import { json } from '@sveltejs/kit';
import { getUserId, cancelQuery } from '$lib/server/query-store.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
  const log = locals.logger;
  const userId = getUserId(locals);

  log.info({ user_id: userId }, 'cancel request received');

  const cancelled = await cancelQuery(userId);
  if (!cancelled) {
    return json({ error: 'No active query to cancel' }, { status: 404 });
  }

  return new Response(null, { status: 204 });
};
