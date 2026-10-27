import { test, expect } from './support/fixtures.js';
import { waitForHydration } from './support/helpers';
import { resetBookmarks } from './support/bookmarks.js';

// Form validation, dialog behaviour and card rendering are covered by the
// AddBookmarkModal and DashboardBookmarks component tests. These tests cover
// the flows through the server and the real page layout.
test.describe('Dashboard bookmarks', () => {
  test.use({ locale: 'en-US' });

  const addButton = 'Add bookmark';

  test.beforeEach(async ({ page }) => {
    await resetBookmarks(page);
  });

  test.afterEach(async ({ page }) => {
    await resetBookmarks(page);
  });

  test('adds a bookmark and stores it on the server, not in the browser', async ({
    page,
    browser,
    baseURL,
    workerStorageState
  }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: addButton }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.locator('button[aria-pressed]').filter({ hasText: 'Superset' }).click();
    await page.getByLabel('Name').fill('Dashboards');
    await page.getByLabel('URL').fill('https://superset.example.com');

    await page.locator('dialog[open]').getByRole('button', { name: addButton }).click();

    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.getByLabel('Bookmarks').getByText('Dashboards')).toBeVisible();
    await expect(page.getByText('superset.example.com')).toBeVisible();

    // A fresh browser context shares only the session cookie, no browser storage.
    const context = await browser.newContext({ baseURL, storageState: workerStorageState });
    try {
      const other = await context.newPage();
      await other.goto('/');
      await expect(other.getByLabel('Bookmarks').getByText('Dashboards')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('accepts internal URLs such as IP addresses and service names', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: addButton }).click();
    await page.getByLabel('Name').fill('Trino NodePort');
    await page.getByLabel('URL').fill('http://10.0.0.5:30443');
    await page.locator('dialog[open]').getByRole('button', { name: addButton }).click();

    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(
      page.getByLabel('Bookmarks').getByRole('link', { name: 'Trino NodePort' })
    ).toHaveAttribute('href', 'http://10.0.0.5:30443');
  });

  test('truncates long names and hostnames instead of overlapping the card buttons', async ({
    page
  }) => {
    // Names are capped at 40 characters; wide glyphs still overflow the card.
    const longName = 'W'.repeat(40);
    const longHost = `${'very-long-subdomain-'.repeat(5)}example.com`;
    await resetBookmarks(page, [
      { productId: 'superset', name: longName, url: `https://${longHost}/` }
    ]);

    await page.goto('/');
    await waitForHydration(page);

    const section = page.getByLabel('Bookmarks');
    const starBox = await section.getByRole('button', { name: 'Pin bookmark' }).boundingBox();
    const titleBox = await section.getByRole('link', { name: longName }).boundingBox();
    const hostBox = await section.getByText(longHost).boundingBox();

    expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(starBox!.x);
    expect(hostBox!.x + hostBox!.width).toBeLessThanOrEqual(starBox!.x);
  });

  test('pins via the dialog checkbox and unpins with the star button', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: addButton }).click();
    await page.getByLabel('Name').fill('Dashboards');
    await page.getByLabel('URL').fill('https://superset.example.com');
    await page.locator('dialog[open]').getByRole('checkbox', { name: 'Pin bookmark' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: addButton }).click();

    const unpin = page.getByRole('button', { name: 'Unpin bookmark Dashboards' });
    const pin = page.getByRole('button', { name: 'Pin bookmark Dashboards' });
    await expect(unpin).toBeVisible();

    // The edit dialog shows the stored pinned state.
    await page.getByRole('button', { name: 'Edit bookmark Dashboards' }).click();
    await expect(
      page.locator('dialog[open]').getByRole('checkbox', { name: 'Pin bookmark' })
    ).toBeChecked();
    await page.locator('dialog[open]').getByRole('button', { name: 'Cancel' }).click();

    await unpin.click();
    await expect(pin).toBeVisible();
    await pin.click();
    await expect(unpin).toBeVisible();
  });

  test('edits a bookmark', async ({ page }) => {
    await resetBookmarks(page, [
      { productId: 'superset', name: 'Dashboards', url: 'https://superset.example.com' }
    ]);
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Edit bookmark Dashboards' }).click();
    await page.getByLabel('Name').fill('Renamed Dashboard');
    await page.locator('dialog[open]').getByRole('button', { name: 'Save changes' }).click();

    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.getByLabel('Bookmarks').getByText('Renamed Dashboard')).toBeVisible();
    await expect(page.getByLabel('Bookmarks').getByText('Dashboards')).not.toBeVisible();
  });

  test('deletes a bookmark from the edit dialog after confirmation', async ({ page }) => {
    await resetBookmarks(page, [
      { productId: 'superset', name: 'Dashboards', url: 'https://superset.example.com' }
    ]);
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Edit bookmark Dashboards' }).click();
    const editDialog = page.getByRole('dialog', { name: 'Edit bookmark' });
    const confirmDialog = page.getByRole('dialog', { name: 'Delete bookmark?' });
    await editDialog.getByRole('button', { name: 'Delete' }).click();
    await confirmDialog.getByRole('button', { name: 'Delete' }).click();

    await expect(confirmDialog).toBeHidden();
    await expect(editDialog).toBeHidden();
    await expect(page.getByLabel('Bookmarks').getByText('Dashboards')).not.toBeVisible();
  });
});
