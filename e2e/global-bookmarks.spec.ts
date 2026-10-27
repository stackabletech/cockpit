import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.js';
import { waitForHydration } from './support/helpers';
import { resetBookmarks } from './support/bookmarks.js';

// The global bookmarks come from STACKABLE_COCKPIT_GLOBAL_BOOKMARKS in .env.test.
test.describe('Global bookmarks', () => {
  test.use({ locale: 'en-US' });

  const section = (page: Page) => page.getByLabel('Bookmarks');
  const sidebarNav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });

  test.beforeEach(async ({ page }) => {
    await resetBookmarks(page, [
      { productId: 'superset', name: 'Dashboards', url: 'https://superset.example.com' }
    ]);
  });

  test.afterEach(async ({ page }) => {
    await resetBookmarks(page);
  });

  test('shows global bookmarks before the user’s own, read-only', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    // Only the title links: the image links are hidden from assistive technology.
    await expect(section(page).getByRole('link')).toHaveText([
      'Cluster Logs',
      'Team Wiki',
      'Dashboards'
    ]);
    await expect(section(page).getByText('3 links')).toBeVisible();
    await expect(section(page).getByText('prod', { exact: true })).toBeVisible();

    for (const name of ['Cluster Logs', 'Team Wiki']) {
      await expect(section(page).getByRole('button', { name })).toHaveCount(0);
    }
    await expect(
      section(page).getByRole('button', { name: 'Edit bookmark Dashboards' })
    ).toBeVisible();
  });

  test('lists global bookmarks in the sidebar by their configured pin', async ({
    page,
    viewport
  }) => {
    test.skip((viewport?.width ?? 1280) < 1024, 'Sidebar is off-canvas on small screens');
    await page.addInitScript(() => localStorage.removeItem('sidebar_tools_open'));
    await page.goto('/');
    await waitForHydration(page);

    await expect(sidebarNav(page).getByRole('link', { name: 'Cluster Logs' })).toHaveAttribute(
      'href',
      'https://logs.example.com'
    );
    await expect(sidebarNav(page).getByRole('link', { name: 'Team Wiki' })).toBeVisible();

    // Collapsing Tools hides the unpinned global bookmark but keeps the pinned one.
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await expect(sidebarNav(page).getByRole('link', { name: 'Team Wiki' })).not.toBeVisible();
    await expect(sidebarNav(page).getByRole('link', { name: 'Cluster Logs' })).toBeVisible();
  });
});
