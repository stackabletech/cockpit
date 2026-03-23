import { test, expect } from '@playwright/test';
import { waitForHydration, waitForQueryComplete } from './helpers';

/**
 * Helper to set up tab state in localStorage before page load.
 * Creates a single tab with the given SQL, or multiple tabs.
 */
function setTabState(
  tabs: { id: string; sql: string; label?: string | null }[],
  activeTabId?: string
) {
  return (page: import('@playwright/test').Page) =>
    page.addInitScript(
      ({ tabs, activeTabId }) => {
        const state = {
          tabs: tabs.map((t) => ({
            id: t.id,
            sql: t.sql,
            label: t.label ?? null,
            createdAt: Date.now()
          })),
          activeTabId: activeTabId ?? tabs[0].id
        };
        localStorage.setItem('trino_tabs', JSON.stringify(state));
      },
      { tabs, activeTabId }
    );
}

test.describe('Trino editor tabs', () => {
  test.use({ locale: 'en-US' });

  test('default state shows one tab', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveCount(1);
  });

  test('create new tab via + button', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'New tab' }).click();

    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveCount(2);
    // New tab should be active.
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  });

  test('switch between tabs preserves SQL content', async ({ page }) => {
    await setTabState([
      { id: '00000000-0000-0000-0000-000000000001', sql: 'SELECT 1 AS first' },
      { id: '00000000-0000-0000-0000-000000000002', sql: 'SELECT 2 AS second' }
    ])(page);

    await page.goto('/trino');
    await waitForHydration(page);

    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveCount(2);

    // First tab is active, click second tab.
    await tabs.nth(1).click();

    // Click back to first tab.
    await tabs.nth(0).click();

    // Both tabs should still exist.
    await expect(tabs).toHaveCount(2);
  });

  test('close tab removes it and activates adjacent', async ({ page }) => {
    await setTabState([
      { id: '00000000-0000-0000-0000-000000000001', sql: 'SELECT 1' },
      { id: '00000000-0000-0000-0000-000000000002', sql: 'SELECT 2' }
    ])(page);

    await page.goto('/trino');
    await waitForHydration(page);

    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveCount(2);

    // Close the first tab.
    const closeBtn = tabs.nth(0).getByRole('button', { name: /Close tab/ });
    await closeBtn.click();

    await expect(tabs).toHaveCount(1);
  });

  test('cannot close last remaining tab', async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);

    // With only one tab, close button should not be visible.
    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveCount(1);

    const closeBtn = tabs.nth(0).getByRole('button', { name: /Close tab/ });
    await expect(closeBtn).toHaveCount(0);
  });

  test('tab name is auto-derived from SQL content', async ({ page }) => {
    await setTabState([{ id: '00000000-0000-0000-0000-000000000001', sql: 'SELECT * FROM users' }])(
      page
    );

    await page.goto('/trino');
    await waitForHydration(page);

    const tab = page.locator('[role="tab"]').first();
    await expect(tab).toContainText('SELECT * FROM users');
  });

  test('double-click to rename tab', async ({ page }) => {
    await setTabState([{ id: '00000000-0000-0000-0000-000000000001', sql: 'SELECT 1' }])(page);

    await page.goto('/trino');
    await waitForHydration(page);

    const tab = page.locator('[role="tab"]').first();
    await tab.dblclick();

    // Input should appear.
    const input = tab.getByRole('textbox', { name: 'Rename tab' });
    await expect(input).toBeVisible();

    await input.fill('My custom name');
    await input.press('Enter');

    await expect(tab).toContainText('My custom name');
  });

  test('tab limit enforced — add button disappears at 8 tabs', async ({ page }) => {
    const tabs = Array.from({ length: 8 }, (_, i) => ({
      id: `00000000-0000-0000-0000-00000000000${i + 1}`,
      sql: `SELECT ${i + 1}`
    }));
    await setTabState(tabs)(page);

    await page.goto('/trino');
    await waitForHydration(page);

    await expect(page.locator('[role="tab"]')).toHaveCount(8);
    await expect(page.getByRole('button', { name: 'New tab' })).toHaveCount(0);
  });

  test('query execution is scoped to active tab', async ({ page }) => {
    await setTabState([
      { id: '00000000-0000-0000-0000-000000000001', sql: 'SELECT id, name FROM users' },
      { id: '00000000-0000-0000-0000-000000000002', sql: 'SELECT 2' }
    ])(page);

    await page.goto('/trino');
    await waitForHydration(page);

    // Run query on first tab.
    await page.getByRole('button', { name: 'Run query' }).click();
    await waitForQueryComplete(page);

    // Results should be visible.
    const table = page.getByRole('table', { name: 'Query results' });
    await expect(table).toBeVisible();

    // Switch to second tab — results should not carry over.
    const tabs = page.locator('[role="tab"]');
    await tabs.nth(1).click();
    await expect(page.getByText('No results')).toBeVisible();
  });

  test('page reload preserves tabs via localStorage', async ({ page }) => {
    await setTabState([
      { id: '00000000-0000-0000-0000-000000000001', sql: 'SELECT 1', label: 'Tab A' },
      { id: '00000000-0000-0000-0000-000000000002', sql: 'SELECT 2', label: 'Tab B' }
    ])(page);

    await page.goto('/trino');
    await waitForHydration(page);

    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0)).toContainText('Tab A');
    await expect(tabs.nth(1)).toContainText('Tab B');

    // Reload the page.
    await page.reload();
    await waitForHydration(page);

    await expect(page.locator('[role="tab"]')).toHaveCount(2);
    await expect(page.locator('[role="tab"]').nth(0)).toContainText('Tab A');
    await expect(page.locator('[role="tab"]').nth(1)).toContainText('Tab B');
  });

  test('legacy trino_sql key is migrated to tab state', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('trino_sql', 'SELECT legacy_query FROM old_table');
      localStorage.removeItem('trino_tabs');
    });

    await page.goto('/trino');
    await waitForHydration(page);

    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveCount(1);
    await expect(tabs.first()).toContainText('SELECT legacy_query FROM');
  });
});
