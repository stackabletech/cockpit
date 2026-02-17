import { test, expect } from '@playwright/test';

test.describe('Internationalisation', () => {
  test.use({ locale: 'en-US' });

  test('renders in English by default with lang="en"', async ({ page }) => {
    await page.goto('/');

    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'en');

    // Dashboard content is in English
    await expect(page.getByText('Welcome back')).toBeVisible();
    await expect(page.getByText('Getting started')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('language switcher changes to German', async ({ page, context, baseURL }) => {
    const resolvedBaseURL = baseURL ?? 'http://localhost:5173';

    await context.clearCookies();
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
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('theme')))
      .toMatch(/^(light|dark)$/);

    await page.locator('summary[aria-label]').click();
    const englishOption = page.locator('details[open] button[lang="en"]');
    const deutschOption = page.locator('details[open] button[lang="de"]');
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

  test('Accept-Language header respected for first visit', async ({ browser }) => {
    // Create a context with German Accept-Language
    const context = await browser.newContext({
      locale: 'de-DE'
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

    const languageButton = page.locator('summary[aria-label]');
    await expect(languageButton).toBeVisible();

    // Open dropdown
    await languageButton.click();

    // Both language options visible with correct lang attributes
    const englishOption = page.locator('details[open] button[lang="en"]');
    const deutschOption = page.locator('details[open] button[lang="de"]');

    await expect(englishOption).toBeVisible();
    await expect(deutschOption).toBeVisible();
    await expect(englishOption).toHaveAttribute('lang', 'en');
    await expect(deutschOption).toHaveAttribute('lang', 'de');
    await expect(englishOption).toHaveAttribute('aria-current', 'true');
    await expect(deutschOption).not.toHaveAttribute('aria-current', 'true');
  });
});
