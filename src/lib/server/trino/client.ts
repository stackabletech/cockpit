import { env } from '$env/dynamic/private';
import { readFileSync } from 'node:fs';
import { Agent } from 'undici';
import { logger } from '$lib/server/logging';
import { getUserTrinoClient, getUserTrinoUrl } from './user-clients.js';

const log = logger.child({ module: 'trino-client' });

// --- Trino REST response types (only fields we read) ---

export interface TrinoColumn {
  name: string;
  type: string;
}

export interface TrinoQueryStats {
  state: string;
  progressPercentage?: number;
  processedRows?: number;
  elapsedTimeMillis?: number;
}

export interface TrinoQueryError {
  message: string;
  errorCode?: number;
  errorName?: string;
  errorType?: string;
}

export interface TrinoQueryResult {
  id: string;
  nextUri?: string;
  columns?: TrinoColumn[];
  data?: unknown[][];
  stats?: TrinoQueryStats;
  error?: TrinoQueryError;
}

// --- Client class ---

interface TrinoClientOptions {
  serverUrl: string;
  authorization?: string;
  dispatcher?: Agent;
  source?: string;
}

export class TrinoClient {
  private readonly serverUrl: string;
  private readonly commonHeaders: Record<string, string>;
  private readonly dispatcher?: Agent;

  constructor(options: TrinoClientOptions) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, '');
    this.dispatcher = options.dispatcher;

    this.commonHeaders = {
      'X-Trino-Source': options.source ?? 'stackable-cockpit'
    };
    if (options.authorization) {
      this.commonHeaders['Authorization'] = options.authorization;
    }
  }

  /** POST /v1/statement — submit a new query. */
  async submit(
    sql: string,
    options: { user: string; catalog?: string; schema?: string }
  ): Promise<TrinoQueryResult> {
    const headers: Record<string, string> = {
      ...this.commonHeaders,
      'X-Trino-User': options.user,
      'Content-Type': 'text/plain'
    };
    if (options.catalog) headers['X-Trino-Catalog'] = options.catalog;
    if (options.schema) headers['X-Trino-Schema'] = options.schema;

    const res = await fetch(`${this.serverUrl}/v1/statement`, {
      method: 'POST',
      headers,
      body: sql,
      // @ts-expect-error — Node fetch supports dispatcher via undici
      dispatcher: this.dispatcher
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Trino POST /v1/statement failed (${res.status}): ${text}`);
    }

    return res.json() as Promise<TrinoQueryResult>;
  }

  /** GET nextUri — poll for the next page of results. */
  async poll(nextUri: string): Promise<TrinoQueryResult> {
    const res = await fetch(nextUri, {
      method: 'GET',
      headers: this.commonHeaders,
      // @ts-expect-error — Node fetch supports dispatcher via undici
      dispatcher: this.dispatcher
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Trino poll failed (${res.status}): ${text}`);
    }

    return res.json() as Promise<TrinoQueryResult>;
  }

  /** DELETE /v1/query/{queryId} — cancel a running query. */
  async cancel(queryId: string): Promise<void> {
    const res = await fetch(`${this.serverUrl}/v1/query/${queryId}`, {
      method: 'DELETE',
      headers: this.commonHeaders,
      // @ts-expect-error — Node fetch supports dispatcher via undici
      dispatcher: this.dispatcher
    });

    // 404 is expected — the query may have already finished and been cleaned up.
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new Error(`Trino DELETE /v1/query failed (${res.status}): ${text}`);
    }
  }
}

// --- Auth helper ---

/** Build a Basic auth header value from username and password. */
export function buildBasicAuthHeader(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

// --- Singleton & env config ---

const trinoUrl = env.STACKABLE_COCKPIT_TRINO_URL;
const authType = (env.STACKABLE_COCKPIT_TRINO_AUTH_TYPE ?? 'none') as 'none' | 'basic';
const authUsername = env.STACKABLE_COCKPIT_TRINO_AUTH_USERNAME;
const authPassword = env.STACKABLE_COCKPIT_TRINO_AUTH_PASSWORD;
const tlsInsecure = env.STACKABLE_COCKPIT_TRINO_TLS_INSECURE === 'true';
const tlsCaCertPath = env.STACKABLE_COCKPIT_TRINO_TLS_CA_CERT;

/** True when the Trino connection is pre-configured via environment variables. */
export const trinoConfigured = !!trinoUrl;

let singleton: TrinoClient | undefined;

if (trinoConfigured) {
  if (authType === 'basic' && (!authUsername || !authPassword)) {
    throw new Error(
      'STACKABLE_COCKPIT_TRINO_AUTH_TYPE is "basic" but STACKABLE_COCKPIT_TRINO_AUTH_USERNAME or STACKABLE_COCKPIT_TRINO_AUTH_PASSWORD is missing'
    );
  }

  let dispatcher: Agent | undefined;
  if (tlsInsecure || tlsCaCertPath) {
    dispatcher = new Agent({
      connect: {
        rejectUnauthorized: !tlsInsecure,
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        ...(tlsCaCertPath ? { ca: readFileSync(tlsCaCertPath) } : {})
      }
    });
  }

  const authorization =
    authType === 'basic' && authUsername && authPassword
      ? buildBasicAuthHeader(authUsername, authPassword)
      : undefined;

  singleton = new TrinoClient({
    serverUrl: trinoUrl!,
    authorization,
    dispatcher
  });

  log.info(
    { trino_url: trinoUrl, auth_type: authType, tls_insecure: tlsInsecure },
    'Trino connection configured via environment'
  );
}

/**
 * Returns the TrinoClient for a user. Prefers the ENV-configured singleton;
 * falls back to the per-user connection. Returns null when neither exists.
 */
export function resolveTrinoClient(userId: string): TrinoClient | null {
  if (singleton) return singleton;
  return getUserTrinoClient(userId);
}

/** Returns the Trino server URL for a user (for building UI links). */
export function resolveTrinoServerUrl(userId: string): string | null {
  if (trinoUrl) return trinoUrl.replace(/\/+$/, '');
  return getUserTrinoUrl(userId);
}

// --- Metadata helper ---

/**
 * Submit a SQL query and drain all pages, returning columns and rows.
 * Used for simple metadata queries (catalog browser).
 *
 * When `maxRows` is set, collection stops once the cap is reached, the
 * query is cancelled upstream, and `truncated: true` is returned.
 */
export async function trinoMetadataQuery(
  client: TrinoClient,
  sql: string,
  options: { user: string; catalog?: string; schema?: string; maxRows?: number }
): Promise<{ columns: TrinoColumn[]; rows: unknown[][]; truncated: boolean }> {
  let result = await client.submit(sql, options);

  let columns: TrinoColumn[] = result.columns ?? [];
  const rows: unknown[][] = result.data ? [...result.data] : [];

  if (result.error) {
    throw new Error(result.error.message);
  }

  let truncated = false;

  while (result.nextUri) {
    if (options.maxRows !== undefined && rows.length >= options.maxRows) {
      truncated = true;
      break;
    }

    result = await client.poll(result.nextUri);

    if (result.error) {
      throw new Error(result.error.message);
    }
    if (result.columns && columns.length === 0) {
      columns = result.columns;
    }
    if (result.data) {
      rows.push(...result.data);
    }
  }

  if (truncated && result.nextUri) {
    try {
      await client.cancel(result.id);
    } catch (err) {
      log.debug({ err }, 'failed to cancel query after reaching row limit');
    }
  }

  return { columns, rows, truncated };
}
