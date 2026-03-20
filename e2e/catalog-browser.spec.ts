import { test, expect } from '@playwright/test';
import { waitForHydration, ensureCatalogBrowserOpen } from './helpers';

test.describe('Catalog browser', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('trino_sql', 'SELECT 1');
      localStorage.setItem('trino_catalog_browser_open', 'true');
    });
    await page.goto('/trino');
    await waitForHydration(page);
  });

  test('catalog browser panel renders with tree', async ({ page }) => {
    await ensureCatalogBrowserOpen(page);

    const browser = page.getByRole('navigation', { name: 'Catalog browser' });
    await expect(browser).toBeVisible();

    // Catalogs should load automatically when Trino is configured.
    await expect(browser.getByRole('button', { name: 'tpch' })).toBeVisible();
    await expect(browser.getByRole('button', { name: 'system' })).toBeVisible();
  });

  test('catalog browser can be toggled', async ({ page }) => {
    await ensureCatalogBrowserOpen(page);

    const browser = page.getByRole('navigation', { name: 'Catalog browser' });
    await expect(browser).toBeVisible();

    // Close the browser.
    await page.getByRole('button', { name: 'Toggle catalog browser' }).first().click();

    await expect(browser).not.toBeVisible();

    // Reopen via the same toggle button in the editor header.
    await page.getByRole('button', { name: 'Toggle catalog browser' }).click();
    await expect(browser).toBeVisible();
  });

  test('expanding a catalog loads schemas', async ({ page }) => {
    await ensureCatalogBrowserOpen(page);

    const browser = page.getByRole('navigation', { name: 'Catalog browser' });

    // Click on tpch to expand it.
    await browser.getByRole('button', { name: 'tpch' }).click();

    await expect(browser.getByText('sf1', { exact: true })).toBeVisible();
    await expect(browser.getByText('sf100')).toBeVisible();
  });

  test('expanding a schema loads tables', async ({ page }) => {
    await ensureCatalogBrowserOpen(page);

    const browser = page.getByRole('navigation', { name: 'Catalog browser' });

    // Expand tpch, then sf1.
    await browser.getByRole('button', { name: 'tpch' }).click();
    await expect(browser.getByText('sf1', { exact: true })).toBeVisible();
    await browser.getByRole('button', { name: 'sf1', exact: true }).click();

    await expect(browser.getByText('customer', { exact: true })).toBeVisible();
    await expect(browser.getByText('orders')).toBeVisible();
    await expect(browser.getByText('customer_view')).toBeVisible();
  });

  test('expanding a table loads columns', async ({ page }) => {
    await ensureCatalogBrowserOpen(page);

    const browser = page.getByRole('navigation', { name: 'Catalog browser' });

    // Navigate to tpch → sf1 → customer.
    await browser.getByRole('button', { name: 'tpch' }).click();
    await expect(browser.getByText('sf1', { exact: true })).toBeVisible();
    await browser.getByRole('button', { name: 'sf1', exact: true }).click();
    await expect(browser.getByText('customer', { exact: true })).toBeVisible();

    // Click the expand button for 'customer' (the tree node, not the insert button).
    await browser.getByRole('button', { name: 'customer' }).first().click();

    await expect(browser.getByText('custkey')).toBeVisible();
    await expect(browser.getByText('bigint')).toBeVisible();
    await expect(browser.getByText('name')).toBeVisible();
    await expect(browser.getByText('varchar').first()).toBeVisible();
  });

  test('clicking a table name inserts qualified name into editor', async ({ page }) => {
    await ensureCatalogBrowserOpen(page);

    const browser = page.getByRole('navigation', { name: 'Catalog browser' });

    // Navigate to tpch → sf1, then click the insert button for 'customer'.
    await browser.getByRole('button', { name: 'tpch' }).click();
    await expect(browser.getByText('sf1', { exact: true })).toBeVisible();
    await browser.getByRole('button', { name: 'sf1', exact: true }).click();
    await expect(browser.getByText('customer', { exact: true })).toBeVisible();

    // Wait for the Monaco editor to be fully initialised (Firefox can be slower).
    await page.locator('[data-ready]').waitFor();

    // Click the insert button (the table name text).
    await browser
      .getByRole('button', { name: 'Insert table name: tpch.sf1.customer', exact: true })
      .click();

    // The editor should now contain the inserted text.
    const editor = page.locator('.monaco-editor');
    await expect(editor).toContainText('tpch.sf1.customer');
  });

  test('schema context selectors are populated', async ({ page }) => {
    await ensureCatalogBrowserOpen(page);

    const browser = page.getByRole('navigation', { name: 'Catalog browser' });

    // The catalog dropdown should have options.
    const catalogSelect = browser.getByLabel('Default catalog');
    await expect(catalogSelect).toBeVisible();

    // Select a catalog.
    await catalogSelect.selectOption('tpch');

    // The schema dropdown should now load with schemas.
    const schemaSelect = browser.getByLabel('Default schema');
    await expect(schemaSelect).toBeEnabled();
    await schemaSelect.selectOption('sf1');
  });

  test('browser is hidden by default on mobile', async ({ page }) => {
    // Set mobile viewport.
    await page.setViewportSize({ width: 375, height: 667 });
    await page.addInitScript(() => {
      localStorage.setItem('trino_catalog_browser_open', 'false');
    });
    await page.goto('/trino');
    await waitForHydration(page);

    // Browser should not be visible, hidden by default.
    const browser = page.getByRole('navigation', { name: 'Catalog browser' });
    await expect(browser).not.toBeVisible();

    // Toggle button should be in the editor header.
    await page.getByRole('button', { name: 'Toggle catalog browser' }).click();

    // On mobile, it shows as a full-screen overlay.
    await expect(browser).toBeVisible();
  });
});
