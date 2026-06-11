import { test, expect } from '@playwright/test';
import { Client } from 'pg';

declare const process: {
  env: Record<string, string | undefined>;
};

test.describe('Database connectivity', () => {
  test.beforeEach(() => {
    test.skip(
      process.env.POSTGRES_E2E_AVAILABLE !== 'true',
      'Skipped: PostgreSQL not available (requires POSTGRES_E2E_AVAILABLE=true)'
    );
  });

  test('connects to the database and reports the database as healthy', async () => {
    const client = new Client({
      host: process.env.DATABASE_HOST ?? 'localhost',
      port: parseInt(process.env.DATABASE_PORT ?? '31432', 10),
      database: process.env.DATABASE_NAME ?? 'cockpit',
      user: process.env.DATABASE_USER ?? 'cockpit',
      password: process.env.DATABASE_PASSWORD ?? 'cockpit-test-password',
      ssl: false
    });

    await client.connect();
    try {
      await client.query('SELECT 1 FROM user_storage_connections LIMIT 0');
    } finally {
      await client.end();
    }

    expect(true).toBe(true);
  });
});
