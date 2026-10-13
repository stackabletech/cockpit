import { test, expect } from '@playwright/test';
import { stringify } from 'devalue';
import { waitForHydration, waitForQueryComplete, setTabSql } from '../support/helpers';
import { MOCK_TRINO_URL } from '../support/mock-trino';

/**
 * Tests for the Trino connection form.
 *
 * The test environment has STACKABLE_COCKPIT_TRINO_URL set, so trinoConfigured=true
 * by default. The manual-mode tests use route interception to flip
 * trinoConfigured to false, patching both the SSR HTML (devalue.uneval format)
 * and the client-side __data.json (devalue.stringify format).
 */

/**
 * Fake a successful `?/save` action response.
 *
 * The test server is env-configured, so the real action rejects every save.
 * This only exercises the client-side success path.
 */
function interceptSaveSuccess(page: import('@playwright/test').Page) {
  page.route(
    (url) => url.pathname === '/trino' && url.search === '?/save',
    async (route, request) => {
      // Echo the client's form id back, otherwise superforms ignores the response.
      // use:enhance posts urlencoded without file inputs, multipart otherwise.
      const body = request.postData() ?? '';
      const formId =
        new URLSearchParams(body).get('__superform_id') ??
        /name="__superform_id"\r\n\r\n([^\r]*)/.exec(body)?.[1];
      const form = {
        id: formId,
        valid: true,
        posted: true,
        errors: {},
        data: {
          connectionUrl: MOCK_TRINO_URL,
          authType: 'none',
          authUsername: '',
          authPassword: ''
        },
        message: { type: 'success' }
      };
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ type: 'success', status: 200, data: stringify({ form }) })
      });
    }
  );
}

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

    await expect(page.getByText('Edit connection', { exact: true })).not.toBeVisible();
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

    await expect(page.getByText('Edit connection', { exact: true })).toBeVisible();
  });

  test('form is expanded initially when there is no connection', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    await expect(page.getByLabel('Edit connection')).toBeChecked();
    await expect(page.getByLabel('URL')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();

    // The collapse toggle still hides the form.
    await page.getByLabel('Edit connection').uncheck();
    await expect(page.getByLabel('URL')).not.toBeVisible();
  });

  test('auth type toggle shows credential fields for basic auth', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    await page.getByLabel('Edit connection').check();

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

    await page.getByLabel('Edit connection').check();

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

    await page.getByLabel('Edit connection').check();

    // Submit with empty URL.
    await page.getByRole('button', { name: 'Save' }).click();

    // The form should show a validation error for the URL field.
    await expect(page.locator('.text-error')).toBeVisible();
  });

  test('invalid URL shows a translated validation message', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    await page.getByLabel('Edit connection').check();

    await page.getByLabel('URL').fill('not a url');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(
      page.getByText('Enter a valid URL, e.g. https://trino.example.com:8443.')
    ).toBeVisible();
  });

  test('basic auth requires username and password', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    await page.getByLabel('Edit connection').check();

    // Fill URL but leave credentials empty with basic auth selected.
    await page.getByLabel('URL').fill(MOCK_TRINO_URL);
    await page.getByRole('radio', { name: 'Basic' }).click();

    await page.getByRole('button', { name: 'Save' }).click();

    // Should show validation errors for missing credentials.
    await expect(page.getByText('Username is required for basic authentication')).toBeVisible();
    await expect(page.getByText('Password is required for basic authentication')).toBeVisible();
  });

  test('connection details persist to localStorage', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    await page.getByLabel('Edit connection').check();

    const testUrl = MOCK_TRINO_URL;
    await page.getByLabel('URL').fill(testUrl);

    // Verify localStorage was updated.
    const stored = await page.evaluate(() => localStorage.getItem('trino_url'));
    expect(stored).toBe(testUrl);
  });

  test('stored connection is restored on page reload', async ({ page }) => {
    // Pre-populate localStorage with a connection URL.
    await page.addInitScript((url) => {
      localStorage.setItem('trino_url', url);
      localStorage.setItem('trino_auth_type', 'none');
    }, MOCK_TRINO_URL);

    await page.goto('/trino');
    await waitForHydration(page);

    await page.getByLabel('Edit connection').check();

    // The URL field should be pre-filled from localStorage.
    await expect(page.getByLabel('URL')).toHaveValue(MOCK_TRINO_URL);
  });

  test('connection summary shows host and auth type', async ({ page }) => {
    await page.addInitScript((url) => {
      localStorage.setItem('trino_url', url);
      localStorage.setItem('trino_auth_type', 'none');
    }, MOCK_TRINO_URL);

    await page.goto('/trino');
    await waitForHydration(page);

    // The collapse header should show a summary with the host.
    await expect(page.getByText(new URL(MOCK_TRINO_URL).host)).toBeVisible();
  });

  test('failed reconnect of a stored connection opens the form with the error', async ({
    page
  }) => {
    await page.addInitScript((url) => {
      localStorage.setItem('trino_url', url);
      localStorage.setItem('trino_auth_type', 'none');
    }, MOCK_TRINO_URL);

    // The server is env-configured, so the automatic reconnect is rejected.
    await page.goto('/trino');
    await waitForHydration(page);

    await expect(
      page.getByText('The connection is managed via environment variables.')
    ).toBeVisible();
    await expect(page.getByLabel('URL')).toHaveValue(MOCK_TRINO_URL);
  });

  test('network error during reconnect opens the form with the error', async ({ page }) => {
    await page.addInitScript((url) => {
      localStorage.setItem('trino_url', url);
      localStorage.setItem('trino_auth_type', 'none');
    }, MOCK_TRINO_URL);
    await page.route(
      (url) => url.pathname === '/trino' && url.search === '?/save',
      (route) => route.abort()
    );

    await page.goto('/trino');
    await waitForHydration(page);

    await expect(page.getByText('Could not save the connection. Please try again.')).toBeVisible();
    await expect(page.getByLabel('URL')).toHaveValue(MOCK_TRINO_URL);
  });

  test('saving a connection clears previous query results', async ({ page }) => {
    await setTabSql(page, 'SELECT id, name FROM users');
    interceptSaveSuccess(page);

    await page.goto('/trino');
    await waitForHydration(page);
    // Focus the editor so it is loaded and the cursor is set for "Run at cursor".
    await page.locator('.monaco-editor').first().click();

    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await waitForQueryComplete(page);
    await expect(page.getByRole('table', { name: 'Query results' })).toBeVisible();

    await page.getByLabel('Edit connection').check();
    await page.getByLabel('URL').fill(MOCK_TRINO_URL);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Connection saved')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Query results' })).not.toBeVisible();
    await expect(page.getByText('No results')).toBeVisible();
  });
});
