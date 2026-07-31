import { test, expect } from '@playwright/test';
import { waitForHydration } from './support/helpers';

test.describe('Sidebar bookmarks', () => {
  test.use({ locale: 'en-US' });

  const BOOKMARK_ID = 'b6d6c7b6-8f24-4c4a-9c64-4f3b7c19e6a1';
  const EMBED_URL = 'data:text/html,%3Ch1%3EEmbedded%20Tool%3C/h1%3E';

  test.skip(
    ({ viewport }) => (viewport?.width ?? 1280) < 1024,
    'Sidebar is off-canvas on small screens'
  );

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ({ bookmarkId, embedUrl }) => {
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
              url: embedUrl,
              openIn: 'cockpit',
              pinned: false,
              createdAt: new Date().toISOString()
            },
            {
              id: 'e7d8c7b6-9f35-4d4b-8d75-5f4c8d2fa7b2',
              productId: 'airflow',
              name: 'Pipelines',
              environment: '',
              url: 'https://airflow.example.com',
              openIn: 'cockpit',
              pinned: true,
              createdAt: new Date().toISOString()
            }
          ])
        );
      },
      { bookmarkId: BOOKMARK_ID, embedUrl: EMBED_URL }
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

  test('opens a bookmark inside the application as an iframe', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('link', { name: 'Dashboards' }).click();

    await expect(page).toHaveURL(new RegExp(`/bookmark/${BOOKMARK_ID}`));

    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('heading', { name: 'Embedded Tool' })).toBeVisible();
  });

  test('external link button opens the bookmark URL in a new tab', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    const externalLinks = page.getByRole('link', { name: 'Open in new tab' });
    await expect(externalLinks).toHaveCount(2);

    const dashboardsItem = page.getByRole('link', { name: 'Dashboards' }).locator('..');
    const dashboardsExternal = dashboardsItem.getByRole('link', { name: 'Open in new tab' });
    await expect(dashboardsExternal).toHaveAttribute('href', EMBED_URL);
    await expect(dashboardsExternal).toHaveAttribute('target', '_blank');
    await expect(dashboardsExternal).toHaveAttribute('rel', /noopener/);
  });

  test('inbuilt tools have no external link button', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    const trinoLink = page.getByRole('link', { name: 'Trino' });
    await expect(trinoLink).toBeVisible();
    const trinoItem = trinoLink.locator('..');
    await expect(trinoItem.getByRole('link', { name: 'Open in new tab' })).toHaveCount(0);
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

  test('active bookmark is highlighted in the sidebar', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('link', { name: 'Dashboards' }).click();
    await expect(page).toHaveURL(new RegExp(`/bookmark/${BOOKMARK_ID}`));

    await expect(page.getByRole('link', { name: 'Dashboards' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
});
