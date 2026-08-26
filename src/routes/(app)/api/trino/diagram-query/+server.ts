import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getUserId } from '$lib/server/auth-utils.js';
import { resolveTrinoClient, trinoMetadataQuery } from '$lib/server/trino/client.js';
import { MAX_CLIENT_ROWS } from '$lib/types/query.js';
import type { RequestHandler } from './$types';

/** Only read-only SELECT/WITH statements may be submitted from the diagram. */
const DiagramQuerySchema = z.object({
  sql: z
    .string()
    .trim()
    .min(1)
    .max(10_000)
    .refine(
      (sql) => /^(select|with)\b/i.test(sql),
      'Only SELECT statements can be executed from the query builder'
    )
});

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

  const parsed = DiagramQuerySchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }

  const user = locals.user?.username ?? 'anonymous';
  const sql = parsed.data.sql;
  const startedAt = performance.now();

  try {
    log.debug({ user_id: userId, sql_length: sql.length }, 'executing diagram query');
    const { columns, rows, truncated } = await trinoMetadataQuery(client, sql, {
      user,
      maxRows: MAX_CLIENT_ROWS
    });
    const durationMs = performance.now() - startedAt;
    log.info(
      { user_id: userId, duration_ms: Math.round(durationMs), row_count: rows.length, truncated },
      'diagram query completed'
    );

    const columnNames = columns.map((c) => c.name);
    // Convert row tuples into objects keyed by column name for the results table.
    const rowObjects = rows.map((row) =>
      // eslint-disable-next-line security/detect-object-injection -- numeric array index
      Object.fromEntries(columnNames.map((name, i) => [name, (row as unknown[])[i] ?? null]))
    );
    return json({ columns: columnNames, rows: rowObjects, durationMs, truncated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    log.info({ err, user_id: userId }, 'diagram query failed');
    return json({ error: msg, columns: [], rows: [] }, { status: 502 });
  }
};
