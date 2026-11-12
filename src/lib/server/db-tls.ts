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
 * - `verify-full`: TLS with certificate and host name verification against the process-wide
 *   trust store, which includes `STACKABLE_COCKPIT_TLS_CA_CERTS` (see `ca-certs.ts`).
 * - `require`: TLS without certificate verification (encrypts, but doesn't authenticate the server).
 * - `disable`: no TLS.
 */
export function databaseSsl(mode: DatabaseTlsMode): ConnectionOptions | false {
  if (mode === 'disable') return false;
  return { rejectUnauthorized: mode === 'verify-full' };
}
