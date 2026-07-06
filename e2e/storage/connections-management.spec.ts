import { test, expect } from '@playwright/test';
import { hasGarageCredentials, requireGarageCredentials } from '../support/garage.js';
import { connectToStorage, openConnectForm } from './helpers.js';
import { waitForHydration } from '../support/helpers.js';

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

  test('navigates to /storage/connections from the manage link', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await openConnectForm(page);

    await page.getByRole('link', { name: 'Manage connections' }).click();

    await waitForHydration(page);
    await expect(page).toHaveURL('/storage/connections');
    await expect(page.getByRole('heading', { name: 'Manage connections' })).toBeVisible();
  });

  test('lists saved connections on the management page', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/storage/connections');
    await waitForHydration(page);

    // At least one connection should be listed (the one we just connected with)
    await expect(page.getByRole('list').getByRole('listitem').first()).toBeVisible();
  });

  test('Edit link on management page navigates to edit page', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/storage/connections');
    await waitForHydration(page);

    await page.getByRole('link', { name: /edit/i }).first().click();
    await waitForHydration(page);

    await expect(page.getByRole('heading', { name: 'Edit connection' })).toBeVisible();
  });

  test('edit page pre-fills with current connection values', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/storage/connections');
    await waitForHydration(page);

    await page.getByRole('link', { name: /edit/i }).first().click();
    await waitForHydration(page);

    await expect(page.getByLabel('Host')).toHaveValue(new URL(credentials.endpoint).hostname);
    await expect(page.getByLabel('Region')).toHaveValue(credentials.region);
    await expect(page.getByLabel('Access key')).toHaveValue(credentials.accessKeyId);
  });

  test('edit page redirects to connections list after saving valid credentials', async ({
    page
  }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/storage/connections');
    await waitForHydration(page);

    await page.getByRole('link', { name: /edit/i }).first().click();
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Save changes' }).click();

    await waitForHydration(page);
    await expect(page).toHaveURL('/storage/connections');
    await expect(page.getByRole('heading', { name: 'Manage connections' })).toBeVisible();
  });

  test('edit page shows error for invalid credentials', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/storage/connections');
    await waitForHydration(page);

    await page.getByRole('link', { name: /edit/i }).first().click();
    await waitForHydration(page);

    await page.getByLabel('Secret key').fill('wrong-secret');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(
      page.getByText('Could not connect — check the endpoint and credentials.')
    ).toBeVisible();
  });

  test('delete button on management page removes the connection after confirmation', async ({
    page
  }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/storage/connections');
    await waitForHydration(page);

    const initialItems = await page.getByRole('list').getByRole('listitem').count();

    await page
      .getByRole('button', { name: /delete/i })
      .first()
      .click();

    // Confirm deletion in the modal
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();

    const finalItems = await page.getByRole('list').getByRole('listitem').count();
    expect(finalItems).toBe(initialItems - 1);
  });

  test('redirects to /storage/connections when editing a non-existent id', async ({ page }) => {
    await page.goto('/storage/connections/00000000-0000-0000-0000-000000000000/edit');
    await waitForHydration(page);

    await expect(page).toHaveURL('/storage/connections');
  });

  test('edit page shows active connection notice when editing current connection', async ({
    page
  }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/storage/connections');
    await waitForHydration(page);

    await page.getByRole('link', { name: /edit/i }).first().click();
    await waitForHydration(page);

    await expect(page.getByText('You are currently connected with this connection.')).toBeVisible();
  });

  test('edit page shows unsaved-changes modal when navigating away with dirty form', async ({
    page
  }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/storage/connections');
    await waitForHydration(page);

    await page.getByRole('link', { name: /edit/i }).first().click();
    await waitForHydration(page);

    // Make a change to mark the form dirty
    await page.getByLabel('Connection name').fill('Changed name');

    // Try to navigate away via the back link
    await page.getByRole('link', { name: /Manage connections/i }).click();

    // Modal should appear
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toBeVisible();
  });

  test('unsaved-changes modal: Stay keeps user on edit page', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/storage/connections');
    await waitForHydration(page);

    await page.getByRole('link', { name: /edit/i }).first().click();
    await waitForHydration(page);

    await page.getByLabel('Connection name').fill('Changed name');
    await page.getByRole('link', { name: /Manage connections/i }).click();

    await page.getByRole('dialog').getByRole('button', { name: 'Stay on page' }).click();

    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByRole('heading', { name: 'Edit connection' })).toBeVisible();
  });

  test('unsaved-changes modal: Leave navigates away', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await page.goto('/storage/connections');
    await waitForHydration(page);

    await page.getByRole('link', { name: /edit/i }).first().click();
    await waitForHydration(page);

    await page.getByLabel('Connection name').fill('Changed name');
    await page.getByRole('link', { name: /Manage connections/i }).click();

    await page.getByRole('dialog').getByRole('button', { name: 'Leave' }).click();

    await waitForHydration(page);
    await expect(page).toHaveURL('/storage/connections');
  });
});
