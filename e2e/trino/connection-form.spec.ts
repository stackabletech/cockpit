import { test, expect } from '../support/fixtures.js';
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
          authPassword: '',
          tlsInsecure: false,
          impersonate: true
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
 * Intercept SvelteKit responses to override boolean page data fields such as
 * trinoConfigured.
 *
 * SvelteKit embeds page data in two formats:
 * - SSR HTML uses devalue.uneval with unquoted keys: `trinoConfigured:true`
 * - __data.json uses devalue.stringify with indexed arrays where booleans
 *   are stored at positions referenced by the shape object at index 0
 */
function interceptPageData(
  page: import('@playwright/test').Page,
  overrides: Record<string, boolean>
) {
  page.route('**/trino', async (route, request) => {
    if (request.resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    let html = await response.text();
    for (const [key, value] of Object.entries(overrides)) {
      // devalue.uneval uses literal booleans; minified builds may use !0 / !1
      html = html.replaceAll(`${key}:${!value}`, `${key}:${value}`);
      html = html.replaceAll(`${key}:${!value ? '!0' : '!1'}`, `${key}:${value ? '!0' : '!1'}`);
    }
    await route.fulfill({ response, body: html });
  });

  page.route('**/trino/__data.json*', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    for (const node of json.nodes ?? []) {
      if (node?.type === 'data' && Array.isArray(node.data)) {
        const shape = node.data[0];
        if (typeof shape !== 'object' || shape === null) continue;
        for (const [key, value] of Object.entries(overrides)) {
          if (key in shape) node.data[shape[key] as number] = value;
        }
      }
    }
    await route.fulfill({ response, body: JSON.stringify(json) });
  });
}

/** Capture the fields posted by the next `?/save` request and abort it. */
function captureSave(page: import('@playwright/test').Page): Promise<URLSearchParams> {
  return new Promise((resolve) => {
    page.route(
      (url) => url.pathname === '/trino' && url.search === '?/save',
      async (route, request) => {
        resolve(new URLSearchParams(request.postData() ?? ''));
        await route.abort();
      }
    );
  });
}

// ---------------------------------------------------------------------------
// 0. Per-user connections that may skip TLS verification
// ---------------------------------------------------------------------------
test.describe('Connection form (insecure TLS allowed)', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('trino_url');
      localStorage.removeItem('trino_tls_insecure');
    });
    interceptPageData(page, { trinoConfigured: false, allowInsecureTls: true });
  });

  test('skipping TLS verification is posted, persisted and shown in the summary', async ({
    page
  }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    await page.getByLabel('URL').fill(MOCK_TRINO_URL);
    await page.getByLabel('Skip TLS certificate verification').check();
    await expect(page.getByText('TLS unverified')).toBeVisible();

    const posted = captureSave(page);
    await page.getByRole('button', { name: 'Save' }).click();

    expect((await posted).get('tlsInsecure')).toBe('on');
    expect(await page.evaluate(() => localStorage.getItem('trino_tls_insecure'))).toBe('true');
  });
});

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

    interceptPageData(page, { trinoConfigured: false });
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

  test('impersonation toggle is only shown for basic auth', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    const toggle = page.getByLabel('Impersonate the logged-in user');
    await expect(toggle).not.toBeVisible();

    await page.getByRole('radio', { name: 'Basic' }).click();
    await expect(toggle).toBeVisible();
    // Defaults to the deployment's impersonation setting (enabled in the test env).
    await expect(toggle).toBeChecked();
  });

  test('disabling impersonation is posted with the connection', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    await page.getByLabel('URL').fill(MOCK_TRINO_URL);
    await page.getByRole('radio', { name: 'Basic' }).click();
    await page.getByLabel('Username').fill('alice');
    await page.getByLabel('Password').fill('secret');
    await page.getByLabel('Impersonate the logged-in user').uncheck();

    const posted = captureSave(page);
    await page.getByRole('button', { name: 'Save' }).click();

    // An unchecked checkbox is not posted; superforms reads the missing field as false.
    const body = await posted;
    expect(body.get('authUsername')).toBe('alice');
    expect(body.has('impersonate')).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('trino_impersonate'))).toBe('false');
  });

  test('impersonation setting is kept while the toggle is hidden', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    await page.getByRole('radio', { name: 'Basic' }).click();
    await page.getByLabel('Impersonate the logged-in user').uncheck();
    await page.getByRole('radio', { name: 'No auth' }).click();
    await page.getByLabel('URL').fill(MOCK_TRINO_URL);

    const posted = captureSave(page);
    await page.getByRole('button', { name: 'Save' }).click();
    expect((await posted).get('impersonate')).toBe('false');

    await page.getByRole('radio', { name: 'Basic' }).click();
    await expect(page.getByLabel('Impersonate the logged-in user')).not.toBeChecked();
  });

  test('TLS verification option is hidden unless allowed', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    await expect(page.getByLabel('URL')).toBeVisible();
    await expect(page.getByLabel('Skip TLS certificate verification')).not.toBeVisible();
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
