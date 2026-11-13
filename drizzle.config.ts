import { defineConfig } from 'drizzle-kit';
import { trustCaCerts } from './src/lib/server/ca-certs';
import { databaseSsl, databaseTlsMode } from './src/lib/server/db-tls';

const envFile = process.env.DRIZZLE_ENV_FILE ?? '.env.development';
try {
  process.loadEnvFile(envFile);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set (load a file with DRIZZLE_ENV_FILE if needed)`);
  return value;
}

const isProduction = process.env.NODE_ENV === 'production';

trustCaCerts(process.env);

export default defineConfig({
  schema: ['./src/lib/server/schema.ts', './src/lib/server/auth-schema.ts'],
  out: './src/lib/server/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: required('DATABASE_HOST'),
    port: Number(required('DATABASE_PORT')),
    database: required('DATABASE_NAME'),
    user: required('DATABASE_USER'),
    password: required('DATABASE_PASSWORD'),
    ssl: databaseSsl(databaseTlsMode(process.env, isProduction))
  }
});
