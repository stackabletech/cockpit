import { test, expect } from '@playwright/test';
import { waitForHydration } from './support/helpers';

test.describe('OPA admin gating for bookmarks', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('dashboard_bookmarks');
    });
  });

  test('admin can pin a bookmark for everyone', async ({ page }, testInfo) => {
    // Only the `admin` project logs in with an admin OIDC profile that the
    // mock OPA server grants admin rights.
    test.skip(testInfo.project.name !== 'admin', 'requires an admin session');

    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Add Bookmark' }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    const pinEveryone = page.getByRole('checkbox', { name: /pin bookmark for everyone/i });
    await expect(pinEveryone).toBeEnabled();
    await pinEveryone.check();

    await page.getByLabel('Name').fill('Shared Dashboard');
    await page.getByLabel('URL').fill('https://superset.example.com');
    await page.locator('dialog[open]').getByRole('button', { name: 'Add Bookmark' }).click();

    const stored = await page.evaluate(() => localStorage.getItem('dashboard_bookmarks'));
    expect(stored).toBeTruthy();
    const bookmarks = JSON.parse(stored!);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0].pinnedForEveryone).toBe(true);
  });

  test('non-admin cannot pin a bookmark for everyone', async ({ page }, testInfo) => {
    // The admin project is the only one with an admin session.
    test.skip(testInfo.project.name === 'admin', 'requires a non-admin session');

    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Add Bookmark' }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    const pinEveryone = page.getByRole('checkbox', { name: /pin bookmark for everyone/i });
    await expect(pinEveryone).toBeDisabled();

    // The admin-only hint is shown to regular users.
    await expect(
      page.getByText('Only administrators can pin bookmarks for everyone')
    ).toBeVisible();
  });

  test('OPA request metrics are exposed on /metrics', async ({ page }, testInfo) => {
    // Run once to avoid duplicating the check across every browser project.
    test.skip(testInfo.project.name !== 'chromium', 'only check metrics on the chromium project');

    const response = await page.request.get('/metrics');
    expect(response.ok()).toBeTruthy();
    const body = await response.text();
    expect(body).toContain('opa_request_total');
  });
});
