import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getUserTrinoClient } from '$lib/server/trino-clients.js';
import { getUserId } from '$lib/server/auth-utils.js';
import { startQuery, getQuerySnapshot, cancelQuery } from '$lib/server/trino-queries.js';
import { StatementRequestSchema } from '../../validation.js';
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

  const userId = getUserId(locals);
  const trinoClient = getUserTrinoClient(userId);
  if (!trinoClient) {
    return json({ error: 'No connection configured' }, { status: 400 });
  }

  try {
    await startQuery(userId, parsed.data.sql, trinoClient);
    log.info({ user_id: userId }, 'query submitted');
    return new Response(null, { status: 204 });
  } catch (err) {
    log.error({ err }, 'failed to submit query');
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: message }, { status: 502 });
  }
};

export const GET: RequestHandler = async ({ locals }) => {
  const log = locals.logger;
  const userId = getUserId(locals);
  const snapshot = getQuerySnapshot(userId);

  log.trace({ user_id: userId, found: !!snapshot }, 'status poll');

  if (!snapshot) return json(null);
  return json(snapshot);
};

export const DELETE: RequestHandler = async ({ locals }) => {
  const log = locals.logger;
  const userId = getUserId(locals);

  log.info({ user_id: userId }, 'cancel request received');

  const cancelled = await cancelQuery(userId);
  if (!cancelled) {
    return json({ error: 'No active query to cancel' }, { status: 404 });
  }

  return new Response(null, { status: 204 });
};
