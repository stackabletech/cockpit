import { test, expect } from '@playwright/test';
import { waitForHydration, waitForQueryComplete, setTabState } from './helpers';

test.describe('Trino editor tabs', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(async ({ page }) => {
    await page.goto('/trino');
    await waitForHydration(page);
  });

  test('default state shows one tab', async ({ page }) => {
    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveCount(1);
  });

  test('create new tab via + button', async ({ page }) => {
    await page.getByRole('button', { name: 'New tab' }).click();

    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveCount(2);
    // New tab should be active.
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  });

  test('switch between tabs preserves SQL content', async ({ page }) => {
    await setTabState(page, [
      { id: '2e57e7f1-43be-42a1-95f6-2fb3c8c45e33', sql: 'SELECT 1 AS first' },
      { id: '642f03a2-7d98-4b12-922f-f21a9ec6188d', sql: 'SELECT 2 AS second' }
    ]);
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
    await setTabState(page, [
      { id: '2e57e7f1-43be-42a1-95f6-2fb3c8c45e33', sql: 'SELECT 1' },
      { id: '642f03a2-7d98-4b12-922f-f21a9ec6188d', sql: 'SELECT 2' }
    ]);
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
    // With only one tab, close button should not be visible.
    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveCount(1);

    const closeBtn = tabs.nth(0).getByRole('button', { name: /Close tab/ });
    await expect(closeBtn).toHaveCount(0);
  });

  test('tab without custom label shows default name', async ({ page }) => {
    await setTabState(page, [
      { id: '2e57e7f1-43be-42a1-95f6-2fb3c8c45e33', sql: 'SELECT * FROM users' }
    ]);
    await page.goto('/trino');
    await waitForHydration(page);

    const tab = page.locator('[role="tab"]').first();
    await expect(tab).toContainText('Untitled');
  });

  test('double-click to rename tab', async ({ page }) => {
    await setTabState(page, [{ id: '2e57e7f1-43be-42a1-95f6-2fb3c8c45e33', sql: 'SELECT 1' }]);
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
    const tabIds = [
      '2e57e7f1-43be-42a1-95f6-2fb3c8c45e33',
      '642f03a2-7d98-4b12-922f-f21a9ec6188d',
      'd85ef5ed-8092-4f27-9d82-69c3d41b6ce1',
      '08b6f5ec-a8e4-427f-8e87-c7dd09757771',
      'f6aaf21d-4685-44c6-97da-ce6f626c32ba',
      'c59569d1-d68b-41e4-a141-c1775f28221d',
      '907b9d67-38ca-421f-9687-c85d640619be',
      'f240cb08-ee23-49b0-aed6-dc6411ee6e92'
    ];
    const tabs = tabIds.map((id, i) => ({ id, sql: `SELECT ${i + 1}` }));
    await setTabState(page, tabs);
    await page.goto('/trino');
    await waitForHydration(page);

    await expect(page.locator('[role="tab"]')).toHaveCount(8);
    await expect(page.getByRole('button', { name: 'New tab' })).toHaveCount(0);
  });

  test('query execution is scoped to active tab', async ({ page }) => {
    await setTabState(page, [
      { id: '2e57e7f1-43be-42a1-95f6-2fb3c8c45e33', sql: 'SELECT id, name FROM users' },
      { id: '642f03a2-7d98-4b12-922f-f21a9ec6188d', sql: 'SELECT 2' }
    ]);
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
    await setTabState(page, [
      { id: '2e57e7f1-43be-42a1-95f6-2fb3c8c45e33', sql: 'SELECT 1', label: 'Tab A' },
      { id: '642f03a2-7d98-4b12-922f-f21a9ec6188d', sql: 'SELECT 2', label: 'Tab B' }
    ]);
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
});
