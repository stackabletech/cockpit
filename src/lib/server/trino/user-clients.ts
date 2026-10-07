import { logger } from '$lib/server/logging';
import { TrinoClient, buildBasicAuthHeader, trinoUserImpersonation } from './client.js';

const log = logger.child({ module: 'trino-user-clients' });

export interface UserConnectionConfig {
  url: string;
  authType: 'none' | 'basic';
  username: string;
  password: string;
}

interface UserEntry {
  client: TrinoClient;
  url: string;
}

const userClients = new Map<string, UserEntry>();

/** Build a per-user Trino client from a connection config without storing it. */
export function buildUserTrinoClient(config: UserConnectionConfig): TrinoClient {
  const authorization =
    config.authType === 'basic' && config.username && config.password
      ? buildBasicAuthHeader(config.username, config.password)
      : undefined;

  return new TrinoClient({
    serverUrl: config.url,
    authorization,
    impersonate: trinoUserImpersonation
  });
}

/** Create or replace the per-user Trino connection. */
export function createUserTrinoClient(userId: string, config: UserConnectionConfig): void {
  const client = buildUserTrinoClient(config);
  userClients.set(userId, { client, url: config.url });
  log.info({ user_id: userId, trino_url: config.url }, 'user connection created');
}

/** Returns the per-user TrinoClient, or null if none has been configured. */
export function getUserTrinoClient(userId: string): TrinoClient | null {
  return userClients.get(userId)?.client ?? null;
}

/** Returns the per-user connection URL, or null if none has been configured. */
export function getUserTrinoUrl(userId: string): string | null {
  return userClients.get(userId)?.url ?? null;
}
