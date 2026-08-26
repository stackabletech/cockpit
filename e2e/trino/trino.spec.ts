import { test, expect } from '@playwright/test';
import { waitForHydration, waitForQueryComplete, setTabSql } from '../support/helpers';

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
    await expect(page.getByRole('link', { name: 'SQL editor' })).toBeVisible();
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

    await expect(page.getByText('Rows 1–25 of 60')).toBeVisible();

    const firstBtn = page.getByRole('button', { name: 'First page' });
    const prevBtn = page.getByRole('button', { name: 'Previous page' });
    const nextBtn = page.getByRole('button', { name: 'Next page' });
    const lastBtn = page.getByRole('button', { name: 'Last page' });

    // First page: first/prev disabled, next/last enabled
    await expect(firstBtn).toBeDisabled();
    await expect(prevBtn).toBeDisabled();
    await expect(nextBtn).toBeEnabled();
    await expect(lastBtn).toBeEnabled();

    // Navigate to middle page: all buttons enabled
    await nextBtn.click();
    await expect(page.getByText('Rows 26–50 of 60')).toBeVisible();
    await expect(firstBtn).toBeEnabled();
    await expect(prevBtn).toBeEnabled();
    await expect(nextBtn).toBeEnabled();
    await expect(lastBtn).toBeEnabled();

    // Navigate to last page: next/last disabled, first/prev enabled
    await lastBtn.click();
    await expect(page.getByText('Rows 51–60 of 60')).toBeVisible();
    await expect(firstBtn).toBeEnabled();
    await expect(prevBtn).toBeEnabled();
    await expect(nextBtn).toBeDisabled();
    await expect(lastBtn).toBeDisabled();

    // Navigate back to first page
    await firstBtn.click();
    await expect(page.getByText('Rows 1–25 of 60')).toBeVisible();
    await expect(firstBtn).toBeDisabled();
    await expect(prevBtn).toBeDisabled();

    // prev from middle page
    await nextBtn.click();
    await prevBtn.click();
    await expect(page.getByText('Rows 1–25 of 60')).toBeVisible();
  });

  test('multi-statement script shows results for each statement', async ({ page }) => {
    await setTabSql(page, 'SELECT 1; SELECT 2');
    await page.goto('/trino');
    await waitForHydration(page);
    await page.locator('.monaco-editor').first().click();

    await page.keyboard.press('Control+Shift+Enter');
    await waitForQueryComplete(page);

    await expect(page.getByRole('button', { name: 'Toggle statement 1 results' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Toggle statement 2 results' })).toBeVisible();
  });

  test('failed statement shows skipped count', async ({ page }) => {
    await setTabSql(page, 'SELECT 1; SHOULD_ERROR; SELECT 3');
    await page.goto('/trino');
    await waitForHydration(page);
    await page.locator('.monaco-editor').first().click();

    await page.keyboard.press('Control+Shift+Enter');
    await waitForQueryComplete(page);

    await expect(page.getByText('Statement 2 of 3')).toBeVisible();
    await expect(page.getByText('1 statement was skipped due to a preceding error.')).toBeVisible();
  });

  test('statement highlighting appears during multi-statement execution', async ({ page }) => {
    await setTabSql(page, 'SELECT 1; SELECT 2');
    await page.goto('/trino');
    await waitForHydration(page);
    await page.locator('.monaco-editor').first().click();

    await page.keyboard.press('Control+Shift+Enter');
    await waitForQueryComplete(page);

    // After completion, highlight should be cleared.
    await expect(page.locator('.highlighted-statement')).toHaveCount(0);
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
