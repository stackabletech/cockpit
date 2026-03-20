import { readFileSync } from 'node:fs';
import { Agent } from 'undici';
import { logger } from '$lib/server/logging';

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
      'X-Trino-Source': options.source ?? 'stackable-ui'
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

// --- Singleton & env config ---

const envModule = await import('$env/dynamic/private').catch(() => null);
const env = envModule?.env ?? (process.env as Record<string, string | undefined>);

const trinoUrl = env.STACKABLE_UI_TRINO_URL;
const authType = (env.STACKABLE_UI_TRINO_AUTH_TYPE ?? 'none') as 'none' | 'basic';
const authUsername = env.STACKABLE_UI_TRINO_AUTH_USERNAME;
const authPassword = env.STACKABLE_UI_TRINO_AUTH_PASSWORD;
const tlsInsecure = env.STACKABLE_UI_TRINO_TLS_INSECURE === 'true';
const tlsCaCertPath = env.STACKABLE_UI_TRINO_TLS_CA_CERT;

/** True when the Trino connection is pre-configured via environment variables. */
export const trinoConfigured = !!trinoUrl;

let singleton: TrinoClient | undefined;

if (trinoConfigured) {
  if (authType === 'basic' && (!authUsername || !authPassword)) {
    throw new Error(
      'STACKABLE_UI_TRINO_AUTH_TYPE is "basic" but STACKABLE_UI_TRINO_AUTH_USERNAME or STACKABLE_UI_TRINO_AUTH_PASSWORD is missing'
    );
  }

  let dispatcher: Agent | undefined;
  if (tlsInsecure || tlsCaCertPath) {
    dispatcher = new Agent({
      connect: {
        rejectUnauthorized: !tlsInsecure,
        ...(tlsCaCertPath ? { ca: readFileSync(tlsCaCertPath) } : {})
      }
    });
  }

  const authorization =
    authType === 'basic' && authUsername && authPassword
      ? 'Basic ' + Buffer.from(`${authUsername}:${authPassword}`).toString('base64')
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

/** Returns the singleton TrinoClient. Throws if Trino is not configured. */
export function getTrinoClient(): TrinoClient {
  if (!singleton) {
    throw new Error('Trino is not configured — set STACKABLE_UI_TRINO_URL');
  }
  return singleton;
}

/** Returns the configured Trino server URL (for building UI links). */
export function getTrinoServerUrl(): string {
  if (!trinoUrl) {
    throw new Error('Trino is not configured — set STACKABLE_UI_TRINO_URL');
  }
  return trinoUrl.replace(/\/+$/, '');
}

// --- Metadata helper ---

/**
 * Submit a SQL query and drain all pages, returning columns and rows.
 * Used for simple metadata queries (catalog browser).
 */
export async function trinoMetadataQuery(
  sql: string,
  options: { user: string; catalog?: string; schema?: string }
): Promise<{ columns: TrinoColumn[]; rows: unknown[][] }> {
  const client = getTrinoClient();
  let result = await client.submit(sql, options);

  let columns: TrinoColumn[] = result.columns ?? [];
  const rows: unknown[][] = result.data ? [...result.data] : [];

  if (result.error) {
    throw new Error(result.error.message);
  }

  while (result.nextUri) {
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

  return { columns, rows };
}
