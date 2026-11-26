import { test, expect } from './support/fixtures.js';
import { waitForHydration } from './support/helpers';

// Browsers that block site data throw a SecurityError on merely reading `localStorage`. The app
// must still hydrate and work, only without persisting UI state.
test.describe('Blocked site data', () => {
  test.use({ locale: 'en-US' });

  let pageErrors: Error[];

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));
    await page.addInitScript(() => {
      for (const name of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(window, name, {
          configurable: true,
          get() {
            throw new DOMException('The operation is insecure.', 'SecurityError');
          }
        });
      }
    });
  });

  test.afterEach(() => {
    expect(pageErrors.map((e) => e.message)).toEqual([]);
  });

  test('app shell hydrates and the theme toggle works', async ({ page }) => {
    // Firefox is slower to hydrate; triple the default timeout.
    test.slow();
    await page.goto('/');
    await waitForHydration(page);

    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', /^(light|dark)$/);
    const initialTheme = await html.getAttribute('data-theme');

    await page.getByRole('button', { name: /switch to (light|dark) mode/i }).click();
    await expect(html).not.toHaveAttribute('data-theme', initialTheme ?? '');
  });

  test('theme is set before hydration', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    // Without the app's JavaScript only the inline script in app.html can set the theme. The
    // aborted scripts fail SvelteKit's start-up import, so page errors are expected here.
    page.removeAllListeners('pageerror');
    await page.route('**/_app/immutable/**/*.js', (route) => route.abort());
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('Trino page hydrates and warns that tabs are not saved', async ({ page }) => {
    test.slow();
    await page.goto('/trino');
    await waitForHydration(page);

    // The catalog browser falls back to its default (open on desktop).
    await expect(page.getByRole('navigation', { name: 'Catalog browser' })).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(1);
    await page.getByRole('button', { name: 'New Tab' }).click();
    await expect(page.getByRole('tab')).toHaveCount(2);
    await expect(
      page.getByRole('alert').filter({ hasText: "Tabs can't be saved in this browser." })
    ).toBeVisible();
  });

  test('storage page hydrates', async ({ page }) => {
    test.slow();
    await page.goto('/storage');
    await waitForHydration(page);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
