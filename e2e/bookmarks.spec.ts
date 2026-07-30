import { test, expect } from '@playwright/test';
import { waitForHydration } from './support/helpers';

test.describe('Dashboard bookmarks', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('dashboard_bookmarks');
    });
  });

  test('shows Add Bookmark button on dashboard', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await expect(page.getByRole('button', { name: '+ Add Bookmark' })).toBeVisible();
  });

  test('opens modal when Add Bookmark is clicked', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: '+ Add Bookmark' }).click();

    await expect(page.locator('dialog[open]')).toBeVisible();
  });

  test('modal shows product selection and form fields', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: '+ Add Bookmark' }).click();

    await expect(page.locator('dialog[open]')).toBeVisible();

    // Product buttons are visible (names are inside buttons with logos/initials)
    await expect(page.locator('button[aria-pressed]').filter({ hasText: 'Trino' })).toBeVisible();
    await expect(
      page.locator('button[aria-pressed]').filter({ hasText: 'Superset' })
    ).toBeVisible();

    // Open in options
    await expect(page.getByText('Inside Cockpit')).toBeVisible();
    await expect(page.getByText('New Tab')).toBeVisible();

    // Form fields
    await expect(page.getByLabel('Name')).toBeVisible();
    await expect(page.getByLabel(/Environment/)).toBeVisible();
    await expect(page.getByLabel('URL')).toBeVisible();

    // Pinned checkbox label
    await expect(page.getByText('Pinned to the sidebar by default')).toBeVisible();

    // Preview section
    await expect(page.getByText('Preview')).toBeVisible();
  });

  test('selecting a product fills the default name', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: '+ Add Bookmark' }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.locator('button[aria-pressed]').filter({ hasText: 'Superset' }).click();

    await expect(page.getByLabel('Name')).toHaveValue('Dashboards');
  });

  test('preview updates as user fills the form', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: '+ Add Bookmark' }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.getByLabel('Name').fill('My Dashboard');
    await page.getByLabel('URL').fill('https://superset.example.com');

    await expect(page.getByText('superset.example.com')).toBeVisible();
  });

  test('adds a bookmark and shows it on the dashboard', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: '+ Add Bookmark' }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.locator('button[aria-pressed]').filter({ hasText: 'Superset' }).click();
    await page.getByLabel('Name').fill('Dashboards');
    await page.getByLabel('URL').fill('https://superset.example.com');

    await page.locator('dialog[open]').getByRole('button', { name: '+ Add Bookmark' }).click();

    // Bookmark section is visible
    await expect(page.getByRole('heading', { name: 'Bookmarks' })).toBeVisible();
    await expect(page.getByText('Dashboards')).toBeVisible();
    await expect(page.getByText('superset.example.com')).toBeVisible();
  });

  test('bookmark persists in localStorage', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: '+ Add Bookmark' }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.locator('button[aria-pressed]').filter({ hasText: 'Superset' }).click();
    await page.getByLabel('Name').fill('Dashboards');
    await page.getByLabel('URL').fill('https://superset.example.com');

    await page.locator('dialog[open]').getByRole('button', { name: '+ Add Bookmark' }).click();

    const stored = await page.evaluate(() => localStorage.getItem('dashboard_bookmarks'));
    expect(stored).toBeTruthy();

    const bookmarks = JSON.parse(stored!);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0].name).toBe('Dashboards');
  });

  test('removes a bookmark', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: '+ Add Bookmark' }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.locator('button[aria-pressed]').filter({ hasText: 'Superset' }).click();
    await page.getByLabel('Name').fill('Dashboards');
    await page.getByLabel('URL').fill('https://superset.example.com');

    await page.locator('dialog[open]').getByRole('button', { name: '+ Add Bookmark' }).click();

    await page.getByRole('button', { name: 'Remove bookmark' }).click();

    await expect(page.getByText('Dashboards')).not.toBeVisible();
  });
});
