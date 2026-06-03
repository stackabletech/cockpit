import { test, expect } from '@playwright/test';
import { waitForHydration } from './helpers';

/**
 * Tests for the Trino connection form.
 *
 * The test environment has STACKABLE_COCKPIT_TRINO_URL set, so trinoConfigured=true
 * by default. The manual-mode tests use route interception to flip
 * trinoConfigured to false, patching both the SSR HTML (devalue.uneval format)
 * and the client-side __data.json (devalue.stringify format).
 */

/**
 * Intercept SvelteKit responses to override the trinoConfigured boolean.
 *
 * SvelteKit embeds page data in two formats:
 * - SSR HTML uses devalue.uneval with unquoted keys: `trinoConfigured:true`
 * - __data.json uses devalue.stringify with indexed arrays where booleans
 *   are stored at positions referenced by the shape object at index 0
 */
function interceptTrinoConfigured(page: import('@playwright/test').Page, value: boolean) {
  page.route('**/trino', async (route, request) => {
    if (request.resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    let html = await response.text();
    // devalue.uneval uses literal booleans; minified builds may use !0 / !1
    html = html.replaceAll(`trinoConfigured:${!value}`, `trinoConfigured:${value}`);
    html = html.replaceAll(
      `trinoConfigured:${!value ? '!0' : '!1'}`,
      `trinoConfigured:${value ? '!0' : '!1'}`
    );
    await route.fulfill({ response, body: html });
  });

  page.route('**/trino/__data.json*', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    for (const node of json.nodes ?? []) {
      if (node?.type === 'data' && Array.isArray(node.data)) {
        const shape = node.data[0];
        if (typeof shape === 'object' && shape !== null && 'trinoConfigured' in shape) {
          node.data[shape.trinoConfigured as number] = value;
        }
      }
    }
    await route.fulfill({ response, body: JSON.stringify(json) });
  });
}

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
  test.use({ locale: 'en-US' });

  test.beforeEach(async ({ page }) => {
    // Clear any stored connection from previous test runs.
    await page.addInitScript(() => {
      localStorage.removeItem('trino_url');
      localStorage.removeItem('trino_auth_type');
      localStorage.removeItem('trino_username');
      localStorage.removeItem('trino_password');
    });

    interceptTrinoConfigured(page, false);
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

    // Should show validation errors for missing credentials.
    await expect(page.getByText('Username is required for basic authentication')).toBeVisible();
    await expect(page.getByText('Password is required for basic authentication')).toBeVisible();
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
