import { test, expect, type Page } from '../support/fixtures.js';
import {
  createGarageBucketCredentials,
  hasGarageAdmin,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import { connectToStorage, openConnectForm } from './helpers.js';
import { waitForHydration } from '../support/helpers.js';

const PORT_1_ERROR = 'Could not reach the storage backend — check the host and port.';

/** Open the Options context menu for the first connection row and click Edit. */
async function openFirstConnectionEditPage(page: Page) {
  await page.locator('table tbody tr').first().waitFor();
  await page
    .getByRole('button', { name: /Options for/i })
    .first()
    .click({ force: true });
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await waitForHydration(page);
}

test.describe('Storage — Connections management', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('shows "Manage connections" link on the connect form when saved connections exist', async ({
    page
  }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await openConnectForm(page);

    await expect(page.getByRole('link', { name: 'Manage connections' })).toBeVisible();
  });

  test('navigates to /settings/connections from the manage link', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await openConnectForm(page);

    await page.getByRole('link', { name: 'Manage connections' }).click();

    await waitForHydration(page);
    await expect(page).toHaveURL('/settings/connections');
    await expect(page.getByRole('heading', { name: 'Manage connections' })).toBeVisible();
  });

  test('lists saved connections on the management page', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/settings/connections');
    await waitForHydration(page);

    // Connections are displayed in a table; at least one data row should be visible.
    await expect(page.getByRole('table').getByRole('row').nth(1)).toBeVisible();
  });

  test('Edit link on management page navigates to edit page', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/settings/connections');
    await waitForHydration(page);

    await openFirstConnectionEditPage(page);

    await expect(page.getByRole('heading', { name: 'Edit connection' })).toBeVisible();
  });

  test('edit page pre-fills with current connection values', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/settings/connections');
    await waitForHydration(page);

    await openFirstConnectionEditPage(page);

    await expect(page.getByRole('textbox', { name: 'Host' })).toHaveValue(
      new URL(credentials.endpoint).hostname
    );
    await expect(page.getByLabel('Region')).toHaveValue(credentials.region);
    await expect(page.getByLabel('Access key')).toHaveValue(credentials.accessKeyId);
  });

  test('edit page redirects to connections list after saving valid credentials', async ({
    page
  }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/settings/connections');
    await waitForHydration(page);

    await openFirstConnectionEditPage(page);

    await page.getByRole('button', { name: 'Save changes' }).click();

    await waitForHydration(page);
    await expect(page).toHaveURL('/settings/connections');
    await expect(page.getByRole('heading', { name: 'Manage connections' })).toBeVisible();
  });

  test('edit page keeps the current name when the name field is cleared', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/settings/connections');
    await waitForHydration(page);

    await openFirstConnectionEditPage(page);
    const nameInput = page.getByLabel('Connection name');
    const originalName = await nameInput.inputValue();
    expect(originalName).not.toBe('');

    await nameInput.fill('   ');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await waitForHydration(page);
    await expect(page).toHaveURL('/settings/connections');

    await openFirstConnectionEditPage(page);
    await expect(page.getByLabel('Connection name')).toHaveValue(originalName);
  });

  test('edit page requires the secret key when the access key changes', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/settings/connections');
    await waitForHydration(page);

    await openFirstConnectionEditPage(page);
    await page.getByLabel('Access key').fill('GKnewaccesskey');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(
      page.getByText('Enter the secret key that belongs to the new access key.')
    ).toBeVisible();
    await expect(page).toHaveURL(/\/edit$/);
  });

  test('edit page shows error for invalid credentials', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/settings/connections');
    await waitForHydration(page);

    await openFirstConnectionEditPage(page);

    await page.getByLabel('Secret key').fill('wrong-secret');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByText('Access denied — check your credentials.')).toBeVisible();
  });

  test('edit page tests the connection when only the endpoint changes', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/settings/connections');
    await waitForHydration(page);

    await openFirstConnectionEditPage(page);

    // Credentials stay blank (keep the stored ones); nothing listens on port 1.
    await page.getByLabel('Port').fill('1');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByText(PORT_1_ERROR)).toBeVisible();
    await expect(page).toHaveURL(/\/edit$/);
  });

  test('delete button on management page removes the connection after confirmation', async ({
    page
  }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/settings/connections');
    await waitForHydration(page);

    // Connections are displayed in a table; count data rows (excluding header).
    const dataRows = page.locator('table tbody tr');
    const initialItems = await dataRows.count();

    await page
      .getByRole('button', { name: /Options for/i })
      .first()
      .click({ force: true });
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    // Confirm deletion in the modal
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(dataRows).toHaveCount(initialItems - 1);
  });

  test('sidebar on the edit page deletes a connection', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    // Disconnecting shows the saved connections sidebar; navigate from there so it stays filled.
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByRole('heading', { name: 'Connect to storage' })).toBeVisible();
    const savedList = page.getByRole('list', { name: 'Saved connections' });
    await savedList.getByRole('button', { name: 'More options' }).first().click({ force: true });
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await waitForHydration(page);
    await expect(page.getByRole('heading', { name: 'Edit connection' })).toBeVisible();

    await savedList.getByRole('button', { name: 'More options' }).first().click({ force: true });
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page).toHaveURL('/settings/connections');
    await expect(page.locator('table tbody tr')).toHaveCount(0);
  });

  test('redirects to /settings/connections when editing a non-existent id', async ({ page }) => {
    await page.goto('/settings/connections/00000000-0000-0000-0000-000000000000/edit');
    await waitForHydration(page);

    await expect(page).toHaveURL('/settings/connections');
  });

  test('edit page shows active connection notice when editing current connection', async ({
    page
  }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/settings/connections');
    await waitForHydration(page);

    await openFirstConnectionEditPage(page);

    await expect(page.getByText('You are currently connected with this connection.')).toBeVisible();
  });

  test('edit page shows unsaved-changes modal when navigating away with dirty form', async ({
    page
  }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/settings/connections');
    await waitForHydration(page);

    await openFirstConnectionEditPage(page);

    // Make a change to mark the form dirty
    await page.getByLabel('Connection name').fill('Changed name');

    // Try to navigate away via the back link
    await page.getByRole('link', { name: '← Manage connections' }).click();

    // Modal should appear
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toBeVisible();
  });

  test('unsaved-changes modal: Stay keeps user on edit page', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/settings/connections');
    await waitForHydration(page);

    await openFirstConnectionEditPage(page);

    await page.getByLabel('Connection name').fill('Changed name');
    await page.getByRole('link', { name: '← Manage connections' }).click();

    await page.getByRole('dialog').getByRole('button', { name: 'Stay on page' }).click();

    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByRole('heading', { name: 'Edit connection' })).toBeVisible();
  });

  test('edit page without changes leaves without asking', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/settings/connections');
    await waitForHydration(page);

    await openFirstConnectionEditPage(page);
    await page.getByRole('link', { name: '← Manage connections' }).click();

    await expect(page).toHaveURL('/settings/connections');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('unsaved-changes modal: Escape stays and the guard asks again', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/settings/connections');
    await waitForHydration(page);

    await openFirstConnectionEditPage(page);

    await page.getByLabel('Connection name').fill('Changed name');
    const backLink = page.getByRole('link', { name: '← Manage connections' });
    await backLink.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page).toHaveURL(/\/edit$/);

    await backLink.click();
    await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toBeVisible();
  });

  test('unsaved-changes modal: Leave navigates away', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/settings/connections');
    await waitForHydration(page);

    await openFirstConnectionEditPage(page);

    await page.getByLabel('Connection name').fill('Changed name');
    await page.getByRole('link', { name: '← Manage connections' }).click();

    await page.getByRole('dialog').getByRole('button', { name: 'Leave' }).click();

    await waitForHydration(page);
    await expect(page).toHaveURL('/settings/connections');
  });
});

