import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.use({ locale: 'en-US' });

  test('unauthenticated access redirects to login page', async ({ browser }) => {
    // Use a fresh context with no saved session
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/');
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in to Stackable' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with SSO' })).toBeVisible();

    await context.close();
  });

  test('login page preserves redirectTo query parameter', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/some-page?foo=bar');
    await expect(page).toHaveURL(/\/auth\/login\?redirectTo=/);

    await context.close();
  });

  test('authenticated user sees dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('user menu shows sign out option', async ({ page }) => {
    await page.goto('/');

    const userMenuButton = page.getByRole('button', { name: 'User menu' });
    await expect(userMenuButton).toBeVisible();

    await userMenuButton.click();

    const signOutLink = page.getByRole('link', { name: 'Sign out' });
    await expect(signOutLink).toBeVisible();
    await expect(signOutLink).toHaveAttribute('href', '/auth/logout');
  });

  test('sign out redirects to login page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'User menu' }).click();
    await page.getByRole('link', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.getByRole('button', { name: 'Sign in with SSO' })).toBeVisible();
  });
});
