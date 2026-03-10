import { expect, type Page } from '@playwright/test';

/**
 * Wait for SvelteKit client-side hydration to complete.
 *
 * The root layout adds a `hydrated` class to `<body>` inside `onMount`,
 * which fires after hydration finishes and the app is fully interactive.
 */
export async function waitForHydration(page: Page) {
  await page.locator('body.hydrated').waitFor();
}

/**
 * Ensure the catalog browser panel/dialog is visible.
 *
 * On desktop the panel may already be open (from localStorage). On mobile the
 * browser is always initially closed, so we click the toggle button to open
 * it as a full-screen dialog.
 */
export async function ensureCatalogBrowserOpen(page: Page) {
  const catalogNav = page.getByRole('navigation', { name: 'Catalog browser' });
  const isVisible = await catalogNav.isVisible().catch(() => false);
  if (!isVisible) {
    await page.getByRole('button', { name: 'Toggle catalog browser' }).click();
    await expect(catalogNav).toBeVisible();
  }
}
