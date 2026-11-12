import { Agent } from 'undici';
import { logger } from '$lib/server/logging';
import { TrinoClient, buildBasicAuthHeader, trinoUserImpersonation } from './client.js';
import { trinoConfig } from './config.js';

const log = logger.child({ module: 'trino-user-clients' });

export interface UserConnectionConfig {
  url: string;
  authType: 'none' | 'basic';
  username: string;
  password: string;
  /** Skip TLS certificate verification. Only allowed with `STACKABLE_COCKPIT_TRINO_ALLOW_INSECURE_TLS`. */
  tlsInsecure: boolean;
}

interface UserEntry {
  client: TrinoClient;
  url: string;
}

const userClients = new Map<string, UserEntry>();

// Shared by all per-user connections that skip verification, so they reuse one set of
// connection pools. Verifying connections use the default dispatcher, which trusts the
// private CAs from STACKABLE_COCKPIT_TLS_CA_CERTS via the process-wide trust store.
let insecureDispatcher: Agent | undefined;

function dispatcherFor(tlsInsecure: boolean): Agent | undefined {
  if (!tlsInsecure) return undefined;
  insecureDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureDispatcher;
}

/** Build a per-user Trino client from a connection config without storing it. */
export function buildUserTrinoClient(config: UserConnectionConfig): TrinoClient {
  if (config.tlsInsecure && !trinoConfig.allowInsecureTls) {
    throw new Error('Skipping TLS certificate verification is not allowed');
  }

  const authorization =
    config.authType === 'basic' && config.username && config.password
      ? buildBasicAuthHeader(config.username, config.password)
      : undefined;

  return new TrinoClient({
    serverUrl: config.url,
    authorization,
    dispatcher: dispatcherFor(config.tlsInsecure),
    impersonate: trinoUserImpersonation
  });
}

/** Create or replace the per-user Trino connection. */
export function createUserTrinoClient(userId: string, config: UserConnectionConfig): void {
  const client = buildUserTrinoClient(config);
  userClients.set(userId, { client, url: config.url });
  const context = {
    user_id: userId,
    trino_url: config.url,
    tls_insecure: config.tlsInsecure
  };
  if (config.tlsInsecure) {
    log.warn(context, 'user connection created without TLS certificate verification');
  } else {
    log.info(context, 'user connection created');
  }
}

/** Returns the per-user TrinoClient, or null if none has been configured. */
export function getUserTrinoClient(userId: string): TrinoClient | null {
  return userClients.get(userId)?.client ?? null;
}

/** Returns the per-user connection URL, or null if none has been configured. */
export function getUserTrinoUrl(userId: string): string | null {
  return userClients.get(userId)?.url ?? null;
}
