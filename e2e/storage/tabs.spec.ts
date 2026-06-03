import { test, expect } from '@playwright/test';
import { hasGarageCredentials, requireGarageCredentials } from '../support/garage.js';
import { waitForHydration } from '../support/helpers.js';
import {
  connectToStorage,
  connectAndOpenPrefix,
  bucketRoute,
  seedStorageTabsState
} from './helpers.js';

// ── Tab bar ───────────────────────────────────────────────────────────────────

test.describe('Storage — Explorer tab bar', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('tab bar is hidden when there is only one tab', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectAndOpenPrefix(page, credentials);

    await expect(page.getByRole('tablist', { name: 'Explorer tabs' })).not.toBeVisible();
  });

  test('add tab via + button shows the tab bar with two tabs', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectAndOpenPrefix(page, credentials);

    await page.getByRole('button', { name: 'New Tab' }).click();

    const tablist = page.getByRole('tablist', { name: 'Explorer tabs' });
    await expect(tablist).toBeVisible();
    await expect(tablist.getByRole('tab')).toHaveCount(2);
    // Newly added tab becomes active
    await expect(tablist.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking a tab switches the active tab', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectAndOpenPrefix(page, credentials);

    await page.getByRole('button', { name: 'New Tab' }).click();

    const tablist = page.getByRole('tablist', { name: 'Explorer tabs' });
    const tabs = tablist.getByRole('tab');

    // Second tab is currently active; click the first
    await tabs.nth(0).click();
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'false');
  });

  test('closing a tab removes it and hides the tab bar when only one remains', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectAndOpenPrefix(page, credentials);

    await page.getByRole('button', { name: 'New Tab' }).click();

    const tablist = page.getByRole('tablist', { name: 'Explorer tabs' });
    await expect(tablist.getByRole('tab')).toHaveCount(2);

    // Hover the tab to make the close button visible (it is opacity-0 by default)
    const firstTab = tablist.getByRole('tab').nth(0);
    await firstTab.hover();
    await firstTab.getByRole('button', { name: 'Close tab' }).click();

    await expect(tablist).not.toBeVisible();
  });

  test('close button is absent when only one tab exists', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectAndOpenPrefix(page, credentials);

    await expect(page.getByRole('button', { name: 'Close tab' })).toHaveCount(0);
  });

  test('middle-click on a tab closes it', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectAndOpenPrefix(page, credentials);

    await page.getByRole('button', { name: 'New Tab' }).click();

    const tablist = page.getByRole('tablist', { name: 'Explorer tabs' });
    await expect(tablist.getByRole('tab')).toHaveCount(2);

    await tablist.getByRole('tab').nth(1).click({ button: 'middle' });

    await expect(tablist).not.toBeVisible();
  });

  test('double-click on a tab starts inline rename', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectAndOpenPrefix(page, credentials);

    await page.getByRole('button', { name: 'New Tab' }).click();

    const tablist = page.getByRole('tablist', { name: 'Explorer tabs' });
    await tablist.getByRole('tab').nth(0).dblclick();

    const input = page.getByRole('textbox', { name: 'Rename tab' });
    await expect(input).toBeVisible();

    await input.fill('My renamed tab');
    await input.press('Enter');

    await expect(tablist.getByRole('tab').nth(0)).toContainText('My renamed tab');
  });

  test('Escape cancels rename without changing the label', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectAndOpenPrefix(page, credentials);

    await page.getByRole('button', { name: 'New Tab' }).click();

    const tablist = page.getByRole('tablist', { name: 'Explorer tabs' });
    const firstTab = tablist.getByRole('tab').nth(0);

    // The initial label is the bucket name (prefix is empty)
    const originalLabel = credentials.bucket;

    await firstTab.dblclick();
    await page.getByRole('textbox', { name: 'Rename tab' }).fill('discarded name');
    await page.keyboard.press('Escape');

    // Input disappears and the original label is preserved
    await expect(page.getByRole('textbox', { name: 'Rename tab' })).not.toBeVisible();
    await expect(firstTab).toHaveAttribute('title', originalLabel);
  });

  test('right-click opens a context menu with Rename and Close options', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectAndOpenPrefix(page, credentials);

    await page.getByRole('button', { name: 'New Tab' }).click();

    const tablist = page.getByRole('tablist', { name: 'Explorer tabs' });
    await tablist.getByRole('tab').nth(0).click({ button: 'right' });

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Rename tab' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Close tab' })).toBeVisible();
  });

  test('rename via right-click context menu', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectAndOpenPrefix(page, credentials);

    await page.getByRole('button', { name: 'New Tab' }).click();

    const tablist = page.getByRole('tablist', { name: 'Explorer tabs' });
    await tablist.getByRole('tab').nth(0).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename tab' }).click();

    const input = page.getByRole('textbox', { name: 'Rename tab' });
    await expect(input).toBeVisible();
    await input.fill('Context menu rename');
    await input.press('Enter');

    await expect(tablist.getByRole('tab').nth(0)).toContainText('Context menu rename');
  });

  test('close tab via right-click context menu', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectAndOpenPrefix(page, credentials);

    await page.getByRole('button', { name: 'New Tab' }).click();

    const tablist = page.getByRole('tablist', { name: 'Explorer tabs' });
    await expect(tablist.getByRole('tab')).toHaveCount(2);

    await tablist.getByRole('tab').nth(0).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Close tab' }).click();

    // Closing down to one tab hides the tablist (hasTabs is false when only one tab remains)
    await expect(tablist).not.toBeVisible();
  });

  test('New Tab via breadcrumb More Options adds a tab and closes the dropdown', async ({
    page
  }) => {
    const credentials = requireGarageCredentials();
    await connectAndOpenPrefix(page, credentials);

    await page.getByRole('button', { name: 'More options' }).click();

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'New Tab' }).click();

    // Dropdown must close after the click
    await expect(menu).not.toBeVisible();

    // Tab bar must appear with 2 tabs
    const tablist = page.getByRole('tablist', { name: 'Explorer tabs' });
    await expect(tablist).toBeVisible();
    await expect(tablist.getByRole('tab')).toHaveCount(2);
  });
});

