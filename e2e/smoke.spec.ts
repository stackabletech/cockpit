import { test, expect } from '@playwright/test';

test.describe('Smoke tests', () => {
  test.use({ locale: 'en-US' });

  test('home page loads with app shell', async ({ page }) => {
    await page.goto('/');

    // Sidebar brand is visible
    await expect(page.getByText('Stackable', { exact: true })).toBeVisible();

    // Dashboard nav item is present and active
    const dashboardLink = page.getByRole('link', { name: 'Dashboard' });
    await expect(dashboardLink).toBeVisible();
    await expect(dashboardLink).toHaveAttribute('aria-current', 'page');

    // Header shows page title
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // Dashboard content is rendered
    await expect(page.getByText('Welcome back')).toBeVisible();

    // Trino nav item is present and navigable
    const trinoLink = page.getByRole('link', { name: 'Trino' });
    await expect(trinoLink).toBeVisible();
    await expect(trinoLink).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('theme toggle switches between light and dark', async ({ page }) => {
    await page.goto('/');

    const html = page.locator('html');
    const toggle = page.getByRole('button', {
      name: /switch to (light|dark) mode|zum (hellen|dunklen) modus wechseln/i
    });

    // Wait for client hydration/theme initialisation before interacting.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('theme')))
      .toMatch(/^(light|dark)$/);
    await expect(html).toHaveAttribute('data-theme', /^(light|dark)$/);
    await expect(toggle).toBeVisible();

    // Get initial theme
    const initialTheme = (await html.getAttribute('data-theme')) as 'light' | 'dark';
    const otherTheme = initialTheme === 'dark' ? 'light' : 'dark';

    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', otherTheme);

    // Click again to restore
    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', initialTheme);
  });
});
