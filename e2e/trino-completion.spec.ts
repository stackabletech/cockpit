import { test, expect } from '@playwright/test';
import { waitForHydration, setTabSql } from './helpers';

test.describe('Trino editor code completion', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(async ({ page }) => {
    await setTabSql(page, '');
    await page.goto('/trino');
    await waitForHydration(page);
    await page.locator('.monaco-editor').first().click();
  });

  test('suggests catalogs after FROM', async ({ page }) => {
    await page.keyboard.type('SELECT * FROM ');
    // Force the suggestion widget open (it also opens on typing, but be explicit).
    await page.keyboard.press('Control+Space');
    const widget = page.locator('.monaco-editor .suggest-widget');
    await expect(widget).toBeVisible();
    await expect(widget.getByText('tpch', { exact: true })).toBeVisible();
  });

  test('suggests keywords when starting a statement', async ({ page }) => {
    await page.keyboard.type('SEL');
    await page.keyboard.press('Control+Space');
    const widget = page.locator('.monaco-editor .suggest-widget');
    await expect(widget).toBeVisible();
    await expect(widget.getByText('SELECT', { exact: true })).toBeVisible();
  });
});
