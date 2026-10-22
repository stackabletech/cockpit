import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.js';
import { hasGarageCredentials, requireGarageCredentials } from './support/garage.js';
import { setTabSql, setTabState, waitForHydration, waitForQueryComplete } from './support/helpers';
import { connectAndOpenPrefix, connectToStorage } from './storage/helpers.js';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const THEMES = ['light', 'dark'] as const;

async function expectNoViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id} [${v.impact}] ${n.target.join(' ')}: ${n.failureSummary}`)
  );
  expect(summary).toEqual([]);
}

for (const theme of THEMES) {
  test.describe(`Accessibility (axe, ${theme} theme)`, () => {
    test.use({ locale: 'en-US' });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
    });

    test.describe('logged out', () => {
      test.use({ storageState: { cookies: [], origins: [] } });

      test('login page', async ({ page }) => {
        await page.goto('/auth/login');
        await waitForHydration(page);
        await expectNoViolations(page);
      });
    });

    test('dashboard', async ({ page }) => {
      await page.goto('/');
      await waitForHydration(page);
      await expectNoViolations(page);
    });

    test('Trino editor with query results', async ({ page }) => {
      await setTabSql(page, 'SELECT id, name FROM users');
      await page.goto('/trino');
      await waitForHydration(page);
      // Waits for Monaco to load and sets the cursor that "Run at cursor" needs
      await page.locator('.monaco-editor').first().click();
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      await waitForQueryComplete(page);
      await expect(page.getByRole('table', { name: 'Query results' })).toBeVisible();
      await expectNoViolations(page);
    });

    test('Trino run mode menu open', async ({ page }) => {
      await page.goto('/trino');
      await waitForHydration(page);
      await page.getByRole('button', { name: 'Select run mode' }).click();
      await expect(page.getByRole('menu', { name: 'Select run mode' })).toBeVisible();
      await expectNoViolations(page);
    });

    test('Trino editor with two tabs', async ({ page }) => {
      await setTabState(page, [{ sql: 'SELECT 1' }, { sql: 'SELECT 2' }]);
      await page.goto('/trino');
      await waitForHydration(page);
      await expect(page.getByRole('tab')).toHaveCount(2);
      await expectNoViolations(page);
    });

    test('storage connect form', async ({ page }) => {
      await page.goto('/storage');
      await waitForHydration(page);
      await expectNoViolations(page);
    });

    test('storage connection settings', async ({ page }) => {
      await page.goto('/settings/connections');
      await waitForHydration(page);
      await expectNoViolations(page);
    });

    test.describe('with storage', () => {
      test.beforeEach(() => {
        test.skip(
          !hasGarageCredentials(),
          'Skipped: no s3-config.json found (requires a running Garage instance)'
        );
      });

      test('storage overview when connected', async ({ page }) => {
        await connectToStorage(page, requireGarageCredentials());
        await expectNoViolations(page);
      });

      test('bucket object list', async ({ page }) => {
        await connectAndOpenPrefix(page, requireGarageCredentials());
        await expectNoViolations(page);
      });

      test('bucket object list with two tabs', async ({ page }) => {
        await connectAndOpenPrefix(page, requireGarageCredentials());
        await page.getByRole('button', { name: 'New Tab' }).click();
        await expect(page.getByRole('tab')).toHaveCount(2);
        await expectNoViolations(page);
      });
    });
  });
}
