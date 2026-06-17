import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.use({ locale: 'en-US' });

  test('unauthenticated access redirects to login page', async ({ browser }) => {
    // Use a fresh context with explicitly empty storage state (no session cookies)
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();

    await page.goto('/');
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in to Stackable' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with SSO' })).toBeVisible();

    await context.close();
  });

  test('login page preserves redirectTo query parameter', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
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

  test('sign out redirects to login page', async ({ browser }) => {
    // This test must use an isolated context with a freshly-created session.
    // The sign-out call deletes the session from the database. If we used the
    // shared storageState session here, subsequent tests whose session_data
    // cookie cache has expired would fail because the DB session is gone.
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      locale: 'en-US'
    });
    const page = await context.newPage();
    try {
      await page.goto('/');
      await waitForHydration(page);
      await page.getByRole('button', { name: /sign in with sso/i }).click();
      await expect(page).toHaveURL('/');

      await page.getByRole('button', { name: 'User menu' }).click();
      await page.getByRole('link', { name: 'Sign out' }).click();

      await expect(page).toHaveURL(/\/auth\/login/);
      await expect(page.getByRole('button', { name: 'Sign in with SSO' })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
