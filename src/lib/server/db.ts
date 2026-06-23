import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { logger } from './logging';

const log = logger.child({ module: 'database' });

// Parse connection credentials from environment variables
const dbHost = process.env.DATABASE_HOST || 'localhost';
const dbPort = parseInt(process.env.DATABASE_PORT || '31432', 10);
const dbName = process.env.DATABASE_NAME || 'cockpit';
const dbUser = process.env.DATABASE_USER || 'cockpit';
const dbPassword = process.env.DATABASE_PASSWORD || 'cockpit-dev-password';

if (!dbPassword) {
  log.warn('DATABASE_PASSWORD not set, connection may fail');
}

// SSL: explicit DATABASE_SSL env var takes precedence; otherwise enabled in production.
const sslMode =
  process.env.DATABASE_SSL !== undefined
    ? process.env.DATABASE_SSL === 'true'
    : process.env.NODE_ENV === 'production';

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
