import { and, desc, eq } from 'drizzle-orm';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db.js';
import { savedDiagramQueries } from '$lib/server/schema.js';
import { serializeDiagram } from '$lib/sql-diagram/serialization.js';
import type { RequestHandler } from './$types';

const MAX_NAME_LENGTH = 100;
const MAX_DIAGRAM_BYTES = 512 * 1024;

/** Validation schema for the save payload. */
const nodeSchema = z.object({
  id: z.string(),
  type: z.enum(['tableNode', 'commandNode']),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.string(), z.unknown())
});

const edgeSchema = z.object({
  id: z.string().optional(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullish(),
  targetHandle: z.string().nullish(),
  type: z.string().optional(),
  animated: z.boolean().optional()
});

const saveSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  catalog: z.string().max(200),
  schema: z.string().max(200),
  nodes: z.array(nodeSchema).max(500),
  edges: z.array(edgeSchema).max(2000),
  sqlPreview: z.string().max(20_000)
});

/**
 * GET /api/sql-diagram/queries
 *
 * Lists the authenticated user's saved diagram queries, most recent first.
 */
export const GET: RequestHandler = async ({ locals }) => {
  const userId = locals.user!.id;

  const rows = await db
    .select({
      id: savedDiagramQueries.id,
      name: savedDiagramQueries.name,
      catalog: savedDiagramQueries.catalog,
      schema: savedDiagramQueries.schema,
      diagram: savedDiagramQueries.diagram,
      sqlPreview: savedDiagramQueries.sqlPreview,
      nodeCount: savedDiagramQueries.nodeCount,
      createdAt: savedDiagramQueries.createdAt,
      updatedAt: savedDiagramQueries.updatedAt
    })
    .from(savedDiagramQueries)
    .where(eq(savedDiagramQueries.userId, userId))
    .orderBy(desc(savedDiagramQueries.updatedAt));

  locals.logger.debug({ query_count: rows.length }, 'saved diagram queries listed');
  return Response.json(
    rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    }))
  );
};

/**
 * POST /api/sql-diagram/queries
 *
 * Saves (upserts by user + name) the current diagram state.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = locals.user!.id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 });
  }
  const { name, catalog, schema, nodes, edges, sqlPreview } = parsed.data;

  if (JSON.stringify(nodes).length > MAX_DIAGRAM_BYTES) {
    return json({ error: 'Diagram too large to save' }, { status: 413 });
  }

  // Re-serialise server-side so only whitelisted fields are stored.
  const diagram = serializeDiagram(nodes, edges, catalog, schema);

  await db
    .insert(savedDiagramQueries)
    .values({
      userId,
      name,
      catalog,
      schema,
      diagram,
      sqlPreview,
      nodeCount: nodes.length
    })
    .onConflictDoUpdate({
      target: [savedDiagramQueries.userId, savedDiagramQueries.name],
      set: {
        catalog,
        schema,
        diagram,
        sqlPreview,
        nodeCount: nodes.length,
        updatedAt: new Date()
      }
    });

  locals.logger.info({ query_name: name, node_count: nodes.length }, 'diagram query saved');
  return json({ ok: true, name });
};

/**
 * DELETE /api/sql-diagram/queries?id=…
 *
 * Deletes one of the user's saved queries.
 */
export const DELETE: RequestHandler = async ({ url, locals }) => {
  const userId = locals.user!.id;
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Missing id' }, { status: 400 });

  const deleted = await db
    .delete(savedDiagramQueries)
    .where(and(eq(savedDiagramQueries.id, id), eq(savedDiagramQueries.userId, userId)))
    .returning({ id: savedDiagramQueries.id });

  if (deleted.length === 0) return json({ error: 'Not found' }, { status: 404 });

  locals.logger.info({ query_id: id }, 'diagram query deleted');
  return json({ ok: true });
};
