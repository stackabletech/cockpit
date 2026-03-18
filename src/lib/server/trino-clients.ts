import { logger } from '$lib/server/logging';
import {
  Trino,
  BasicAuth,
  type ConnectionOptions,
  type QueryResult,
  type Columns
} from 'trino-client';
import type { ConnectionConfig } from '$lib/server/trino-config.js';

const log = logger.child({ module: 'trino-clients' });

interface UserEntry {
  trinoClient: Trino;
  config: ConnectionConfig;
}

const clients = new Map<string, UserEntry>();

export function setUserConnection(userId: string, config: ConnectionConfig): void {
  // Set X-Trino-User via extraHeaders since per-query user overrides are
  // unreliable (https://github.com/trinodb/trino-js-client/issues/914,
  // https://github.com/trinodb/trino-js-client/issues/931).
  const options: ConnectionOptions = {
    server: config.connectionUrl,
    source: 'stackable-ui',
    catalog: config.defaultCatalog || undefined,
    schema: config.defaultSchema || undefined,
    auth:
      config.auth.type === 'basic'
        ? new BasicAuth(config.auth.username, config.auth.password)
        : undefined,
    ssl: config.ssl,
    extraHeaders: { 'X-Trino-User': config.username }
  };

  const trinoClient = Trino.create(options);
  clients.set(userId, { trinoClient, config });
  log.info({ user_id: userId, trino_url: config.connectionUrl }, 'user connection created');
}

export function getUserTrinoClient(userId: string): Trino | null {
  return clients.get(userId)?.trinoClient ?? null;
}

export function getUserConfig(userId: string): ConnectionConfig | null {
  return clients.get(userId)?.config ?? null;
}

/**
 * Execute a SQL statement and collect all results. Used for simple metadata
 * queries (catalog browser). Supports per-query catalog/schema overrides.
 */
export async function trinoMetadataQuery(
  trinoClient: Trino,
  sql: string,
  options?: { catalog?: string; schema?: string }
): Promise<{ columns: Columns; rows: unknown[][] }> {
  const iter = await trinoClient.query({
    query: sql,
    catalog: options?.catalog,
    schema: options?.schema
  });

  let columns: Columns = [];
  const rows: unknown[][] = [];

  // The library's Iterator returns {done: true} for the final result, and
  // `for await` skips done:true values. Use explicit next() loop.
  let iterResult = await iter.next();
  while (true) {
    const result: QueryResult = iterResult.value;

    if (result.error) {
      throw new Error(result.error.message);
    }
    if (result.columns && columns.length === 0) {
      columns = result.columns;
    }
    if (result.data) {
      rows.push(...result.data);
    }

    if (iterResult.done) break;
    iterResult = await iter.next();
  }

  return { columns, rows };
}
