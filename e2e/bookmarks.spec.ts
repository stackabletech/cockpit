import { test, expect } from './support/fixtures.js';
import { waitForHydration } from './support/helpers';
import { resetBookmarks } from './support/bookmarks.js';

test.describe('Dashboard bookmarks', () => {
  test.use({ locale: 'en-US' });

  const addButton = 'Add bookmark';

  test.beforeEach(async ({ page }) => {
    await resetBookmarks(page);
  });

  test.afterEach(async ({ page }) => {
    await resetBookmarks(page);
  });

  test('shows Add bookmark button on dashboard', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await expect(page.getByRole('button', { name: addButton })).toBeVisible();
  });

  test('opens modal when Add bookmark is clicked', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: addButton }).click();

    await expect(page.locator('dialog[open]')).toBeVisible();
  });

  test('modal shows product selection and form fields', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: addButton }).click();

    await expect(page.locator('dialog[open]')).toBeVisible();

    // Product buttons are visible (names are inside buttons with logos/initials)
    await expect(page.locator('button[aria-pressed]').filter({ hasText: 'Trino' })).toBeVisible();
    await expect(
      page.locator('button[aria-pressed]').filter({ hasText: 'Superset' })
    ).toBeVisible();

    // Bookmarks always open externally; no launch mode is configurable.
    await expect(page.getByText('Inside Cockpit')).not.toBeVisible();
    await expect(page.getByText('New Tab')).not.toBeVisible();

    // Form fields
    await expect(page.getByLabel('Name')).toBeVisible();
    await expect(page.getByLabel(/Environment/)).toBeVisible();
    await expect(page.getByLabel('URL')).toBeVisible();

    // Pinned checkbox label
    await expect(page.getByRole('checkbox', { name: 'Pin bookmark' })).toBeVisible();

    // Preview section
    await expect(page.getByText('Preview')).toBeVisible();
  });

  test('selecting a product fills the default name', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Add bookmark' }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.locator('button[aria-pressed]').filter({ hasText: 'Superset' }).click();

    await expect(page.getByLabel('Name')).toHaveValue('Dashboards');
  });

  test('preview updates as user fills the form', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Add bookmark' }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.getByLabel('Name').fill('My Dashboard');
    await page.getByLabel('URL').fill('https://superset.example.com');

    await expect(page.getByText('superset.example.com')).toBeVisible();
  });

  test('rejects non-HTTP bookmark URLs', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: addButton }).click();
    await page.getByLabel('Name').fill('Unsafe link');
    await page.getByLabel('URL').fill('javascript:alert(1)');
    await page.locator('dialog[open]').getByRole('button', { name: addButton }).click();

    await expect(page.locator('dialog[open]')).toBeVisible();
    await expect(page.getByText('Enter a valid HTTP or HTTPS URL.')).toBeVisible();
    await expect(page.getByLabel('URL')).toHaveAttribute('aria-invalid', 'true');
  });

  test('accepts internal URLs such as IP addresses and service names', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: addButton }).click();
    await page.getByLabel('Name').fill('Trino NodePort');
    await page.getByLabel('URL').fill('http://10.0.0.5:30443');
    await page.locator('dialog[open]').getByRole('button', { name: addButton }).click();

    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(
      page.getByLabel('Bookmarks').getByRole('link', { name: 'Trino NodePort' })
    ).toHaveAttribute('href', 'http://10.0.0.5:30443');
  });

  test('truncates long names and hostnames instead of overlapping the card buttons', async ({
    page
  }) => {
    // Names are capped at 40 characters; wide glyphs still overflow the card.
    const longName = 'W'.repeat(40);
    const longHost = `${'very-long-subdomain-'.repeat(5)}example.com`;
    await resetBookmarks(page, [
      { productId: 'superset', name: longName, url: `https://${longHost}/` }
    ]);

    await page.goto('/');
    await waitForHydration(page);

    const section = page.getByLabel('Bookmarks');
    const starBox = await section.getByRole('button', { name: 'Pin bookmark' }).boundingBox();
    const titleBox = await section.getByRole('link', { name: longName }).boundingBox();
    const hostBox = await section.getByText(longHost).boundingBox();

    expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(starBox!.x);
    expect(hostBox!.x + hostBox!.width).toBeLessThanOrEqual(starBox!.x);
  });

  test('shows the environment once, as a chip, not in the title link', async ({ page }) => {
    await resetBookmarks(page, [
      {
        productId: 'superset',
        name: 'Dashboards',
        environment: 'staging',
        url: 'https://superset.example.com'
      }
    ]);

    await page.goto('/');
    await waitForHydration(page);

    const section = page.getByLabel('Bookmarks');
    await expect(section.getByRole('link', { name: 'Dashboards', exact: true })).toBeVisible();
    await expect(section.getByText('staging', { exact: true })).toHaveCount(1);
  });

  test('prefills the default name and shows an error when it is cleared', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: addButton }).click();
    await expect(page.getByLabel('Name')).toHaveValue('SQL Editor');

    await page.getByLabel('Name').fill('');
    await page.getByLabel('URL').fill('https://trino.example.com');
    await page.locator('dialog[open]').getByRole('button', { name: addButton }).click();

    await expect(page.getByText('Enter a name.')).toBeVisible();
    await expect(page.getByLabel('Name')).toBeFocused();
  });

  test('adds a bookmark and shows it on the dashboard', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Add bookmark' }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.locator('button[aria-pressed]').filter({ hasText: 'Superset' }).click();
    await page.getByLabel('Name').fill('Dashboards');
    await page.getByLabel('URL').fill('https://superset.example.com');

    await page.locator('dialog[open]').getByRole('button', { name: 'Add bookmark' }).click();

    // Bookmark section is visible
    await expect(page.getByRole('heading', { name: 'Bookmarks' })).toBeVisible();
    await expect(page.getByLabel('Bookmarks').getByText('Dashboards')).toBeVisible();
    await expect(page.getByText('superset.example.com')).toBeVisible();
  });

  test('opens dashboard bookmark images and titles in a new tab', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: addButton }).click();
    await page.getByLabel('Name').fill('Dashboards');
    await page.getByLabel('URL').fill('https://superset.example.com');
    await page.locator('dialog[open]').getByRole('button', { name: addButton }).click();

    const bookmarkSection = page.getByLabel('Bookmarks');
    const titleLink = bookmarkSection.getByRole('link', { name: 'Dashboards' });
    // The image link duplicates the title link and is hidden from assistive technology.
    await expect(bookmarkSection.getByRole('link', { name: 'Trino' })).toHaveCount(0);
    const imageLink = bookmarkSection.locator('a[aria-hidden="true"]');

    await expect(titleLink).toHaveAttribute('href', 'https://superset.example.com');
    await expect(titleLink).toHaveAttribute('target', '_blank');
    await expect(titleLink).toHaveAttribute('rel', /noopener/);
    await expect(titleLink).toHaveAttribute('rel', /external/);
    await expect(imageLink).toHaveAttribute('href', 'https://superset.example.com');
    await expect(imageLink).toHaveAttribute('target', '_blank');
    await expect(imageLink).toHaveAttribute('rel', /noopener/);
    await expect(imageLink).toHaveAttribute('rel', /external/);
  });

  test('stores bookmarks on the server, not in the browser', async ({
    page,
    browser,
    baseURL,
    workerStorageState
  }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: addButton }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.locator('button[aria-pressed]').filter({ hasText: 'Superset' }).click();
    await page.getByLabel('Name').fill('Dashboards');
    await page.getByLabel('URL').fill('https://superset.example.com');

    await page.locator('dialog[open]').getByRole('button', { name: addButton }).click();
    await expect(page.getByLabel('Bookmarks').getByText('Dashboards')).toBeVisible();

    // A fresh browser context shares only the session cookie, no browser storage.
    const context = await browser.newContext({ baseURL, storageState: workerStorageState });
    try {
      const other = await context.newPage();
      await other.goto('/');
      await expect(other.getByLabel('Bookmarks').getByText('Dashboards')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('pins a bookmark from the dashboard with the star button', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: addButton }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.getByLabel('Name').fill('Dashboards');
    await page.getByLabel('URL').fill('https://superset.example.com');

    await page.locator('dialog[open]').getByRole('button', { name: addButton }).click();

    // Bookmark appears in the regular section unpinned.
    await expect(page.getByLabel('Bookmarks').getByText('Dashboards')).toBeVisible();

    await page.getByRole('button', { name: /pin bookmark/i }).click();

    await expect(page.getByRole('button', { name: 'Unpin bookmark Dashboards' })).toBeVisible();

    // Unpinning moves the bookmark back to the regular section
    await page.getByRole('button', { name: 'Unpin bookmark Dashboards' }).click();
    await expect(page.getByRole('button', { name: 'Pin bookmark Dashboards' })).toBeVisible();
  });

  test('names each card button after its bookmark', async ({ page }) => {
    await resetBookmarks(page, [
      {
        productId: 'superset',
        name: 'Dashboards',
        url: 'https://superset.example.com',
        pinned: true
      },
      { productId: 'airflow', name: 'Pipelines', url: 'https://airflow.example.com' }
    ]);

    await page.goto('/');
    await waitForHydration(page);

    const section = page.getByLabel('Bookmarks');
    for (const label of [
      'Edit bookmark Dashboards',
      'Unpin bookmark Dashboards',
      'Edit bookmark Pipelines',
      'Pin bookmark Pipelines'
    ]) {
      await expect(section.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
  });

  test('pins a bookmark via the checkbox in the modal', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: addButton }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.getByLabel('Name').fill('Dashboards');
    await page.getByLabel('URL').fill('https://superset.example.com');
    await page.locator('dialog[open]').getByRole('checkbox', { name: 'Pin bookmark' }).click();

    await page.locator('dialog[open]').getByRole('button', { name: addButton }).click();

    await expect(page.getByRole('button', { name: 'Unpin bookmark Dashboards' })).toBeVisible();
  });

  test('pinned state is preserved when editing a bookmark', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: addButton }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.getByLabel('Name').fill('Dashboards');
    await page.getByLabel('URL').fill('https://superset.example.com');
    await page.locator('dialog[open]').getByRole('checkbox', { name: 'Pin bookmark' }).click();

    await page.locator('dialog[open]').getByRole('button', { name: addButton }).click();

    await page.getByRole('button', { name: 'Edit bookmark Dashboards' }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await expect(
      page.locator('dialog[open]').getByRole('checkbox', { name: 'Pin bookmark' })
    ).toBeChecked();
  });

  test('edits a bookmark', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Add bookmark' }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.locator('button[aria-pressed]').filter({ hasText: 'Superset' }).click();
    await page.getByLabel('Name').fill('Dashboards');
    await page.getByLabel('URL').fill('https://superset.example.com');

    await page.locator('dialog[open]').getByRole('button', { name: 'Add bookmark' }).click();

    await page.getByRole('button', { name: 'Edit bookmark Dashboards' }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    // Modal opens prefilled and shows edit title
    await expect(
      page.locator('dialog[open]').getByRole('heading', { name: 'Edit bookmark' })
    ).toBeVisible();
    await expect(page.getByLabel('Name')).toHaveValue('Dashboards');
    await expect(page.getByLabel('URL')).toHaveValue('https://superset.example.com');

    await page.getByLabel('Name').fill('Renamed Dashboard');

    await page.locator('dialog[open]').getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByLabel('Bookmarks').getByText('Renamed Dashboard')).toBeVisible();
    await expect(page.getByLabel('Bookmarks').getByText('Dashboards')).not.toBeVisible();
  });

  test('cancel in edit dialog closes without changes', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Add bookmark' }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.locator('button[aria-pressed]').filter({ hasText: 'Superset' }).click();
    await page.getByLabel('Name').fill('Dashboards');
    await page.getByLabel('URL').fill('https://superset.example.com');

    await page.locator('dialog[open]').getByRole('button', { name: 'Add bookmark' }).click();

    await page.getByRole('button', { name: 'Edit bookmark Dashboards' }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.getByLabel('Name').fill('Not Saved');
    await page.locator('dialog[open]').getByRole('button', { name: 'Cancel' }).click();

    await expect(page.locator('dialog[open]')).not.toBeVisible();
    await expect(page.getByLabel('Bookmarks').getByText('Dashboards')).toBeVisible();
    await expect(page.getByLabel('Bookmarks').getByText('Not Saved')).not.toBeVisible();

    // Reopening the edit modal prefills the bookmark values again
    await page.getByRole('button', { name: 'Edit bookmark Dashboards' }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await expect(page.getByLabel('Name')).toHaveValue('Dashboards');
    await expect(page.getByLabel('URL')).toHaveValue('https://superset.example.com');
  });

  test('deletes a bookmark from the edit modal with confirmation', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Add bookmark' }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    await page.locator('button[aria-pressed]').filter({ hasText: 'Superset' }).click();
    await page.getByLabel('Name').fill('Dashboards');
    await page.getByLabel('URL').fill('https://superset.example.com');

    await page.locator('dialog[open]').getByRole('button', { name: 'Add bookmark' }).click();

    await page.getByRole('button', { name: 'Edit bookmark Dashboards' }).click();
    const editDialog = page.getByRole('dialog', { name: 'Edit bookmark' });
    const confirmDialog = page.getByRole('dialog', { name: 'Delete bookmark?' });
    await expect(editDialog).toBeVisible();

    // Unsaved edits survive cancelling the confirmation, by button and by Escape
    await editDialog.getByLabel('Name').fill('Renamed but not saved');
    await editDialog.getByRole('button', { name: 'Delete' }).click();
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirmDialog).toBeHidden();
    await expect(editDialog.getByLabel('Name')).toHaveValue('Renamed but not saved');

    await editDialog.getByRole('button', { name: 'Delete' }).click();
    await expect(confirmDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirmDialog).toBeHidden();
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByLabel('Name')).toHaveValue('Renamed but not saved');

    // Delete again and confirm: both dialogs close and the bookmark is gone
    await editDialog.getByRole('button', { name: 'Delete' }).click();
    await confirmDialog.getByRole('button', { name: 'Delete' }).click();
    await expect(confirmDialog).toBeHidden();
    await expect(editDialog).toBeHidden();

    await expect(page.getByLabel('Bookmarks').getByText('Dashboards')).not.toBeVisible();
  });
});
