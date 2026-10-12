import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mockMarker, mockTrinoStatements, releaseMockTrino } from '../support/mock-trino';

/**
 * Trino API endpoints end to end: authentication through the server hooks and
 * the query lifecycle against the mock Trino. Request validation is covered by
 * the unit tests next to the route handlers.
 */
test.describe('Trino API', () => {
  test.describe('without a session', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    for (const path of [
      '/api/trino/query?tabId=00000000-0000-4000-8000-000000000000',
      '/api/trino/catalog?level=catalogs',
      '/api/trino/completion/metadata?level=catalogs'
    ]) {
      test(`redirects ${path.split('?')[0]} to the login page`, async ({ page }) => {
        const res = await page.request.get(path, { maxRedirects: 0 });

        expect(res.status()).toBe(302);
        expect(res.headers()['location']).toMatch(/^\/auth\/login\?redirectTo=/);
      });
    }
  });

  test.describe('query lifecycle', () => {
    const releases: string[] = [];

    test.afterEach(async () => {
      await Promise.all(releases.splice(0).map(releaseMockTrino));
    });

    async function snapshots(request: APIRequestContext, tabId: string, lightweight = true) {
      const res = await request.get(`/api/trino/query?tabId=${tabId}&lightweight=${lightweight}`);
      expect(res.status()).toBe(200);
      return res.json();
    }

    test('runs a statement, returns snapshots and cleans up', async ({ page }) => {
      const tabId = randomUUID();
      const sql = `SELECT 1 /* ${mockMarker()} */`;

      const submit = await page.request.post('/api/trino/query', {
        data: { statements: [sql], tabId }
      });
      expect(submit.status()).toBe(204);

      await expect
        .poll(async () =>
          (await snapshots(page.request, tabId)).map((s: { state: string }) => s.state)
        )
        .toEqual(['FINISHED']);

      const [full] = await snapshots(page.request, tabId, false);
      expect(full).toMatchObject({
        sql,
        state: 'FINISHED',
        error: null,
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'name', type: 'varchar' }
        ],
        rows: [
          [1, 'Alice'],
          [2, 'Bob'],
          [3, 'Carol']
        ]
      });
      expect(full.trinoQueryUrl).toMatch(/\/ui\/query\.html\?q-mock-\d+$/);

      const cleanup = await page.request.delete(`/api/trino/query?tabId=${tabId}&cleanup=true`);
      expect(cleanup.status()).toBe(204);
      expect(await snapshots(page.request, tabId)).toEqual([]);
    });

    test('rejects an invalid request', async ({ page }) => {
      const res = await page.request.post('/api/trino/query', {
        data: { statements: ['SELECT 1'], tabId: 'not-a-uuid' }
      });

      expect(res.status()).toBe(400);
      expect(await res.json()).toEqual({ error: expect.any(String) });
    });

    test('cancelling between statements stops the script', async ({ page }) => {
      const tabId = randomUUID();
      const marker = mockMarker();
      const gate = mockMarker();
      releases.push(gate);
      const statements = [
        `SELECT 1 /* ${marker} */`,
        `SELECT 2 /* GATE:${gate} ${marker} */`,
        `SELECT 3 /* ${marker} */`
      ];

      await page.request.post('/api/trino/query', { data: { statements, tabId } });
      // Statement 2 is held in Trino's submit, so the script has no active query.
      await expect
        .poll(() => mockTrinoStatements(marker, 'submitted'))
        .toEqual(statements.slice(0, 2));

      const cancel = await page.request.delete(`/api/trino/query?tabId=${tabId}`);
      expect(cancel.status()).toBe(204);
      await releaseMockTrino(gate);

      await expect.poll(() => mockTrinoStatements(marker, 'cancelled')).toEqual([statements[1]]);
      expect(
        (await snapshots(page.request, tabId)).map((s: { sql: string; state: string }) => [
          s.sql,
          s.state
        ])
      ).toEqual([[statements[0], 'FINISHED']]);
      // Checked last, so a script that kept going has had time to submit statement 3.
      expect(await mockTrinoStatements(marker, 'submitted')).toEqual(statements.slice(0, 2));
    });
  });
});
