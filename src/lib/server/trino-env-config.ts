import { readFileSync } from 'node:fs';
import type { SecureContextOptions } from 'trino-client';
import { logger } from '$lib/server/logging';
import type { AuthConfig, ConnectionConfig } from '$lib/server/trino-config.js';

const envModule = await import('$env/dynamic/private').catch(() => null);
const env = envModule?.env ?? (process.env as Record<string, string | undefined>);

const log = logger.child({ module: 'trino-env-config' });

const trinoUrl = env.STACKABLE_UI_TRINO_URL;
const authType = (env.STACKABLE_UI_TRINO_AUTH_TYPE ?? 'none') as 'none' | 'basic';
const authUsername = env.STACKABLE_UI_TRINO_AUTH_USERNAME;
const authPassword = env.STACKABLE_UI_TRINO_AUTH_PASSWORD;
const tlsInsecure = env.STACKABLE_UI_TRINO_TLS_INSECURE === 'true';
const tlsCaCertPath = env.STACKABLE_UI_TRINO_TLS_CA_CERT;

/** True when the Trino connection is pre-configured via environment variables. */
export const trinoEnvConfigured = !!trinoUrl;

/** Pre-built SSL options from environment, or undefined when not needed. */
let sslOptions: SecureContextOptions | undefined;

if (trinoEnvConfigured) {
  if (authType === 'basic' && (!authUsername || !authPassword)) {
    throw new Error(
      'STACKABLE_UI_TRINO_AUTH_TYPE is "basic" but STACKABLE_UI_TRINO_AUTH_USERNAME or STACKABLE_UI_TRINO_AUTH_PASSWORD is missing'
    );
  }

  if (tlsInsecure || tlsCaCertPath) {
    sslOptions = {
      rejectUnauthorized: !tlsInsecure,
      ...(tlsCaCertPath ? { ca: readFileSync(tlsCaCertPath) } : {})
    };
  }

  log.info(
    { trino_url: trinoUrl, auth_type: authType, tls_insecure: tlsInsecure },
    'Trino connection configured via environment'
  );
}

/**
 * Build a ConnectionConfig from environment variables, injecting the given
 * OIDC username for X-Trino-User impersonation.
 */
export function buildEnvConnectionConfig(
  username: string,
  defaultCatalog?: string,
  defaultSchema?: string
): ConnectionConfig {
  if (!trinoUrl) {
    throw new Error('buildEnvConnectionConfig called but STACKABLE_UI_TRINO_URL is not set');
  }

  const auth: AuthConfig =
    authType === 'basic' && authUsername && authPassword
      ? { type: 'basic', username: authUsername, password: authPassword }
      : { type: 'none' };

  return {
    connectionUrl: trinoUrl,
    auth,
    username,
    defaultCatalog,
    defaultSchema,
    ssl: sslOptions
  };
}
