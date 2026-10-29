import { expect, type Page } from '@playwright/test';

interface BookmarkSeed {
  productId: string;
  name: string;
  url: string;
  environment?: string;
  pinned?: boolean;
}

/**
 * Replace the signed-in worker user's bookmarks through the API. Bookmarks are
 * stored per user and each worker reuses one user for all of its tests, so
 * bookmark tests reset them before and after: leftovers would show up in the
 * sidebar of every later test in the worker (e.g. a "Dashboards" bookmark next
 * to the "Dashboard" nav link).
 */
export async function resetBookmarks(page: Page, seeds: BookmarkSeed[] = []): Promise<void> {
  const listed = await page.request.get('/api/bookmarks');
  expect(listed.status()).toBe(200);
  for (const { id } of (await listed.json()) as { id: string }[]) {
    expect((await page.request.delete(`/api/bookmarks/${id}`)).status()).toBe(204);
  }
  for (const seed of seeds) {
    const created = await page.request.post('/api/bookmarks', {
      data: { environment: '', pinned: false, ...seed }
    });
    expect(created.status()).toBe(201);
  }
}
