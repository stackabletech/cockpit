import { test, expect } from './support/fixtures.js';
import { waitForHydration } from './support/helpers';

test.describe('Error pages', () => {
  test.use({ locale: 'en-US' });

  test('an unknown page shows a readable 404 inside the app layout', async ({ page }) => {
    const response = await page.goto('/does-not-exist');
    expect(response?.status()).toBe(404);
    await waitForHydration(page);

    await expect(page).toHaveTitle('Page not found | Stackable');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: /Page not found/ })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();

    await main.getByRole('link', { name: 'Go to dashboard' }).click();
    await expect(page).toHaveURL('/');
  });

  test('an unknown API path answers with a JSON error', async ({ page }) => {
    const res = await page.request.get('/api/does-not-exist');

    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ message: 'Not Found' });
  });

  test.describe('signed out', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('unknown pages still require sign-in', async ({ page }) => {
      for (const path of ['/does-not-exist', '/auth/login/does-not-exist']) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/auth\/login\?redirectTo=/);
      }
    });

    test('only the exact public routes skip sign-in', async ({ page }) => {
      for (const path of ['/metrics', '/healthz']) {
        expect((await page.request.get(path)).status(), path).toBe(200);
      }
      const lookalike = await page.request.get('/metricsfoo', { maxRedirects: 0 });
      expect(lookalike.status()).toBe(302);
      expect(lookalike.headers().location).toMatch(/^\/auth\/login\?redirectTo=/);
    });

    test('unknown API paths still answer with a JSON 401', async ({ page }) => {
      const res = await page.request.get('/api/does-not-exist');

      expect(res.status()).toBe(401);
      expect(await res.json()).toEqual({ message: 'Authentication required' });
    });
  });
});
