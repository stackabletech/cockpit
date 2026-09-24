import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { waitForHydration } from './support/helpers';

/** Load the saved auth storage state, optionally stripping the locale cookie. */
function loadAuthState(projectName: string, { withoutLocale = false } = {}) {
  const authFile = path.join(import.meta.dirname, `.auth/user-setup-${projectName}.json`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const state = JSON.parse(fs.readFileSync(authFile, 'utf-8'));
  if (withoutLocale) {
    state.cookies = state.cookies.filter((c: { name: string }) => c.name !== 'PARAGLIDE_LOCALE');
  }
  return state;
}

test.describe('Internationalisation', () => {
  test.use({ locale: 'en-US' });

  // Firefox is slower to hydrate and navigate; triple the default timeout for
  // all tests in this block so they don't time out on slow CI runners.
  test.beforeEach(() => {
    test.slow();
  });

  test('renders in English by default with lang="en"', async ({ page }) => {
    await page.goto('/');

    // Wait for hydration so reactive state has settled before checking content.
    await waitForHydration(page);

    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'en');

    // Dashboard content is in English
    await expect(page.getByText('Welcome back')).toBeVisible();
    await expect(page.getByText('Getting started')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('language switcher changes to German', async ({ page, context, baseURL }) => {
    const resolvedBaseURL = baseURL ?? 'http://localhost:4173';

    // Only clear the locale cookie, keeping auth cookies intact
    await context.clearCookies({ name: 'PARAGLIDE_LOCALE' });
    await context.addCookies([
      {
        name: 'PARAGLIDE_LOCALE',
        value: 'en',
        url: `${resolvedBaseURL}/`
      }
    ]);

    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    // Wait for client hydration; locale switch relies on an attached click handler.
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Language' }).click();
    const englishOption = page.locator('#lang-switcher button[lang="en"]');
    const deutschOption = page.locator('#lang-switcher button[lang="de"]');
    await expect(englishOption).toHaveAttribute('aria-current', 'true');
    await expect(deutschOption).not.toHaveAttribute('aria-current', 'true');

    // setLocale triggers a page reload when changing locale.
    await deutschOption.click();

    // Page reloads with German content
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByText('Willkommen zurück')).toBeVisible();
    await expect(page.getByText('Erste Schritte')).toBeVisible();
  });

  test('locale persists via cookie across navigation', async ({ page, context, baseURL }) => {
    const resolvedBaseURL = baseURL ?? 'http://localhost:5173';

    // Set locale cookie to German before visiting
    await context.addCookies([
      {
        name: 'PARAGLIDE_LOCALE',
        value: 'de',
        url: `${resolvedBaseURL}/`
      }
    ]);

    await page.goto('/');

    // Should render in German
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByText('Willkommen zurück')).toBeVisible();

    // Navigate to same page (simulate navigation)
    await page.goto('/');

    // Should still be German
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByText('Willkommen zurück')).toBeVisible();
  });

  test('Accept-Language header respected for first visit', async ({ browser }, testInfo) => {
    // Create a context with German Accept-Language but no locale cookie,
    // so paraglide falls back to the Accept-Language header
    const context = await browser.newContext({
      locale: 'de-DE',
      storageState: loadAuthState(testInfo.project.name, { withoutLocale: true })
    });
    const page = await context.newPage();

    await page.goto('/');

    // Should render in German based on Accept-Language
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByText('Willkommen zurück')).toBeVisible();

    await context.close();
  });

  test('language switcher is visible and accessible', async ({ page }) => {
    await page.goto('/');

    const languageButton = page.getByRole('button', { name: 'Language' });
    await expect(languageButton).toBeVisible();

    // Open dropdown
    await languageButton.click();

    // Both language options visible with correct lang attributes
    const englishOption = page.locator('#lang-switcher button[lang="en"]');
    const deutschOption = page.locator('#lang-switcher button[lang="de"]');

    await expect(englishOption).toBeVisible();
    await expect(deutschOption).toBeVisible();
    await expect(englishOption).toHaveAttribute('lang', 'en');
    await expect(deutschOption).toHaveAttribute('lang', 'de');
    await expect(englishOption).toHaveAttribute('aria-current', 'true');
    await expect(deutschOption).not.toHaveAttribute('aria-current', 'true');
  });
});
