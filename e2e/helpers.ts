import type { Page } from '@playwright/test';

/**
 * Wait for SvelteKit client-side hydration to complete.
 *
 * The root layout adds a `hydrated` class to `<body>` inside `onMount`,
 * which fires after hydration finishes and the app is fully interactive.
 */
export async function waitForHydration(page: Page) {
  await page.locator('body.hydrated').waitFor();
}
