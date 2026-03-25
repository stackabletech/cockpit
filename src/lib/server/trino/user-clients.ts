import { logger } from '$lib/server/logging';
import { TrinoClient, buildBasicAuthHeader } from './client.js';

const log = logger.child({ module: 'trino-user-clients' });

export interface UserConnectionConfig {
  url: string;
  authType: 'none' | 'basic';
  username: string;
  password: string;
}

interface UserEntry {
  client: TrinoClient;
  config: UserConnectionConfig;
}

const userClients = new Map<string, UserEntry>();

/** Create or replace the per-user Trino connection. */
export function setUserConnection(userId: string, config: UserConnectionConfig): void {
  const authorization =
    config.authType === 'basic' && config.username && config.password
      ? buildBasicAuthHeader(config.username, config.password)
      : undefined;

  const client = new TrinoClient({
    serverUrl: config.url,
    authorization
  });

  userClients.set(userId, { client, config });
  log.info({ user_id: userId, trino_url: config.url }, 'user connection created');
}

/** Returns the per-user TrinoClient, or null if none has been configured. */
export function getUserTrinoClient(userId: string): TrinoClient | null {
  return userClients.get(userId)?.client ?? null;
}

/** Returns the per-user connection URL, or null if none has been configured. */
export function getUserTrinoUrl(userId: string): string | null {
  return userClients.get(userId)?.config.url ?? null;
}
