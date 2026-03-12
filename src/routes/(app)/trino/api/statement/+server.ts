import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getConnection } from '$lib/server/trino.js';
import { getUserId, startQuery } from '$lib/server/query-store.js';
import { StatementRequestSchema } from '../../schemas.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  const log = locals.logger;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = StatementRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }

  const connection = getConnection();
  if (!connection) {
    return json({ error: 'No connection configured' }, { status: 400 });
  }

  const userId = getUserId(locals);

  try {
    const trinoQueryId = await startQuery(userId, parsed.data.sql, connection);
    log.info({ trino_query_id: trinoQueryId, user_id: userId }, 'query submitted');
    return json({ trinoQueryId });
  } catch (err) {
    log.error({ err }, 'failed to submit query');
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: message }, { status: 502 });
  }
};
