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

/**
 * Save the Trino connection config via the UI so the server-side
 * connection store is populated (required before query execution).
 */
export async function saveTrinoConnection(page: Page) {
  await page.getByRole('checkbox', { name: 'Connection' }).check({ force: true });
  const saveBtn = page.getByRole('button', { name: 'Save' });
  await saveBtn.waitFor({ state: 'visible', timeout: 5_000 });
  await saveBtn.click();
  await page.getByText('Connection saved.').waitFor({ timeout: 15_000 });
}

/**
 * Wait for the async query runner to reach a terminal state.
 * Uses the `data-query-state` attribute on the status display element.
 */
export async function waitForQueryComplete(page: Page) {
  await page.locator('[data-query-state="FINISHED"], [data-query-state="FAILED"]').waitFor({
    timeout: 15_000
  });
}
