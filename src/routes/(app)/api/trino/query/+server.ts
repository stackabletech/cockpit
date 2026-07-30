import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getUserId } from '$lib/server/auth-utils.js';
import {
  startScript,
  getQuerySnapshots,
  cancelQuery,
  removeTabQuery
} from '$lib/server/trino/queries.js';
import { resolveTrinoClient } from '$lib/server/trino/client.js';
import { StatementRequestSchema, TabIdSchema } from '$lib/trino/validation.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  const log = locals.logger;

  const userId = getUserId(locals);
  const client = resolveTrinoClient(userId);

  if (!client) {
    return json({ error: 'No Trino connection configured' }, { status: 400 });
  }

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

  const user = locals.user?.username ?? 'anonymous';
  const { statements, tabId, catalog, schema } = parsed.data;

  // Fire-and-forget — the script orchestrator runs in the background.
  startScript(client, userId, tabId, statements, { user, catalog, schema }).catch((err) => {
    log.error({ err, user_id: userId, tab_id: tabId }, 'script orchestrator crashed');
  });

  log.info(
    { user_id: userId, tab_id: tabId, statement_count: statements.length },
    'script submitted'
  );
  return new Response(null, { status: 204 });
};

export const GET: RequestHandler = async ({ url, locals }) => {
  const log = locals.logger;
  const userId = getUserId(locals);
  const parsed = TabIdSchema.safeParse(url.searchParams.get('tabId'));
  if (!parsed.success) {
    return json({ error: 'Missing or invalid tabId parameter' }, { status: 400 });
  }

  // Lightweight mode omits rows/columns for completed queries to keep polling payloads small.
  const lightweight = url.searchParams.get('lightweight') !== 'false';
  const snapshots = getQuerySnapshots(userId, parsed.data, lightweight);

  log.trace({ user_id: userId, tab_id: parsed.data, count: snapshots.length }, 'query poll');
  return json(snapshots);
};

export const DELETE: RequestHandler = async ({ url, locals }) => {
  const log = locals.logger;
  const userId = getUserId(locals);
  const parsed = TabIdSchema.safeParse(url.searchParams.get('tabId'));
  if (!parsed.success) {
    return json({ error: 'Missing or invalid tabId parameter' }, { status: 400 });
  }

  const tabId = parsed.data;
  const cleanup = url.searchParams.get('cleanup') === 'true';

  log.info({ user_id: userId, tab_id: tabId, cleanup }, 'delete request received');

  await cancelQuery(userId, tabId);
  if (cleanup) {
    removeTabQuery(userId, tabId);
  }

  return new Response(null, { status: 204 });
};
