import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getUserId } from '$lib/server/auth-utils.js';
import {
  startQuery,
  getQuerySnapshot,
  cancelQuery,
  removeTabQuery
} from '$lib/server/trino/queries.js';
import { resolveTrinoClient } from '$lib/server/trino/client.js';
import { StatementRequestSchema, TabIdSchema } from '../validation.js';
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

  try {
    await startQuery(client, userId, parsed.data.tabId, parsed.data.sql, {
      user,
      catalog: parsed.data.catalog,
      schema: parsed.data.schema
    });
    log.info({ user_id: userId, tab_id: parsed.data.tabId }, 'query submitted');
    return new Response(null, { status: 204 });
  } catch (err) {
    log.error({ err }, 'failed to submit query');
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: message }, { status: 502 });
  }
};

export const GET: RequestHandler = async ({ url, locals }) => {
  const log = locals.logger;
  const userId = getUserId(locals);
  const parsed = TabIdSchema.safeParse(url.searchParams.get('tabId'));
  if (!parsed.success) {
    return json({ error: 'Missing or invalid tabId parameter' }, { status: 400 });
  }

  const snapshot = getQuerySnapshot(userId, parsed.data);

  log.trace({ user_id: userId, tab_id: parsed.data, found: !!snapshot }, 'status poll');

  if (!snapshot) return json(null);
  return json(snapshot);
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
