import { logger } from '$lib/server/logging';

const log = logger.child({ module: 'trino-client' });

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

export const MAX_CLIENT_ROWS = 10_000;

// --- Connection store (in-memory, single-instance) ---

interface ConnectionConfig {
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
