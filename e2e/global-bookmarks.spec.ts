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

  // Card rendering and the read-only cards are covered by the DashboardBookmarks
  // component tests; this checks the wiring from the env var to the page.
  test('shows the configured bookmarks before the user’s own', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    // Only the title links: the image links are hidden from assistive technology.
    await expect(section(page).getByRole('link')).toHaveText([
      'Cluster Logs',
      'Team Wiki',
      'Dashboards'
    ]);
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
