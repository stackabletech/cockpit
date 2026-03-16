import { logger } from '$lib/server/logging';

const log = logger.child({ module: 'trino-client' });

export const POLL_TIMEOUT_MS = 30_000;

export interface TrinoColumn {
  name: string;
  type: string;
}

export interface TrinoStats {
  state: string;
  progressPercentage?: number;
  nodes?: number;
  totalSplits?: number;
  runningSplits?: number;
  completedSplits?: number;
  processedRows?: number;
  processedBytes?: number;
  elapsedTimeMillis?: number;
}

export interface TrinoResponse {
  id?: string;
  nextUri?: string;
  columns?: TrinoColumn[];
  data?: unknown[][];
  stats?: TrinoStats;
  error?: { message: string; errorCode: number };
}

export type AuthConfig = { type: 'none' } | { type: 'basic'; username: string; password: string };

// --- Connection store (in-memory, single-instance) ---

export interface ConnectionConfig {
  connectionUrl: string;
  auth: AuthConfig;
  impersonateUser?: string;
}

let activeConnection: ConnectionConfig | null = null;

export function setConnection(config: ConnectionConfig): void {
  log.info({ trino_url: config.connectionUrl }, 'connection saved');
  activeConnection = config;
}

export function getConnection(): ConnectionConfig | null {
  return activeConnection;
}

export function clearConnection(): void {
  activeConnection = null;
}

// --- SSRF protection ---

export function validateTargetUrl(targetUrl: string, connectionUrl: string): boolean {
  try {
    const target = new URL(targetUrl);
    const allowed = new URL(connectionUrl);
    return (
      target.protocol === allowed.protocol &&
      target.hostname === allowed.hostname &&
      target.port === allowed.port
    );
  } catch {
    return false;
  }
}

// --- HTTP helpers ---

export function buildAuthHeaders(auth: AuthConfig): Record<string, string> {
  if (auth.type === 'basic') {
    const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
    return {
      'X-Trino-User': auth.username,
      Authorization: `Basic ${encoded}`
    };
  }
  return { 'X-Trino-User': 'anonymous' };
}

export async function trinoFetch(
  url: string,
  auth: AuthConfig,
  options?: RequestInit,
  impersonateUser?: string
): Promise<TrinoResponse> {
  const headers: Record<string, string> = {
    ...buildAuthHeaders(auth),
    'X-Trino-Source': 'stackable-ui',
    ...((options?.headers as Record<string, string>) ?? {})
  };
  if (impersonateUser) {
    headers['X-Trino-User'] = impersonateUser;
  }
  const res = await fetch(url, {
    ...options,
    headers
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Trino HTTP ${res.status}: ${text}`);
  }

  // Trino returns 204 with no body on DELETE (cancel).
  if (res.status === 204) {
    return {};
  }

  return res.json() as Promise<TrinoResponse>;
}

export interface TrinoQueryOptions {
  impersonateUser?: string;
  contextHeaders?: Record<string, string>;
  maxRows?: number;
}

/**
 * Execute a SQL statement against Trino and poll until all results are collected.
 * Throws on Trino errors or timeout.
 */
export async function trinoQuery(
  connectionUrl: string,
  auth: AuthConfig,
  sql: string,
  options?: TrinoQueryOptions
): Promise<{ columns: TrinoColumn[]; rows: unknown[][] }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let columns: TrinoColumn[] = [];
  const rows: unknown[][] = [];
  const maxRows = options?.maxRows ?? Infinity;

  let nextUri: string | undefined = `${connectionUrl}/v1/statement`;
  let fetchOptions: RequestInit | undefined = {
    method: 'POST',
    body: sql,
    headers: { 'Content-Type': 'text/plain', ...options?.contextHeaders }
  };

  while (nextUri && rows.length < maxRows) {
    if (Date.now() > deadline) {
      throw new Error('query timed out');
    }

    const response = await trinoFetch(nextUri, auth, fetchOptions, options?.impersonateUser);

    if (response.error) {
      throw new Error(response.error.message);
    }

    if (response.columns && columns.length === 0) columns = response.columns;
    if (response.data) rows.push(...response.data);

    nextUri = response.nextUri;
    fetchOptions = undefined;
  }

  return { columns, rows };
}
