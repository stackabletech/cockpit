import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';

// Kept free of SvelteKit imports: drizzle.config.ts uses it outside Vite.

const DATABASE_TLS_MODES = ['verify-full', 'require', 'disable'] as const;
export type DatabaseTlsMode = (typeof DATABASE_TLS_MODES)[number];

type DatabaseTlsEnv = Record<string, string | undefined>;

/**
 * Resolves the TLS mode for the PostgreSQL connection. Production defaults to
 * `verify-full`, everything else to `disable`.
 */
export function databaseTlsMode(env: DatabaseTlsEnv, isProduction: boolean): DatabaseTlsMode {
  const raw = env.DATABASE_TLS_MODE?.trim();
  if (!raw) return isProduction ? 'verify-full' : 'disable';
  if (!(DATABASE_TLS_MODES as readonly string[]).includes(raw)) {
    throw new Error(
      `DATABASE_TLS_MODE must be one of ${DATABASE_TLS_MODES.join(', ')} (got "${raw}")`
    );
  }
  return raw as DatabaseTlsMode;
}

/**
 * Builds the `ssl` option for node-postgres.
 *
 * - `verify-full`: TLS with certificate and host name verification. The certificate must chain
 *   to `DATABASE_TLS_CA_CERT` if set (which replaces the default CAs), otherwise to the CAs
 *   bundled with Node.js.
 * - `require`: TLS without certificate verification (encrypts, but doesn't authenticate the server).
 * - `disable`: no TLS.
 *
 * A CA certificate with any mode but `verify-full` is rejected: it would be ignored silently.
 */
export function databaseSsl(env: DatabaseTlsEnv, mode: DatabaseTlsMode): ConnectionOptions | false {
  const caCertPath = env.DATABASE_TLS_CA_CERT?.trim();
  if (caCertPath && mode !== 'verify-full') {
    throw new Error(
      `DATABASE_TLS_CA_CERT requires DATABASE_TLS_MODE=verify-full (got "${mode}"), otherwise it is ignored`
    );
  }
  if (mode === 'disable') return false;
  return {
    rejectUnauthorized: mode === 'verify-full',
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CA certificate path from the deployment configuration
    ...(caCertPath ? { ca: readFileSync(caCertPath) } : {})
  };
}
