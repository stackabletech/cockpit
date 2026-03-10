import { json } from '@sveltejs/kit';
import { getConnection, trinoFetch } from '$lib/server/trino.js';
import { trinoQueryTotal } from '$lib/server/metrics.js';
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
    return json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const connection = getConnection();
  if (!connection) {
    return json({ error: 'No connection configured' }, { status: 400 });
  }

  const queryId = crypto.randomUUID();
  const sql = parsed.data.sql.replace(/;\s*$/, '').trim();

  log.info({ query_id: queryId, trino_url: connection.connectionUrl }, 'submitting query');
  trinoQueryTotal.inc({ outcome: 'submitted' });

  try {
    const response = await trinoFetch(`${connection.connectionUrl}/v1/statement`, connection.auth, {
      method: 'POST',
      body: sql,
      headers: { 'Content-Type': 'text/plain' }
    });

    return json({ queryId, ...response });
  } catch (err) {
    log.error({ err, query_id: queryId }, 'failed to submit query');
    trinoQueryTotal.inc({ outcome: 'failed' });
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: message }, { status: 502 });
  }
};
