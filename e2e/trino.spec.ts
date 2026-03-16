import { test, expect } from '@playwright/test';
import { waitForHydration, startMockTrinoServer } from './helpers';

const COLUMNS = [
  { name: 'id', type: 'integer' },
  { name: 'name', type: 'varchar' }
];

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
    const { url, stop } = await startMockTrinoServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'test-query-id',
          columns: COLUMNS,
          data: [
            [1, 'Alice'],
            [2, 'Bob'],
            [3, 'Carol']
          ],
          stats: { state: 'FINISHED' }
        })
      );
    });
    await page.addInitScript((trinoUrl) => {
      localStorage.setItem('trino_url', trinoUrl);
    }, url);

    try {
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
    } finally {
      await stop();
    }
  });

  test('Ctrl+Enter triggers query execution', async ({ page }) => {
    let called = false;
    const { url, stop } = await startMockTrinoServer((_req, res) => {
      called = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'q1',
          columns: COLUMNS,
          data: [[1, 'Alice']],
          stats: { state: 'FINISHED' }
        })
      );
    });
    await page.addInitScript((trinoUrl) => {
      localStorage.setItem('trino_url', trinoUrl);
    }, url);

    try {
      await page.goto('/trino');
      await waitForHydration(page);
      await page.keyboard.press('Control+Enter');

      await expect.poll(() => called).toBe(true);
      await expect(page.getByRole('table', { name: 'Query results' })).toBeVisible();
    } finally {
      await stop();
    }
  });

  test('query error is shown in an alert', async ({ page }) => {
    const { url, stop } = await startMockTrinoServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'q-err',
          error: { message: 'syntax error at position 7', errorCode: 1 },
          stats: { state: 'FAILED' }
        })
      );
    });
    await page.addInitScript((trinoUrl) => {
      localStorage.setItem('trino_url', trinoUrl);
    }, url);

    try {
      await page.goto('/trino');
      await waitForHydration(page);
      await page.getByRole('button', { name: 'Run query' }).click();

      // Monaco also renders role="alert" nodes for its own accessibility — filter by content.
      const alert = page.getByRole('alert').filter({ hasText: 'Query error' });
      await expect(alert).toBeVisible();
      await expect(alert.getByText('syntax error at position 7')).toBeVisible();
    } finally {
      await stop();
    }
  });

  test('pagination navigates between pages', async ({ page }) => {
    // The server action caches all rows after the first query;
    // prev/next page requests are served from the cache without hitting Trino again.
    const allRows = Array.from({ length: 30 }, (_, i) => [i + 1, `Row ${i + 1}`]);
    const { url, stop } = await startMockTrinoServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'q-pages',
          columns: COLUMNS,
          data: allRows,
          stats: { state: 'FINISHED' }
        })
      );
    });
    await page.addInitScript((trinoUrl) => {
      localStorage.setItem('trino_url', trinoUrl);
    }, url);

    try {
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
    } finally {
      await stop();
    }
  });

  test('connection section expands to reveal URL and auth controls', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    // The DaisyUI collapse uses a visually-hidden checkbox as its toggle.
    await page.getByRole('checkbox', { name: 'Connection' }).check({ force: true });

    const urlInput = page.getByRole('textbox', { name: 'URL' });
    await expect(urlInput).toBeVisible();
    await expect(urlInput).toHaveValue('http://trino.example.com:8080');
  });

  test('impersonation toggle is visible in connection config', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);
    await page.getByRole('checkbox', { name: 'Connection' }).check({ force: true });

    await expect(page.getByLabel('User impersonation')).toBeVisible();
  });

  test('switching to basic auth reveals credential fields', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);
    await page.getByRole('checkbox', { name: 'Connection' }).check({ force: true });

    // No credentials visible for 'none' auth
    await expect(page.getByLabel('Username')).not.toBeVisible();
    await expect(page.getByLabel('Password')).not.toBeVisible();

    // Switch to basic auth — native DOM click reliably triggers Svelte's bind:group
    // reactivity in Firefox CI, unlike Playwright's synthesised click/check.
    await page.getByRole('radio', { name: 'Basic' }).evaluate((el: HTMLInputElement) => el.click());

    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('null cell values render as italic null placeholder', async ({ page }) => {
    const { url, stop } = await startMockTrinoServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'q-null',
          columns: [{ name: 'value', type: 'varchar' }],
          data: [[null], ['hello']],
          stats: { state: 'FINISHED' }
        })
      );
    });
    await page.addInitScript((trinoUrl) => {
      localStorage.setItem('trino_url', trinoUrl);
    }, url);

    try {
      await page.goto('/trino');
      await waitForHydration(page);
      await page.getByRole('button', { name: 'Run query' }).click();

      const table = page.getByRole('table');
      await expect(table).toBeVisible();
      await expect(table.getByText('null')).toBeVisible();
      await expect(table.getByText('hello')).toBeVisible();
    } finally {
      await stop();
    }
  });
});
