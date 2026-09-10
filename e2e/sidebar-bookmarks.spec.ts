import { test, expect } from '@playwright/test';
import { waitForHydration } from './support/helpers';

test.describe('Sidebar bookmarks', () => {
  test.use({ locale: 'en-US' });

  const BOOKMARK_ID = 'b6d6c7b6-8f24-4c4a-9c64-4f3b7c19e6a1';
  const BOOKMARK_URL = 'https://superset.example.com';

  test.skip(
    ({ viewport }) => (viewport?.width ?? 1280) < 1024,
    'Sidebar is off-canvas on small screens'
  );

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ({ bookmarkId, bookmarkUrl }) => {
        localStorage.removeItem('dashboard_bookmarks');
        localStorage.removeItem('sidebar_tools_open');
        localStorage.setItem(
          'dashboard_bookmarks',
          JSON.stringify([
            {
              id: bookmarkId,
              productId: 'superset',
              name: 'Dashboards',
              environment: '',
              url: bookmarkUrl,
              pinned: false,
              createdAt: new Date().toISOString()
            },
            {
              id: 'e7d8c7b6-9f35-4d4b-8d75-5f4c8d2fa7b2',
              productId: 'airflow',
              name: 'Pipelines',
              environment: '',
              url: 'https://airflow.example.com',
              pinned: true,
              createdAt: new Date().toISOString()
            }
          ])
        );
      },
      { bookmarkId: BOOKMARK_ID, bookmarkUrl: BOOKMARK_URL }
    );
  });

  test('shows pinned bookmarks in Favourites and the rest in Tools', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await expect(page.getByText('Favourites')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pipelines' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse tools section' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboards' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Trino' })).toBeVisible();
  });

  test('opens each bookmark in a new tab', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    const dashboardsLink = page.getByRole('link', { name: 'Dashboards' });
    await expect(dashboardsLink).toHaveAttribute('href', BOOKMARK_URL);
    await expect(dashboardsLink).toHaveAttribute('target', '_blank');
    await expect(dashboardsLink).toHaveAttribute('rel', /noopener/);
    await expect(dashboardsLink).not.toHaveAttribute('aria-current');
  });

  test('removes the obsolete embedded launch preference from saved bookmarks', async ({ page }) => {
    await page.addInitScript(() => {
      const bookmarks = JSON.parse(localStorage.getItem('dashboard_bookmarks')!);
      bookmarks[0].openIn = 'cockpit';
      localStorage.setItem('dashboard_bookmarks', JSON.stringify(bookmarks));
    });
    await page.goto('/');
    await waitForHydration(page);

    const stored = await page.evaluate(() => localStorage.getItem('dashboard_bookmarks'));
    expect(JSON.parse(stored!)[0]).not.toHaveProperty('openIn');
  });

  test('inbuilt tools have no external link button', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    const trinoLink = page.getByRole('link', { name: 'Trino' });
    await expect(trinoLink).toBeVisible();
    await expect(trinoLink.locator('..').getByRole('link')).toHaveCount(1);
  });

  test('tools section is collapsible', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    const collapseButton = page.getByRole('button', { name: 'Collapse tools section' });
    await expect(collapseButton).toHaveAttribute('aria-expanded', 'true');

    await collapseButton.click();
    await expect(page.getByRole('link', { name: 'Dashboards' })).not.toBeVisible();
    await expect(page.getByRole('link', { name: 'Trino' })).not.toBeVisible();
    await expect(page.getByRole('link', { name: 'Pipelines' })).toBeVisible();

    await page.getByRole('button', { name: 'Expand tools section' }).click();
    await expect(page.getByRole('link', { name: 'Dashboards' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Trino' })).toBeVisible();
  });
});
