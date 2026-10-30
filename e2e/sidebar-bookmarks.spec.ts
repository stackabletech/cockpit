import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.js';
import { waitForHydration } from './support/helpers';
import { resetBookmarks } from './support/bookmarks.js';

test.describe('Sidebar bookmarks', () => {
  test.use({ locale: 'en-US' });

  const BOOKMARK_URL = 'https://superset.example.com';

  // Bookmarks are also shown on the dashboard, so scope link lookups to the sidebar.
  const sidebarNav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });

  test.skip(
    ({ viewport }) => (viewport?.width ?? 1280) < 1024,
    'Sidebar is off-canvas on small screens'
  );

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('sidebar_tools_open'));
    await resetBookmarks(page, [
      { productId: 'superset', name: 'Dashboards', url: BOOKMARK_URL },
      {
        productId: 'airflow',
        name: 'Pipelines',
        url: 'https://airflow.example.com',
        pinned: true
      }
    ]);
  });

  test.afterEach(async ({ page }) => {
    await resetBookmarks(page);
  });

  test('shows pinned bookmarks in Favourites and the rest in Tools', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    // The pinned global bookmark from .env.test always shows Favourites, so check
    // which list each of the user's bookmarks lands in.
    const listWith = (name: string) =>
      sidebarNav(page)
        .getByRole('list')
        .filter({ has: page.getByRole('link', { name }) });
    await expect(page.getByText('Favourites')).toBeVisible();
    await expect(listWith('Pipelines')).toBeVisible();
    await expect(listWith('Pipelines').getByRole('link', { name: 'Dashboards' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Tools', exact: true })).toBeVisible();
    await expect(listWith('Trino').getByRole('link', { name: 'Dashboards' })).toBeVisible();
    await expect(listWith('Trino').getByRole('link', { name: 'Pipelines' })).toHaveCount(0);
  });

  test('opens each bookmark in a new tab', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    const dashboardsLink = sidebarNav(page).getByRole('link', { name: 'Dashboards' });
    await expect(dashboardsLink).toHaveAttribute('href', BOOKMARK_URL);
    await expect(dashboardsLink).toHaveAttribute('target', '_blank');
    await expect(dashboardsLink).toHaveAttribute('rel', /noopener/);
    await expect(dashboardsLink).toHaveAttribute('rel', /external/);
    await expect(dashboardsLink).not.toHaveAttribute('aria-current');
  });

  test('inbuilt tools have no external link button', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    const trinoLink = sidebarNav(page).getByRole('link', { name: 'Trino' });
    await expect(trinoLink).toBeVisible();
    await expect(trinoLink.locator('..').getByRole('link')).toHaveCount(1);
  });

  test('follows pin changes made on the dashboard without a page reload', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);
    // Lost on a full page load, so it proves the sidebar updated in place.
    await page.evaluate(() => ((window as unknown as { noReload: boolean }).noReload = true));

    // With Tools collapsed, only pinned bookmarks remain visible in the sidebar.
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    const dashboardsLink = sidebarNav(page).getByRole('link', { name: 'Dashboards' });
    await expect(dashboardsLink).not.toBeVisible();

    await page.getByRole('button', { name: 'Pin bookmark Dashboards' }).click();
    await expect(dashboardsLink).toBeVisible();

    await page.getByRole('button', { name: 'Unpin bookmark Dashboards' }).click();
    await expect(dashboardsLink).not.toBeVisible();

    expect(await page.evaluate(() => (window as unknown as { noReload?: boolean }).noReload)).toBe(
      true
    );
  });

  test('tools section is collapsible', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    // The accessible name matches the visible label; aria-expanded carries the state.
    const toggle = page.getByRole('button', { name: 'Tools', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebarNav(page).getByRole('link', { name: 'Dashboards' })).not.toBeVisible();
    await expect(sidebarNav(page).getByRole('link', { name: 'Trino' })).not.toBeVisible();
    await expect(sidebarNav(page).getByRole('link', { name: 'Pipelines' })).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebarNav(page).getByRole('link', { name: 'Dashboards' })).toBeVisible();
    await expect(sidebarNav(page).getByRole('link', { name: 'Trino' })).toBeVisible();
  });
});
