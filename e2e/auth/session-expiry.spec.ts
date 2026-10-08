import { test, expect, type Page } from '@playwright/test';
import { waitForHydration } from '../support/helpers.js';

/** Issue a same-origin fetch from the page and wait for the session check it triggers. */
async function fetchAndAwaitSessionCheck(page: Page, url: string) {
  const sessionCheck = page.waitForResponse((res) => res.url().includes('/api/auth/get-session'));
  const status = await page.evaluate(async (u) => (await fetch(u)).status, url);
  await sessionCheck;
  return status;
}

test.describe('Session expiry', () => {
  test.use({ locale: 'en-US' });

  test.describe('without a session', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('API routes return a JSON 401', async ({ request }) => {
      const res = await request.get('/api/trino/catalog?level=catalogs', { maxRedirects: 0 });
      expect(res.status()).toBe(401);
      expect(await res.json()).toEqual({ message: 'Authentication required' });
    });
  });

  test('shows a blocking modal when an API call fails after the session is gone', async ({
    page
  }) => {
    await page.goto('/trino?tab=1');
    await waitForHydration(page);

    const dialog = page.getByRole('dialog', { name: 'Session expired' });
    await expect(dialog).toBeHidden();

    await page.context().clearCookies();
    const status = await fetchAndAwaitSessionCheck(page, '/api/trino/catalog?level=catalogs');
    expect(status).toBe(401);

    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Your session has expired.')).toBeVisible();

    const signIn = dialog.getByRole('link', { name: 'Sign in again' });

    // The modal cannot be dismissed. Press Escape twice: browsers may skip the
    // cancellable `cancel` event on a repeated Escape and close the dialog.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(signIn).toBeFocused();

    await expect(signIn).toHaveAttribute(
      'href',
      '/auth/login?redirectTo=' + encodeURIComponent('/trino?tab=1')
    );

    // Signing in again returns the user to where they were. This relies on the
    // mock OIDC provider signing in without a login form.
    await signIn.click();
    await expect(page).toHaveURL(/\/auth\/login/);
    await waitForHydration(page);
    await page.getByRole('button', { name: /sign in with sso/i }).click();
    await expect(page).toHaveURL('/trino?tab=1');
    await expect(dialog).toBeHidden();
  });

  test('shows the modal when the user returns to the tab after the session is gone', async ({
    page
  }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.context().clearCookies();
    const sessionCheck = page.waitForResponse((res) => res.url().includes('/api/auth/get-session'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await sessionCheck;

    await expect(page.getByRole('dialog', { name: 'Session expired' })).toBeVisible();
  });

  test('does not show the modal for a 401 while the session is valid', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    // The storage API answers 401 when no storage connection header is sent
    // (requires the storage browser to be enabled, as in .env.test).
    const status = await fetchAndAwaitSessionCheck(page, '/api/storage/buckets');
    expect(status).toBe(401);

    await expect(page.getByRole('dialog', { name: 'Session expired' })).toBeHidden();
  });
});