test.describe('Storage — Connection edit sidebar', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials() || !hasGarageAdmin(),
      'Skipped: requires a running Garage instance with admin access'
    );
  });

  /**
   * Saves two connections that differ in their access key, then opens the edit page of the most
   * recent one from the saved connections sidebar, which stays filled when navigated from there.
   * Returns the access keys in sidebar order.
   */
  async function openEditWithTwoConnections(page: Page): Promise<[string, string]> {
    const base = requireGarageCredentials();
    const second = await createGarageBucketCredentials(base, {
      bucketName: 'e2e-connection-edit-sidebar',
      keyName: 'e2e-connection-edit-sidebar',
      permissions: { owner: false, read: true, write: false }
    });
    await connectToStorage(page, base);
    await connectToStorage(page, second, { clearSaved: false });

    await page.getByRole('button', { name: 'Disconnect' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByRole('heading', { name: 'Connect to storage' })).toBeVisible();
    const savedList = page.getByRole('list', { name: 'Saved connections' });
    await expect(savedList.getByRole('listitem')).toHaveCount(2);
    await savedList.getByRole('button', { name: 'More options' }).first().click({ force: true });
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await waitForHydration(page);
    await expect(page.getByRole('heading', { name: 'Edit connection' })).toBeVisible();

    // Most recently saved first.
    return [second.accessKeyId, base.accessKeyId];
  }

  function sidebarConnection(page: Page, index: number) {
    return page
      .getByRole('list', { name: 'Saved connections' })
      .getByRole('listitem')
      .nth(index)
      .getByRole('button')
      .first();
  }

  async function deleteFromSidebar(page: Page, index: number) {
    await page
      .getByRole('list', { name: 'Saved connections' })
      .getByRole('button', { name: 'More options' })
      .nth(index)
      .click({ force: true });
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  }

  test('switching connections loads the other connection without asking', async ({ page }) => {
    const [firstKey, secondKey] = await openEditWithTwoConnections(page);
    await expect(page.getByLabel('Access key')).toHaveValue(firstKey);
    const firstUrl = page.url();

    await sidebarConnection(page, 1).click();

    await expect(page).not.toHaveURL(firstUrl);
    await expect(page.getByLabel('Access key')).toHaveValue(secondKey);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The switch must not leave the form tainted.
    await page.getByRole('link', { name: '← Manage connections' }).click();
    await expect(page).toHaveURL('/settings/connections');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('switching connections with unsaved changes asks first', async ({ page }) => {
    await openEditWithTwoConnections(page);
    const firstUrl = page.url();

    await page.getByLabel('Connection name').fill('Changed name');
    await sidebarConnection(page, 1).click();

    await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Stay on page' }).click();
    await expect(page).toHaveURL(firstUrl);
    await expect(page.getByLabel('Connection name')).toHaveValue('Changed name');
  });

  test('sidebar delete with unsaved changes asks in the app before deleting', async ({ page }) => {
    await openEditWithTwoConnections(page);
    let deleteRequests = 0;
    let nativeDialogs = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('?/deleteConnection')) deleteRequests++;
    });
    page.on('dialog', (dialog) => {
      nativeDialogs++;
      void dialog.dismiss();
    });

    await page.getByLabel('Connection name').fill('Changed name');
    await deleteFromSidebar(page, 1);

    await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toBeVisible();
    await page.getByRole('button', { name: 'Stay on page' }).click();
    await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toBeHidden();
    await expect(page).toHaveURL(/\/edit$/);
    expect(deleteRequests).toBe(0);

    await deleteFromSidebar(page, 1);
    await page.getByRole('button', { name: 'Leave' }).click();

    await expect(page).toHaveURL('/settings/connections');
    await expect(page.locator('table tbody tr')).toHaveCount(1);
    expect(deleteRequests).toBe(1);
    expect(nativeDialogs).toBe(0);
  });

  test('sidebar delete without changes deletes without asking', async ({ page }) => {
    await openEditWithTwoConnections(page);

    await deleteFromSidebar(page, 1);

    await expect(page).toHaveURL('/settings/connections');
    await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toHaveCount(0);
    await expect(page.locator('table tbody tr')).toHaveCount(1);

    // The sidebar on the next edit page no longer lists the deleted connection.
    await openFirstConnectionEditPage(page);
    await expect(
      page.getByRole('list', { name: 'Saved connections' }).getByRole('listitem')
    ).toHaveCount(1);
  });

  test('a failed sidebar delete shows the error and keeps the unsaved changes', async ({
    page
  }) => {
    await openEditWithTwoConnections(page);
    // An invalid ID makes the action fail.
    await page.route(/\?\/deleteConnection$/, (route) =>
      route.continue({ postData: 'connectionId=not-a-uuid' })
    );

    await page.getByLabel('Connection name').fill('Changed name');
    await deleteFromSidebar(page, 1);
    await page.getByRole('button', { name: 'Leave' }).click();

    await expect(
      page.getByRole('alert').filter({ hasText: 'Connection not found.' })
    ).toBeVisible();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByLabel('Connection name')).toHaveValue('Changed name');

    // The changes are still guarded.
    await page.getByRole('link', { name: '← Manage connections' }).click();
    await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toBeVisible();
  });
});
