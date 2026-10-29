import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getUserId } from '$lib/server/auth-utils.js';
import {
  startScript,
  getQuerySnapshots,
  cancelQuery,
  removeTabQuery
} from '$lib/server/trino/queries.js';
import { resolveTrinoClient } from '$lib/server/trino/client.js';
import { StatementRequestSchema, TabIdSchema } from '../../../trino/validation.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  const log = locals.logger;

  const userId = getUserId(locals);
  const client = resolveTrinoClient(userId);

  if (!client) {
    error(400, 'No Trino connection configured');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    error(400, 'Invalid JSON body');
  }

  const parsed = StatementRequestSchema.safeParse(body);
  if (!parsed.success) {
    error(400, z.prettifyError(parsed.error));
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
    error(400, 'Missing or invalid tabId parameter');
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
    error(400, 'Missing or invalid tabId parameter');
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