// ── Restore banner ────────────────────────────────────────────────────────────

test.describe('Storage — Restore tabs banner', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('banner appears when there are 2 or more saved tabs', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await seedStorageTabsState(page, {
      tabs: [
        { id: 'tab-a', label: credentials.bucket, bucket: credentials.bucket, prefix: '' },
        { id: 'tab-b', label: 'subfolder', bucket: credentials.bucket, prefix: 'subfolder/' }
      ],
      activeTabId: 'tab-a'
    });

    await connectToStorage(page, credentials);
    await expect(page).toHaveURL('/storage');

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore tabs' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dismiss' })).toBeVisible();
  });

  test('banner message includes the saved tab count', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await seedStorageTabsState(page, {
      tabs: [
        { id: 'tab-a', label: credentials.bucket, bucket: credentials.bucket, prefix: '' },
        { id: 'tab-b', label: 'folder-1', bucket: credentials.bucket, prefix: 'folder-1/' },
        { id: 'tab-c', label: 'folder-2', bucket: credentials.bucket, prefix: 'folder-2/' }
      ],
      activeTabId: 'tab-a'
    });

    await connectToStorage(page, credentials);
    await expect(page).toHaveURL('/storage');

    await expect(page.getByRole('alert')).toContainText('3');
  });

  test('banner does not appear when there is only one saved tab', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await seedStorageTabsState(page, {
      tabs: [{ id: 'tab-a', label: credentials.bucket, bucket: credentials.bucket, prefix: '' }],
      activeTabId: 'tab-a'
    });

    await connectToStorage(page, credentials);
    await expect(page).toHaveURL('/storage');

    await expect(page.getByRole('button', { name: 'Restore tabs' })).not.toBeVisible();
  });

  test('Dismiss hides the banner', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await seedStorageTabsState(page, {
      tabs: [
        { id: 'tab-a', label: credentials.bucket, bucket: credentials.bucket, prefix: '' },
        { id: 'tab-b', label: 'subfolder', bucket: credentials.bucket, prefix: 'subfolder/' }
      ],
      activeTabId: 'tab-a'
    });

    await connectToStorage(page, credentials);
    await expect(page).toHaveURL('/storage');

    await page.getByRole('button', { name: 'Dismiss' }).click();

    await expect(page.getByRole('button', { name: 'Restore tabs' })).not.toBeVisible();
  });

  test('Dismiss does not clear saved tabs — banner reappears on re-visit', async ({ page }) => {
    test.slow(); // navigates to / (Trino editor) which is slow in Firefox
    const credentials = requireGarageCredentials();

    // Step 1: navigate to bucket and add a second tab via natural interaction
    await connectAndOpenPrefix(page, credentials);
    await page.getByRole('button', { name: 'New Tab' }).click();
    await expect(page.getByRole('tablist', { name: 'Explorer tabs' }).getByRole('tab')).toHaveCount(
      2
    );

    // Step 2: navigate back to /storage — banner should appear
    await page.goto('/storage');
    await waitForHydration(page);
    await expect(page.getByRole('button', { name: 'Restore tabs' })).toBeVisible();

    // Step 3: dismiss
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByRole('button', { name: 'Restore tabs' })).not.toBeVisible();

    // Step 4: navigate to dashboard and back — banner must reappear because
    // localStorage was not cleared by Dismiss
    await page.goto('/');
    await waitForHydration(page);
    await page.goto('/storage');
    await waitForHydration(page);

    await expect(page.getByRole('button', { name: 'Restore tabs' })).toBeVisible();
  });

  test('Restore tabs navigates to the active-tab bucket and loads all tabs', async ({ page }) => {
    const credentials = requireGarageCredentials();

    // Step 1: navigate to bucket and add a second tab via natural interaction
    await connectAndOpenPrefix(page, credentials);
    await page.getByRole('button', { name: 'New Tab' }).click();
    await expect(page.getByRole('tablist', { name: 'Explorer tabs' }).getByRole('tab')).toHaveCount(
      2
    );

    // Step 2: navigate back to /storage — banner appears
    await page.goto('/storage');
    await waitForHydration(page);
    await expect(page.getByRole('button', { name: 'Restore tabs' })).toBeVisible();

    // Step 3: click Restore tabs
    await page.getByRole('button', { name: 'Restore tabs' }).click();

    // Should navigate to the bucket route
    await expect(page).toHaveURL(bucketRoute(credentials.bucket));

    // Step 4: tab bar must render with 2 restored tabs
    const tablist = page.getByRole('tablist', { name: 'Explorer tabs' });
    await expect(tablist).toBeVisible();
    await expect(tablist.getByRole('tab')).toHaveCount(2);
  });
});
