import { test, expect } from '@playwright/test';
import { waitForHydration } from './support/helpers';

test.describe('App navigation', () => {
  test.use({ locale: 'en-US' });

  test('navigating between apps shows a loading indicator until the page is ready', async ({
    page
  }) => {
    await page.goto('/');
    await waitForHydration(page);

    // Delay the Trino route's data fetch so the loading indicator stays on
    // screen long enough to assert on it.
    await page.route('**/trino/__data.json*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });

    await page.getByRole('link', { name: 'Trino', exact: true }).click();

    const progress = page.locator('[data-navigation-progress]');
    await expect(progress).toBeVisible();
    await expect(progress.getByText('Loading…')).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Trino', exact: true })).toBeVisible();
    await expect(progress).toBeHidden();
  });

  test('sidebar highlights the active app when switching between dashboard, Trino and storage', async ({
    page
  }) => {
    await page.goto('/');
    await waitForHydration(page);

    const dashboardLink = page.getByRole('link', { name: 'Dashboard' });
    const trinoLink = page.getByRole('link', { name: 'Trino', exact: true });
    const storageLink = page.getByRole('link', { name: 'Storage' });

    await expect(dashboardLink).toHaveAttribute('aria-current', 'page');

    await trinoLink.click();
    await expect(page.getByRole('heading', { name: 'Trino', exact: true })).toBeVisible();
    await expect(trinoLink).toHaveAttribute('aria-current', 'page');
    await expect(dashboardLink).not.toHaveAttribute('aria-current', 'page');

    await storageLink.click();
    await expect(page.getByRole('heading', { name: 'Storage', exact: true })).toBeVisible();
    await expect(storageLink).toHaveAttribute('aria-current', 'page');
    await expect(trinoLink).not.toHaveAttribute('aria-current', 'page');

    await dashboardLink.click();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(dashboardLink).toHaveAttribute('aria-current', 'page');
    await expect(storageLink).not.toHaveAttribute('aria-current', 'page');
  });
});
