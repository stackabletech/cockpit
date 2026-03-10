import { json } from '@sveltejs/kit';
import { getConnection, trinoFetch, validateTargetUrl } from '$lib/server/trino.js';
import { NextRequestSchema } from '../../schemas.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  const log = locals.logger;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = NextRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const connection = getConnection();
  if (!connection) {
    return json({ error: 'No connection configured' }, { status: 400 });
  }

  const { queryId, nextUri } = parsed.data;

  if (!validateTargetUrl(nextUri, connection.connectionUrl)) {
    log.warn({ query_id: queryId, next_uri: nextUri }, 'SSRF: nextUri origin mismatch');
    return json({ error: 'Target URL origin does not match connection' }, { status: 403 });
  }

  try {
    const response = await trinoFetch(nextUri, connection.auth);
    log.debug({ query_id: queryId, state: response.stats?.state }, 'polled next');
    return json(response);
  } catch (err) {
    log.error({ err, query_id: queryId }, 'failed to poll next');
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: message }, { status: 502 });
  }
};
