import { test, expect } from '@playwright/test';

declare const process: {
  env: Record<string, string | undefined>;
};

/**
 * Database connectivity E2E tests.
 *
 * These tests only run when `POSTGRES_E2E_AVAILABLE=true` is set in the
 * environment — written by the "Start PostgreSQL" CI step via
 * `run-postgres-tests.sh`. They are automatically skipped in all other
 * environments.
 *
 * The tests call the `/healthz/db` endpoint which performs a real query
 * against the database, verifying both connectivity and that migrations
 * have been applied.
 */
test.describe('Database connectivity', () => {
  test.beforeEach(() => {
    test.skip(
      process.env.POSTGRES_E2E_AVAILABLE !== 'true',
      'Skipped: PostgreSQL not available (requires POSTGRES_E2E_AVAILABLE=true)'
    );
  });

  test('GET /healthz/db returns 200 and reports the database as healthy', async ({ request }) => {
    const response = await request.get('/healthz/db');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ status: 'ok' });
  });
});
