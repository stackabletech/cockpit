// Trino connection and query settings. Parsed once at module init so a typo
// fails at startup instead of silently changing TLS or impersonation behaviour.

import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { envBoolean, envInteger, envString, envUrl, parseEnv } from '$lib/env-schema.js';

const schema = z
  .object({
    STACKABLE_COCKPIT_TRINO_URL: envUrl,
    STACKABLE_COCKPIT_TRINO_PUBLIC_URL: envUrl,
    STACKABLE_COCKPIT_TRINO_AUTH_TYPE: envString.pipe(z.enum(['none', 'basic']).default('none')),
    STACKABLE_COCKPIT_TRINO_AUTH_USERNAME: envString,
    STACKABLE_COCKPIT_TRINO_AUTH_PASSWORD: envString,
    STACKABLE_COCKPIT_TRINO_TLS_INSECURE: envBoolean(false),
    STACKABLE_COCKPIT_TRINO_TLS_CA_CERT: envString,
    STACKABLE_COCKPIT_TRINO_USER_IMPERSONATION: envBoolean(true),
    STACKABLE_COCKPIT_QUERY_TTL: envInteger(1800)
  })
  .refine(
    (config) =>
      !config.STACKABLE_COCKPIT_TRINO_URL ||
      config.STACKABLE_COCKPIT_TRINO_AUTH_TYPE !== 'basic' ||
      (config.STACKABLE_COCKPIT_TRINO_AUTH_USERNAME &&
        config.STACKABLE_COCKPIT_TRINO_AUTH_PASSWORD),
    {
      path: ['STACKABLE_COCKPIT_TRINO_AUTH_TYPE'],
      message:
        'is "basic" but STACKABLE_COCKPIT_TRINO_AUTH_USERNAME or STACKABLE_COCKPIT_TRINO_AUTH_PASSWORD is missing'
    }
  );

export function parseTrinoConfig(env: Record<string, string | undefined>) {
  const config = parseEnv(schema, env);
  return {
    url: config.STACKABLE_COCKPIT_TRINO_URL,
    publicUrl: config.STACKABLE_COCKPIT_TRINO_PUBLIC_URL,
    authType: config.STACKABLE_COCKPIT_TRINO_AUTH_TYPE,
    authUsername: config.STACKABLE_COCKPIT_TRINO_AUTH_USERNAME,
    authPassword: config.STACKABLE_COCKPIT_TRINO_AUTH_PASSWORD,
    tlsInsecure: config.STACKABLE_COCKPIT_TRINO_TLS_INSECURE,
    tlsCaCertPath: config.STACKABLE_COCKPIT_TRINO_TLS_CA_CERT,
    userImpersonation: config.STACKABLE_COCKPIT_TRINO_USER_IMPERSONATION,
    queryTtlSeconds: config.STACKABLE_COCKPIT_QUERY_TTL
  };
}

/** Trino settings from the environment. The connection fields are only used
 *  when `STACKABLE_COCKPIT_TRINO_URL` is set; otherwise users configure their
 *  own connection. Impersonation also applies to those per-user connections. */
export const trinoConfig = parseTrinoConfig(env);
