import { test, expect } from '@playwright/test';
import { waitForHydration, waitForQueryComplete, setTabSql } from './helpers';

test.describe('Trino query editor', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(async ({ page }) => {
    await setTabSql(page, 'SELECT id, name FROM users');
    await page.goto('/trino');
    await waitForHydration(page);
    // Focus the editor so the cursor position is set for "Run at cursor".
    await page.locator('.monaco-editor').first().click();
  });

  test('page renders with editor and results sections', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Trino' })).toBeVisible();
    await expect(page.getByText('SQL editor')).toBeVisible();
    await expect(page.getByText('Query results')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
    await expect(page.getByText('No results')).toBeVisible();
  });

  test('Trino nav item is active when on /trino', async ({ page }) => {
    const trinoLink = page.getByRole('link', { name: 'Trino', exact: true });
    await expect(trinoLink).toHaveAttribute('aria-current', 'page');
  });

  test('running a query displays the results table', async ({ page }) => {
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await waitForQueryComplete(page);

    const table = page.getByRole('table', { name: 'Query results' });
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'id' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'name' })).toBeVisible();
    await expect(table.getByRole('cell', { name: '1' })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'Alice' })).toBeVisible();
    await expect(page.getByText('Rows 1–3 of 3')).toBeVisible();
  });

  test('Ctrl+Enter triggers query execution', async ({ page }) => {
    await page.keyboard.press('Control+Enter');
    await waitForQueryComplete(page);

    await expect(page.getByRole('table', { name: 'Query results' })).toBeVisible();
  });

  test('query error is shown in an alert', async ({ page }) => {
    await setTabSql(page, 'SHOULD_ERROR');
    await page.goto('/trino');
    await waitForHydration(page);
    await page.locator('.monaco-editor').first().click();

    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await waitForQueryComplete(page);

    // Monaco also renders role="alert" nodes for its own accessibility — filter by content.
    const alert = page.getByRole('alert').filter({ hasText: 'Query error' });
    await expect(alert).toBeVisible();
    await expect(alert.getByText('syntax error at position 7')).toBeVisible();
  });

  test('pagination navigates between pages', async ({ page }) => {
    await setTabSql(page, 'SELECT id, name FROM large_table');
    await page.goto('/trino');
    await waitForHydration(page);
    await page.locator('.monaco-editor').first().click();

    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await waitForQueryComplete(page);

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

  test('null cell values render as italic null placeholder', async ({ page }) => {
    await setTabSql(page, 'SELECT value FROM nullable_table');
    await page.goto('/trino');
    await waitForHydration(page);
    await page.locator('.monaco-editor').first().click();

    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await waitForQueryComplete(page);

    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(table.getByText('null')).toBeVisible();
    await expect(table.getByText('hello')).toBeVisible();
  });
});
