import { test, expect, type BrowserContext } from '../support/fixtures.js';
import { hasGarageCredentials, requireGarageCredentials } from '../support/garage.js';
import { waitForHydration } from '../support/helpers.js';
import { connectToStorage } from '../storage/helpers.js';

// Runs against the 'local-user' app instance (see e2e/support/app-variants.ts),
// which has OIDC disabled. Every request acts as the same local user, and both
// browser projects run at once, so these tests never clear shared state.

test.describe('Without OIDC — shared local user', () => {
  test.use({ locale: 'en-US', storageState: { cookies: [], origins: [] } });

  test('opens the app without signing in', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    // Nothing to sign out of.
    await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
  });

  test('leads from the login page back to the requested page', async ({ page }) => {
    await page.goto('/auth/login?redirectTo=%2Fsettings%2Fconnections');
    await expect(page).toHaveURL('/settings/connections');
  });

  test('keeps one session per browser', async ({ page, browser, baseURL }) => {
    const sessionToken = async (context: BrowserContext) =>
      (await context.cookies()).find((cookie) => cookie.name.endsWith('session_token'))?.value;

    await page.goto('/');
    const first = await sessionToken(page.context());
    expect(first).toBeTruthy();
    await page.goto('/settings/connections');
    expect(await sessionToken(page.context())).toBe(first);

    const other = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      await (await other.newPage()).goto('/');
      const second = await sessionToken(other);
      expect(second).toBeTruthy();
      expect(second).not.toBe(first);
    } finally {
      await other.close();
    }
  });

  test('answers per-user API requests without a session', async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    try {
      const res = await request.get('/api/storage/connections');
      expect(res.status()).toBe(200);
      expect(Array.isArray(await res.json())).toBe(true);
    } finally {
      await request.dispose();
    }
  });

  test('shares saved storage connections between browsers', async ({ page, browser, baseURL }) => {
    test.skip(!hasGarageCredentials(), 'Skipped: requires a running Garage instance');
    const credentials = requireGarageCredentials();

    await connectToStorage(page, credentials, { clearSaved: false });
    await expect(page.locator('main').getByRole('heading', { name: 'Buckets' })).toBeVisible();

    // A second browser gets its own session, but as the same user.
    const other = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      const otherPage = await other.newPage();
      await otherPage.goto('/settings/connections');
      await waitForHydration(otherPage);
      const url = new URL(credentials.endpoint);
      const endpoint = url.port ? `${url.hostname}:${url.port}` : url.hostname;
      await expect(otherPage.locator('main').getByText(endpoint).first()).toBeVisible();
    } finally {
      await other.close();
    }
  });
});
