import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { logger } from './logging';
import { databaseSsl, databaseTlsMode } from './db-tls';

const log = logger.child({ module: 'database' });

// Vite loads .env.development into SvelteKit's env, not process.env.
// The fallback also supports the standalone migration CLI used by dev/setup.sh.
const envModule = await import('$env/dynamic/private').catch(() => null);
const env = envModule?.env ?? process.env;

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !env.DATABASE_PASSWORD) {
  throw new Error('DATABASE_PASSWORD must be set in production');
}

// Parse connection credentials from environment variables
const dbHost = env.DATABASE_HOST || 'localhost';
const dbPort = parseInt(env.DATABASE_PORT || '31432', 10);
const dbName = env.DATABASE_NAME || 'cockpit';
const dbUser = env.DATABASE_USER || 'cockpit';
if (!env.DATABASE_PASSWORD) {
  log.warn('DATABASE_PASSWORD not set, using default development password');
}
const dbPassword = env.DATABASE_PASSWORD || 'cockpit-dev-password';

// DATABASE_TLS_MODE: verify-full (production default), require or disable (development default).
// For a private CA, set DATABASE_TLS_CA_CERT to the mounted CA certificate path.
const tlsMode = databaseTlsMode(env, isProduction);
if (isProduction && tlsMode !== 'verify-full') {
  log.warn(
    { tls_mode: tlsMode },
    tlsMode === 'disable'
      ? 'Database TLS is disabled'
      : 'Database TLS certificate verification is disabled'
  );
}
log.debug({ tls_mode: tlsMode, tls_ca_cert: env.DATABASE_TLS_CA_CERT || null }, 'Database TLS');
const sslMode = databaseSsl(env, tlsMode);

// Create a connection pool
const pool = new Pool({
  host: dbHost,
  port: dbPort,
  database: dbName,
  user: dbUser,
  password: dbPassword,
  ssl: sslMode,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

pool.on('error', (err) => {
  log.error({ error: err }, 'Unexpected error on idle client');
});

// Create Drizzle instance
export const db = drizzle({ client: pool });

// Graceful shutdown
export async function closeDb(): Promise<void> {
  try {
    await pool.end();
    log.info('Database pool closed');
  } catch (error) {
    log.error({ error }, 'Error closing database pool');
  }
}
