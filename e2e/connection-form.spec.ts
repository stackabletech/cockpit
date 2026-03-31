import { test, expect } from '@playwright/test';
import { waitForHydration } from './helpers';

/**
 * Tests for the Trino connection form.
 *
 * The main dev server (port 4173) has STACKABLE_UI_TRINO_URL set
 * (trinoConfigured=true) — used for the env-configured tests.
 *
 * A second dev server (port 4174) runs WITHOUT STACKABLE_UI_TRINO_URL
 * (trinoConfigured=false) — used for the manual-mode tests.
 */
const MANUAL_BASE_URL = 'http://localhost:4174';

// ---------------------------------------------------------------------------
// 1. When Trino IS env-configured, the form must be hidden
// ---------------------------------------------------------------------------
test.describe('Connection form (env-configured)', () => {
  test.use({ locale: 'en-US' });

  test('connection form is hidden when Trino is env-configured', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    await expect(page.getByText('Connection', { exact: true })).not.toBeVisible();
    await expect(page.locator('input[type="url"]')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. When Trino is NOT env-configured, the form must be shown
// ---------------------------------------------------------------------------
test.describe('Connection form (manual mode)', () => {
  test.use({ locale: 'en-US', baseURL: MANUAL_BASE_URL });

  test.beforeEach(async ({ page }) => {
    // Clear any stored connection from previous test runs.
    await page.addInitScript(() => {
      localStorage.removeItem('trino_url');
      localStorage.removeItem('trino_auth_type');
      localStorage.removeItem('trino_username');
      localStorage.removeItem('trino_password');
    });
  });

  test('connection form is visible', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    await expect(page.getByText('Connection', { exact: true })).toBeVisible();
  });

  test('expanding the form reveals URL input', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    // Click the collapse toggle to open the form.
    await page.getByLabel('Connection').check();

    await expect(page.getByLabel('URL')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  });

  test('auth type toggle shows credential fields for basic auth', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    await page.getByLabel('Connection').check();

    // Initially no credential fields (auth type defaults to "none").
    await expect(page.getByLabel('Username')).not.toBeVisible();
    await expect(page.getByLabel('Password')).not.toBeVisible();

    // Switch to basic auth.
    await page.getByRole('radio', { name: 'Basic' }).click();

    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('auth type toggle hides credential fields for no auth', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    await page.getByLabel('Connection').check();

    // Switch to basic, then back to no auth.
    await page.getByRole('radio', { name: 'Basic' }).click();
    await expect(page.getByLabel('Username')).toBeVisible();

    await page.getByRole('radio', { name: 'No auth' }).click();
    await expect(page.getByLabel('Username')).not.toBeVisible();
    await expect(page.getByLabel('Password')).not.toBeVisible();
  });

  test('submitting without a URL shows a validation error', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    await page.getByLabel('Connection').check();

    // Submit with empty URL.
    await page.getByRole('button', { name: 'Save' }).click();

    // The form should show a validation error for the URL field.
    await expect(page.locator('.text-error')).toBeVisible();
  });

  test('basic auth requires username and password', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    await page.getByLabel('Connection').check();

    // Fill URL but leave credentials empty with basic auth selected.
    await page.getByLabel('URL').fill('http://localhost:8080');
    await page.getByRole('radio', { name: 'Basic' }).click();

    await page.getByRole('button', { name: 'Save' }).click();

    // Should show validation error for missing credentials.
    await expect(page.locator('.text-error')).toBeVisible();
  });

  test('connection details persist to localStorage', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    await page.getByLabel('Connection').check();

    const testUrl = 'http://localhost:8080';
    await page.getByLabel('URL').fill(testUrl);

    // Verify localStorage was updated.
    const stored = await page.evaluate(() => localStorage.getItem('trino_url'));
    expect(stored).toBe(testUrl);
  });

  test('stored connection is restored on page reload', async ({ page }) => {
    // Pre-populate localStorage with a connection URL.
    await page.addInitScript(() => {
      localStorage.setItem('trino_url', 'http://localhost:8080');
      localStorage.setItem('trino_auth_type', 'none');
    });

    await page.goto('/trino');
    await waitForHydration(page);

    await page.getByLabel('Connection').check();

    // The URL field should be pre-filled from localStorage.
    await expect(page.getByLabel('URL')).toHaveValue('http://localhost:8080');
  });

  test('connection summary shows host and auth type', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('trino_url', 'http://localhost:8080');
      localStorage.setItem('trino_auth_type', 'none');
    });

    await page.goto('/trino');
    await waitForHydration(page);

    // The collapse header should show a summary with the host.
    await expect(page.getByText('localhost:8080')).toBeVisible();
  });
});
