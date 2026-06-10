import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { userStorageConnections } from '$lib/server/schema';

/**
 * Database health check endpoint.
 *
 * Queries the `user_storage_connections` table with LIMIT 0 to verify:
 *   1. The app can reach the database
 *   2. Migrations have been applied (table exists)
 *
 * Returns 200 when healthy, 503 when the database is unreachable or
 * the schema is not yet migrated.
 */
export const GET: RequestHandler = async () => {
  try {
    await db.select().from(userStorageConnections).limit(0);
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch {
    return new Response(JSON.stringify({ status: 'unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json' }
    });
  }
};
