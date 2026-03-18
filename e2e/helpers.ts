import { expect, type Page } from '@playwright/test';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

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
 *
 * Waits for network idle first because onMount fires a raw fetch to
 * `?/save` when `trino_url` is set in localStorage. Without this wait,
 * the auto-save and the form submit race and cause flaky failures.
 */
export async function saveTrinoConnection(page: Page) {
  await page.waitForLoadState('networkidle');
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

/**
 * Start a lightweight HTTP server that acts as a mock Trino endpoint.
 *
 * The SvelteKit server action fetches `{trino_url}/v1/statement` from Node.js,
 * so we need a real TCP server reachable by the server process.
 * `page.route()` only intercepts browser-side requests and cannot mock
 * server-side Node.js fetch calls.
 */
export async function startMockTrinoServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ url: string; stop: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  };
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
