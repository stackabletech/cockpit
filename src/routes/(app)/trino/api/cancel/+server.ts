import { json } from '@sveltejs/kit';
import { getConnection, trinoFetch, validateTargetUrl } from '$lib/server/trino.js';
import { trinoQueryTotal } from '$lib/server/metrics.js';
import { CancelRequestSchema } from '../../schemas.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  const log = locals.logger;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CancelRequestSchema.safeParse(body);
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

  log.info({ query_id: queryId }, 'cancelling query');
  trinoQueryTotal.inc({ outcome: 'cancelled' });

  try {
    await trinoFetch(nextUri, connection.auth, { method: 'DELETE' });
    return new Response(null, { status: 204 });
  } catch (err) {
    log.error({ err, query_id: queryId }, 'failed to cancel query');
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: message }, { status: 502 });
  }
};
