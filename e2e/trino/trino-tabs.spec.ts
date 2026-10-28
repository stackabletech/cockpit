import { test, expect } from '../support/fixtures.js';
import { waitForHydration, waitForQueryComplete, setTabState } from '../support/helpers';

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

  test('tab panel is labelled by the active tab', async ({ page }) => {
    await setTabState(page, [{ sql: 'SELECT 1' }, { sql: 'SELECT 2' }]);
    await page.goto('/trino');
    await waitForHydration(page);

    const tabs = page.getByRole('tab');
    await tabs.nth(1).click();
    const activeTabId = await tabs.nth(1).getAttribute('id');

    await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', activeTabId!);
  });

  test('overflowing tabs fade at the clipped edge and update on resize', async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 844 });
    await setTabState(
      page,
      Array.from({ length: 8 }, (_, i) => ({ sql: `SELECT ${i + 1}` }))
    );
    await page.goto('/trino');
    await waitForHydration(page);

    const strip = page.getByRole('tablist').locator('..');
    const fade = (side: 'left' | 'right') =>
      strip.evaluate((el, s) => (el as HTMLElement).style.getPropertyValue(`--fade-${s}`), side);

    // Everything fits on a wide screen
    await expect.poll(() => fade('right')).toBe('0px');
    expect(await fade('left')).toBe('0px');

    // Narrowing does not scroll, so only the resize can reveal the overflow
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => fade('right')).toBe('var(--fade-size)');
    expect(await fade('left')).toBe('0px');

    await page.getByRole('tab').last().focus();
    await expect.poll(() => fade('left')).toBe('var(--fade-size)');
  });

  test('create new tab via + button', async ({ page }) => {
    await page.getByRole('button', { name: 'New tab' }).click();

    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveCount(2);
    // New tab should be active.
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  });

  test('switch between tabs preserves SQL content', async ({ page }) => {
    await setTabState(page, [{ sql: 'SELECT 1 AS first' }, { sql: 'SELECT 2 AS second' }]);
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
    await setTabState(page, [{ sql: 'SELECT 1' }, { sql: 'SELECT 2' }]);
    await page.goto('/trino');
    await waitForHydration(page);

    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveCount(2);

    // Close the first tab (close button is a sibling of the tab button).
    const closeBtn = tabs
      .nth(0)
      .locator('..')
      .getByRole('button', { name: /Close tab/, includeHidden: true });
    await closeBtn.click();

    await expect(tabs).toHaveCount(1);
  });

  test('Delete on a focused tab closes it', async ({ page }) => {
    await setTabState(page, [{ sql: 'SELECT 1' }, { sql: 'SELECT 2' }]);
    await page.goto('/trino');
    await waitForHydration(page);

    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0)).toHaveAttribute('aria-keyshortcuts', 'Delete F2');

    await tabs.nth(0).focus();
    await page.keyboard.press('Delete');

    await expect(tabs).toHaveCount(1);
    await expect(tabs.nth(0)).toBeFocused();
    await expect(tabs.nth(0)).toHaveAttribute('aria-keyshortcuts', 'F2');
  });

  test('Delete on the first of three tabs keeps focus on the newly active tab', async ({
    page
  }) => {
    await setTabState(page, [{ sql: 'SELECT 1' }, { sql: 'SELECT 2' }, { sql: 'SELECT 3' }]);
    await page.goto('/trino');
    await waitForHydration(page);

    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(3);

    await tabs.nth(0).click();
    await page.keyboard.press('Delete');

    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(0)).toBeFocused();
  });

  test('close non-active tab removes it and preserves active tab', async ({ page }) => {
    await setTabState(page, [{ sql: 'SELECT 1' }, { sql: 'SELECT 2' }]);
    await page.goto('/trino');
    await waitForHydration(page);

    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveCount(2);

    // Switch to the second tab to make it active
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

    // Close the first (non-active) tab
    const closeBtn = tabs
      .nth(0)
      .locator('..')
      .getByRole('button', { name: /Close tab/, includeHidden: true });
    await closeBtn.click();

    // Only one tab remains with default label — it should still be active
    await expect(page.locator('[role="tab"]')).toHaveCount(1);
    await expect(page.locator('[role="tab"]').nth(0)).toHaveAttribute('aria-selected', 'true');
  });

  test('cannot close last remaining tab', async ({ page }) => {
    // With only one tab, close button should not be visible.
    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveCount(1);

    const closeBtn = tabs
      .nth(0)
      .locator('..')
      .getByRole('button', { name: /Close tab/, includeHidden: true });
    await expect(closeBtn).toHaveCount(0);
  });

  test('tab without custom label shows default name', async ({ page }) => {
    await setTabState(page, [{ sql: 'SELECT * FROM users' }]);
    await page.goto('/trino');
    await waitForHydration(page);

    const tab = page.locator('[role="tab"]').first();
    await expect(tab).toContainText('Untitled');
  });

  test('double-click to rename tab', async ({ page }) => {
    await setTabState(page, [{ sql: 'SELECT 1' }]);
    await page.goto('/trino');
    await waitForHydration(page);

    const tab = page.locator('[role="tab"]').first();
    await tab.dblclick();

    // Input should appear in place of the tab.
    const input = page.getByRole('textbox', { name: 'Rename tab' });
    await expect(input).toBeVisible();

    await input.fill('My custom name');
    await input.press('Enter');

    await expect(tab).toContainText('My custom name');
  });

  test('tab limit enforced — add button disappears at 8 tabs', async ({ page }) => {
    const tabs = Array.from({ length: 8 }, (_, i) => ({ sql: `SELECT ${i + 1}` }));
    await setTabState(page, tabs);
    await page.goto('/trino');
    await waitForHydration(page);

    await expect(page.locator('[role="tab"]')).toHaveCount(8);
    await expect(page.getByRole('button', { name: 'New tab' })).toHaveCount(0);
  });

  test('query execution is scoped to active tab', async ({ page }) => {
    await setTabState(page, [{ sql: 'SELECT id, name FROM users' }, { sql: 'SELECT 2' }]);
    await page.goto('/trino');
    await waitForHydration(page);
    // Wait for Monaco editor to be fully initialised.
    await page.locator('[data-ready]').first().waitFor({ timeout: 15_000 });

    // Focus editor and run query on first tab.
    await page.locator('.monaco-editor').first().click();
    await page.getByRole('button', { name: 'Run', exact: true }).click();
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
      { sql: 'SELECT 1', label: 'Tab A' },
      { sql: 'SELECT 2', label: 'Tab B' }
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
