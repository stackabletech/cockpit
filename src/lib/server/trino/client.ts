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
  /** Forward the user as `X-Trino-User` (impersonation). Default true. */
  impersonate?: boolean;
}

export class TrinoClient {
  private readonly serverUrl: string;
  private readonly commonHeaders: Record<string, string>;
  private readonly dispatcher?: Agent;
  private readonly impersonate: boolean;
  private readonly authenticated: boolean;

  constructor(options: TrinoClientOptions) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, '');
    this.dispatcher = options.dispatcher;
    this.impersonate = options.impersonate ?? true;
    this.authenticated = !!options.authorization;

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
    options: { user: string; catalog?: string; schema?: string; signal?: AbortSignal }
  ): Promise<TrinoQueryResult> {
    const headers: Record<string, string> = {
      ...this.commonHeaders,
      'Content-Type': 'text/plain'
    };
    // Skip X-Trino-User only when not impersonating and Trino can fall back to the authenticated principal.
    if (this.impersonate || !this.authenticated) {
      headers['X-Trino-User'] = options.user;
    }
    if (options.catalog) headers['X-Trino-Catalog'] = options.catalog;
    if (options.schema) headers['X-Trino-Schema'] = options.schema;

    const res = await fetch(`${this.serverUrl}/v1/statement`, {
      method: 'POST',
      headers,
      body: sql,
      signal: options.signal,
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
  async poll(
    nextUri: string,
    opts: { user?: string; signal?: AbortSignal } = {}
  ): Promise<TrinoQueryResult> {
    const res = await fetch(nextUri, {
      method: 'GET',
      headers: this.headersForUser(opts.user),
      signal: opts.signal,
      // @ts-expect-error — Node fetch supports dispatcher via undici
      dispatcher: this.dispatcher
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Trino poll failed (${res.status}): ${text}`);
    }

    return res.json() as Promise<TrinoQueryResult>;
  }

  /** commonHeaders plus X-Trino-User for the given user when impersonating. */
  private headersForUser(user: string | undefined): Record<string, string> {
    const headers = { ...this.commonHeaders };
    if (user && (this.impersonate || !this.authenticated)) {
      headers['X-Trino-User'] = user;
    }
    return headers;
  }

  /** DELETE /v1/query/{queryId} — cancel a running query. */
  async cancel(queryId: string, user?: string): Promise<void> {
    const res = await fetch(`${this.serverUrl}/v1/query/${queryId}`, {
      method: 'DELETE',
      headers: this.headersForUser(user),
      // @ts-expect-error — Node fetch supports dispatcher via undici
      dispatcher: this.dispatcher
    });

    // 404 is expected — the query may have already finished and been cleaned up.
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new Error(`Trino DELETE /v1/query failed (${res.status}): ${text}`);
    }
  }

  /** DELETE nextUri — client-protocol cancel (no kill-query permission needed). */
  async cancelViaUri(uri: string, user?: string): Promise<void> {
    const res = await fetch(uri, {
      method: 'DELETE',
      headers: this.headersForUser(user),
      // @ts-expect-error — Node fetch supports dispatcher via undici
      dispatcher: this.dispatcher
    });

    if (!res.ok && res.status !== 404 && res.status !== 410) {
      const text = await res.text().catch(() => '');
      throw new Error(`Trino DELETE nextUri failed (${res.status}): ${text}`);
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
const trinoPublicUrl = env.STACKABLE_COCKPIT_TRINO_PUBLIC_URL;
const authType = (env.STACKABLE_COCKPIT_TRINO_AUTH_TYPE ?? 'none') as 'none' | 'basic';
const authUsername = env.STACKABLE_COCKPIT_TRINO_AUTH_USERNAME;
const authPassword = env.STACKABLE_COCKPIT_TRINO_AUTH_PASSWORD;
const tlsInsecure = env.STACKABLE_COCKPIT_TRINO_TLS_INSECURE === 'true';
const tlsCaCertPath = env.STACKABLE_COCKPIT_TRINO_TLS_CA_CERT;

export const trinoUserImpersonation = env.STACKABLE_COCKPIT_TRINO_USER_IMPERSONATION !== 'false';

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
    dispatcher,
    impersonate: trinoUserImpersonation
  });

  log.info(
    {
      trino_url: trinoUrl,
      trino_public_url: trinoPublicUrl,
      auth_type: authType,
      tls_insecure: tlsInsecure,
      user_impersonation: trinoUserImpersonation
    },
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

/** Returns the Trino server URL used for server-side queries. */
export function resolveTrinoServerUrl(userId: string): string | null {
  if (trinoUrl) return trinoUrl.replace(/\/+$/, '');
  return getUserTrinoUrl(userId);
}

/** Public (browser-facing) Trino URL for UI deep links; falls back to the query URL. */
export function resolveTrinoPublicUrl(userId: string): string | null {
  if (trinoPublicUrl) return trinoPublicUrl.replace(/\/+$/, '');
  return resolveTrinoServerUrl(userId);
}

// --- Metadata helper ---

/** Save-time connection-test timeout. */
export const CONN_TEST_TIMEOUT_MS = 10_000;

/**
 * Submit a SQL query and drain all pages, returning columns and rows.
 * An optional AbortSignal bounds the whole submit/poll run.
 */
export async function trinoMetadataQuery(
  client: TrinoClient,
  sql: string,
  options: { user: string; catalog?: string; schema?: string },
  signal?: AbortSignal
): Promise<{ columns: TrinoColumn[]; rows: unknown[][] }> {
  let result = await client.submit(sql, { ...options, signal });

  let columns: TrinoColumn[] = result.columns ?? [];
  const rows: unknown[][] = result.data ? [...result.data] : [];

  if (result.error) {
    throw new Error(result.error.message);
  }

  while (result.nextUri) {
    result = await client.poll(result.nextUri, { user: options.user, signal });

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
