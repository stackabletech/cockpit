import { defineConfig } from 'drizzle-kit';

const isDev = process.env.NODE_ENV !== 'production';

export default defineConfig({
  schema: ['./src/lib/server/schema.ts', './src/lib/server/auth-schema.ts'],
  out: './src/lib/server/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? 31432),
    database: process.env.DATABASE_NAME ?? 'cockpit',
    user: process.env.DATABASE_USER ?? 'cockpit',
    password: process.env.DATABASE_PASSWORD ?? 'cockpit-dev-password',
    ssl: !isDev
  }
});
