import { test, expect } from '@playwright/test';
import { waitForHydration } from '../support/helpers';

/**
 * Select catalog + schema in the toolbar and wait for the diagram to load
 * the tables of that schema as nodes.
 */
async function loadDiagram(page: import('@playwright/test').Page) {
  await page.getByLabel('Default catalog').selectOption('tpch');
  await page.getByLabel('Default schema').selectOption('sf1');
  await page.getByRole('button', { name: 'Load tables' }).click();
}

test.describe('SQL query builder', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(async ({ page }) => {
    // Reuse the Trino context configured by the SQL editor tests (env-based).
    await page.goto('/sql-diagram');
    await waitForHydration(page);
  });

  test('is reachable as a second tab of the Trino module', async ({ page }) => {
    const tabs = page.getByRole('navigation', { name: 'Trino views' });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'Query builder' })).toHaveAttribute(
      'aria-current',
      'page'
    );

    // The tab navigates back to the SQL editor.
    await tabs.getByRole('link', { name: 'SQL editor' }).click();
    await expect(page).toHaveURL(/\/trino$/);

    // And from there into the query builder again.
    await page.getByRole('navigation', { name: 'Trino views' }).waitFor();
    await page
      .getByRole('navigation', { name: 'Trino views' })
      .getByRole('link', { name: 'Query builder' })
      .click();
    await expect(page).toHaveURL(/\/sql-diagram$/);
  });

  test('loads tables of a schema onto the canvas', async ({ page }) => {
    await loadDiagram(page);

    // Only BASE TABLE entries become diagram nodes — views are filtered out.
    const canvas = page.locator('.svelte-flow');
    await expect(canvas.getByText('customer', { exact: true })).toBeVisible();
    await expect(canvas.getByText('orders', { exact: true })).toBeVisible();
    await expect(canvas.getByText('customer_view')).toHaveCount(0);
    await expect(canvas.getByText('customer_mv')).toHaveCount(0);
  });

  test('shows columns and updates the assembled SQL permanently', async ({ page }) => {
    await loadDiagram(page);

    // DESCRIBE metadata is shown per column with its data type.
    const customerNode = page.locator('.svelte-flow__node', { hasText: 'customer' }).first();
    await expect(customerNode.getByText('custkey', { exact: true })).toBeVisible();

    // The assembled SQL panel is always visible, initially empty.
    const sqlPanel = page.getByTestId('assembled-sql');
    const emptyHint = page.getByText('Select columns on a table to assemble a query.');
    await expect(emptyHint).toBeVisible();

    // Tick a column → SQL appears immediately in the permanent panel,
    // with the selected catalog and schema qualified in the FROM clause.
    await customerNode.getByRole('checkbox', { name: 'Select column customer.custkey' }).check();
    await expect(sqlPanel).toContainText('SELECT customer.custkey');
    await expect(sqlPanel).toContainText('FROM tpch.sf1.customer');

    // Untick again → back to the empty hint.
    await customerNode.getByRole('checkbox', { name: 'Select column customer.custkey' }).uncheck();
    await expect(emptyHint).toBeVisible();
  });

  test('runs the assembled query against Trino and shows results', async ({ page }) => {
    await loadDiagram(page);

    const customerNode = page.locator('.svelte-flow__node', { hasText: 'customer' }).first();
    await customerNode.getByRole('checkbox', { name: 'Select all columns of customer' }).check();

    await page.getByTestId('diagram-run').click();

    // The mock Trino returns id/name rows for unmatched statements.
    const results = page.getByTestId('sql-diagram-panel');
    await expect(results.getByText('Alice')).toBeVisible();
    await expect(results.getByText('Bob')).toBeVisible();
    await expect(results.getByRole('columnheader', { name: 'id' })).toBeVisible();
    await expect(results.getByRole('columnheader', { name: 'name' })).toBeVisible();
  });
});
