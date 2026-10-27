import { test, expect } from './support/fixtures.js';
import { waitForHydration } from './support/helpers.js';

/**
 * Bookmark API end to end against the real database: the create/list/update/
 * delete lifecycle and per-user isolation. Request validation and the 401
 * without a user are covered by the unit tests next to the route handlers;
 * the 401 without a session by the generic API guard tests.
 */
test.describe('Bookmarks API', () => {
  // BOOKMARK_LIMIT in src/lib/dashboard/types.ts.
  const BOOKMARK_LIMIT = 25;
  const FIELDS = {
    productId: 'trino',
    name: 'API Trino',
    environment: 'prod',
    url: 'https://trino.example.com',
    pinned: false
  };

  test('creates, lists, updates and deletes a bookmark', async ({ page }) => {
    const created = await page.request.post('/api/bookmarks', { data: FIELDS });
    expect(created.status()).toBe(201);
    const bookmark = await created.json();
    expect(bookmark).toEqual({
      ...FIELDS,
      id: expect.any(String),
      createdAt: expect.any(String)
    });

    try {
      const listed = await page.request.get('/api/bookmarks');
      expect(listed.status()).toBe(200);
      expect(await listed.json()).toContainEqual(bookmark);

      const updated = await page.request.patch(`/api/bookmarks/${bookmark.id}`, {
        data: { pinned: true, name: 'Renamed Trino' }
      });
      expect(updated.status()).toBe(200);
      expect(await updated.json()).toEqual({ ...bookmark, pinned: true, name: 'Renamed Trino' });
    } finally {
      const deleted = await page.request.delete(`/api/bookmarks/${bookmark.id}`);
      expect(deleted.status()).toBe(204);
    }

    const listed = await page.request.get('/api/bookmarks');
    expect((await listed.json()).map((b: { id: string }) => b.id)).not.toContain(bookmark.id);
    const deletedAgain = await page.request.delete(`/api/bookmarks/${bookmark.id}`);
    expect(deletedAgain.status()).toBe(404);
  });

  test('rejects bookmarks beyond the per-user limit with 409', async ({ page }) => {
    const existing = (await (await page.request.get('/api/bookmarks')).json()).length;
    const created: string[] = [];
    try {
      for (let i = existing; i < BOOKMARK_LIMIT; i++) {
        const response = await page.request.post('/api/bookmarks', {
          data: { ...FIELDS, name: `Limit ${i}` }
        });
        expect(response.status()).toBe(201);
        created.push((await response.json()).id);
      }

      const rejected = await page.request.post('/api/bookmarks', { data: FIELDS });
      expect(rejected.status()).toBe(409);
    } finally {
      for (const id of created) await page.request.delete(`/api/bookmarks/${id}`);
    }
  });

  test('keeps bookmarks private to their owner', async ({ page, browser, baseURL }) => {
    const bookmark = await (await page.request.post('/api/bookmarks', { data: FIELDS })).json();

    // The mock OIDC server issues a new user for every login.
    const otherContext = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] }
    });
    try {
      const other = await otherContext.newPage();
      await other.goto('/');
      await waitForHydration(other);
      await other.getByRole('button', { name: /sign in with sso/i }).click();
      await expect(other).toHaveURL('/');

      const listed = await other.request.get('/api/bookmarks');
      expect((await listed.json()).map((b: { id: string }) => b.id)).not.toContain(bookmark.id);
      const patched = await other.request.patch(`/api/bookmarks/${bookmark.id}`, {
        data: { pinned: true }
      });
      expect(patched.status()).toBe(404);
      const deleted = await other.request.delete(`/api/bookmarks/${bookmark.id}`);
      expect(deleted.status()).toBe(404);

      const owned = await page.request.get('/api/bookmarks');
      expect(await owned.json()).toContainEqual(bookmark);
    } finally {
      await otherContext.close();
      await page.request.delete(`/api/bookmarks/${bookmark.id}`);
    }
  });
});
