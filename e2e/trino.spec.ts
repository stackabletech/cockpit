import { test, expect, type Page } from '@playwright/test';

const COLUMNS = [
  { name: 'id', type: 'integer' },
  { name: 'name', type: 'varchar' }
];

// In SvelteKit + Vite dev mode, the `load` event fires before all dynamic module
// imports finish. Svelte 5 attaches event handlers only after those imports
// complete (hydration). Poll for the theme key — the layout writes it on mount —
// as a reliable signal that the app is fully hydrated and interactive.
async function waitForHydration(page: Page) {
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('theme')))
    .toMatch(/^(light|dark)$/);
}

test.describe('Trino query editor', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(async ({ page }) => {
    // Pre-populate localStorage so the connection config and SQL are ready without
    // user interaction — addInitScript runs before any page scripts execute.
    await page.addInitScript(() => {
      localStorage.setItem('trino_url', 'http://trino.example.com:8080');
      localStorage.setItem('trino_auth_type', 'none');
      localStorage.setItem('trino_sql', 'SELECT id, name FROM users');
    });
  });

  test('page renders with editor and results sections', async ({ page }) => {
    await page.goto('/trino');

    await expect(page.getByRole('heading', { name: 'Trino' })).toBeVisible();
    await expect(page.getByText('SQL editor')).toBeVisible();
    await expect(page.getByText('Query results')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run query' })).toBeVisible();
    await expect(page.getByText('No results')).toBeVisible();
  });

  test('Trino nav item is active when on /trino', async ({ page }) => {
    await page.goto('/trino');

    const trinoLink = page.getByRole('link', { name: 'Trino' });
    await expect(trinoLink).toHaveAttribute('aria-current', 'page');
  });

  test('running a query displays the results table', async ({ page }) => {
    await page.route('**/api/trino/query', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          queryId: 'q1',
          columns: COLUMNS,
          rows: [
            [1, 'Alice'],
            [2, 'Bob'],
            [3, 'Carol']
          ],
          hasMore: false,
          totalRows: 3
        })
      });
    });

    await page.goto('/trino');
    await waitForHydration(page);
    await page.getByRole('button', { name: 'Run query' }).click();

    const table = page.getByRole('table', { name: 'Query results' });
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'id' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'name' })).toBeVisible();
    await expect(table.getByRole('cell', { name: '1' })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'Alice' })).toBeVisible();
    await expect(page.getByText('Rows 1–3 of 3')).toBeVisible();
  });

  test('Ctrl+Enter triggers query execution', async ({ page }) => {
    let called = false;
    await page.route('**/api/trino/query', async (route) => {
      called = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          queryId: 'q1',
          columns: COLUMNS,
          rows: [[1, 'Alice']],
          hasMore: false,
          totalRows: 1
        })
      });
    });

    await page.goto('/trino');
    await waitForHydration(page);
    await page.keyboard.press('Control+Enter');

    await expect.poll(() => called).toBe(true);
    await expect(page.getByRole('table', { name: 'Query results' })).toBeVisible();
  });

  test('query error is shown in an alert', async ({ page }) => {
    await page.route('**/api/trino/query', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'syntax error at position 7' })
      });
    });

    await page.goto('/trino');
    await waitForHydration(page);
    await page.getByRole('button', { name: 'Run query' }).click();

    // Monaco also renders role="alert" nodes for its own accessibility — filter by content.
    const alert = page.getByRole('alert').filter({ hasText: 'Query error' });
    await expect(alert).toBeVisible();
    await expect(alert.getByText('syntax error at position 7')).toBeVisible();
  });

  test('pagination navigates between pages', async ({ page }) => {
    const allRows = Array.from({ length: 30 }, (_, i) => [i + 1, `Row ${i + 1}`]);

    await page.route('**/api/trino/query', async (route) => {
      const body = JSON.parse((await route.request().postData()) ?? '{}');
      const pg: number = body.page ?? 0;
      const ps = 25;
      const slice = allRows.slice(pg * ps, pg * ps + ps);

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          queryId: 'q-pages',
          columns: COLUMNS,
          rows: slice,
          hasMore: (pg + 1) * ps < allRows.length,
          totalRows: allRows.length
        })
      });
    });

    await page.goto('/trino');
    await waitForHydration(page);
    await page.getByRole('button', { name: 'Run query' }).click();

    await expect(page.getByText('Rows 1–25 of 30')).toBeVisible();

    const nextBtn = page.getByRole('button', { name: 'Next page' });
    const prevBtn = page.getByRole('button', { name: 'Previous page' });
    await expect(prevBtn).toBeDisabled();
    await expect(nextBtn).toBeEnabled();

    await nextBtn.click();
    await expect(page.getByText('Rows 26–30 of 30')).toBeVisible();
    await expect(prevBtn).toBeEnabled();
    await expect(nextBtn).toBeDisabled();

    await prevBtn.click();
    await expect(page.getByText('Rows 1–25 of 30')).toBeVisible();
  });

  test('session expired shows correct message', async ({ page }) => {
    let call = 0;
    await page.route('**/api/trino/query', async (route) => {
      call++;
      if (call === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            queryId: 'exp-id',
            columns: COLUMNS,
            rows: [[1, 'Alice']],
            hasMore: true,
            totalRows: 50
          })
        });
      } else {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'session_expired' })
        });
      }
    });

    await page.goto('/trino');
    await waitForHydration(page);
    await page.getByRole('button', { name: 'Run query' }).click();
    await expect(page.getByRole('table')).toBeVisible();

    await page.getByRole('button', { name: 'Next page' }).click();

    const alert = page.getByRole('alert').filter({ hasText: 'Query session expired' });
    await expect(alert).toBeVisible();
  });

  test('connection section expands to reveal URL and auth controls', async ({ page }) => {
    await page.goto('/trino');

    // The DaisyUI collapse uses a visually-hidden checkbox as its toggle.
    await page.getByRole('checkbox', { name: 'Connection' }).check({ force: true });

    const urlInput = page.getByRole('textbox', { name: 'URL' });
    await expect(urlInput).toBeVisible();
    await expect(urlInput).toHaveValue('http://trino.example.com:8080');
  });

  test('switching to basic auth reveals credential fields', async ({ page }) => {
    await page.goto('/trino');
    await page.getByRole('checkbox', { name: 'Connection' }).check({ force: true });

    // No credentials visible for 'none' auth
    await expect(page.getByLabel('Username')).not.toBeVisible();
    await expect(page.getByLabel('Password')).not.toBeVisible();

    // Switch to basic auth
    await page.getByRole('radio', { name: 'Basic' }).check({ force: true });

    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('null cell values render as italic null placeholder', async ({ page }) => {
    await page.route('**/api/trino/query', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          queryId: 'q-null',
          columns: [{ name: 'value', type: 'varchar' }],
          rows: [[null], ['hello']],
          hasMore: false,
          totalRows: 2
        })
      });
    });

    await page.goto('/trino');
    await waitForHydration(page);
    await page.getByRole('button', { name: 'Run query' }).click();

    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(table.getByText('null')).toBeVisible();
    await expect(table.getByText('hello')).toBeVisible();
  });
});
