import { test, expect } from '@playwright/test';
import {
  createS3Client,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import {
  bucketRoute,
  connectAndOpenPrefix,
  connectToStorage,
  deleteKnownKeys,
  putDirectoryMarker,
  putTextObject,
  uniquePrefix
} from './helpers.js';

test.describe('Storage Search', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('searches the current bucket, runs parallel sessions, and opens matching results', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'search');
    const directory = `${prefix}reports/`;
    const file = `${directory}final-report.txt`;

    try {
      await putDirectoryMarker(client, credentials.bucket, directory);
      await putTextObject(client, credentials.bucket, file, 'search preview');
      await connectAndOpenPrefix(page, credentials, prefix);

      await page.getByRole('button', { name: 'Open search' }).click();
      await page.getByLabel('Search query').fill('report');
      await page.getByRole('button', { name: 'Search', exact: true }).click();

      await expect(page.getByText(/2 results/)).toBeVisible();
      await page.getByRole('button', { name: /reports.*\/reports\// }).click();
      await expect(page).toHaveURL(bucketRoute(credentials.bucket, directory));

      await page.getByRole('button', { name: 'Open search' }).click();
      await page.getByRole('button', { name: 'Parallel search' }).click();
      await expect(page.getByRole('navigation', { name: 'Search sessions' })).toBeVisible();
      await page.getByLabel('Search query').fill('final-report');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page
        .getByRole('button', { name: /final-report\.txt.*\/reports\/final-report\.txt/ })
        .click();
      const previewDialog = page.getByRole('dialog').filter({ hasText: 'final-report.txt' });
      await expect(previewDialog).toContainText('final-report.txt');
      await previewDialog.getByLabel('Close', { exact: true }).click();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, [directory, file]);
    }
  });

  test('searches all buckets from the landing page', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'landing-search');
    const file = `${prefix}landing-report.txt`;

    try {
      await putTextObject(client, credentials.bucket, file, 'landing search');
      await connectToStorage(page, credentials);

      await page.getByRole('button', { name: 'Open search' }).click();
      await page.getByLabel('Search query').fill('landing-report');
      await page.getByRole('button', { name: 'Search', exact: true }).click();

      await expect(page.getByRole('button', { name: 'landing-report.txt' })).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, [file]);
    }
  });

  test('filters and selects buckets via the bucket dropdown', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'bucket-scope');
    const file = `${prefix}scoped-report.txt`;

    try {
      await putTextObject(client, credentials.bucket, file, 'scoped search');
      await connectToStorage(page, credentials);

      await page.getByRole('button', { name: 'Open search' }).click();

      const trigger = page.getByRole('button', { name: 'all buckets', exact: true });
      await expect(trigger).toBeVisible();
      await trigger.click();

      await page.getByLabel('Filter buckets').fill(credentials.bucket);
      await page
        .getByRole('button', { name: `Include ${credentials.bucket} in search`, exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: credentials.bucket, exact: true })
      ).toBeVisible();

      await page.getByLabel('Search query').fill('scoped-report');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByRole('button', { name: 'scoped-report.txt' })).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, [file]);
    }
  });

  test('uses the regex toggle and server-side exclusion filters', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'regex-search');
    const matching = `${prefix}report-2026.txt`;
    const excluded = `${prefix}report-archive.txt`;

    try {
      await putTextObject(client, credentials.bucket, matching, 'matching result');
      await putTextObject(client, credentials.bucket, excluded, 'excluded result');
      await connectAndOpenPrefix(page, credentials, prefix);
      await page.getByRole('button', { name: 'Open search' }).click();
      const regexToggle = page.getByRole('button', { name: '.*', exact: true });
      await regexToggle.click();
      await expect(regexToggle).toHaveAttribute('aria-pressed', 'true');
      await page.getByText('Advanced options').click();
      await page.getByLabel('Exclude patterns').fill('archive');
      await page.getByLabel('Exclude patterns').press('Enter');
      await page.getByLabel('Search query').fill('report-[0-9]+');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      const searchDialog = page.getByRole('dialog');
      await expect(searchDialog.getByRole('button', { name: /^report-2026\.txt/ })).toBeVisible();
      await expect(searchDialog.getByRole('button', { name: /^report-archive\.txt/ })).toHaveCount(
        0
      );
    } finally {
      await deleteKnownKeys(client, credentials.bucket, [matching, excluded]);
    }
  });

  test('blocks unsafe regexes client-side and re-enables on a valid pattern', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'regex-validation');
    const file = `${prefix}report.txt`;

    try {
      await putTextObject(client, credentials.bucket, file, 'regex validation');
      await connectToStorage(page, credentials);

      await page.getByRole('button', { name: 'Open search' }).click();
      await page.getByRole('button', { name: '.*', exact: true }).click();
      await page.getByLabel('Search query').fill('(a+)+');
      await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeDisabled();
      await expect(page.getByText(/unsupported constructs/)).toBeVisible();

      await page.getByLabel('Search query').fill('report');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByRole('button', { name: /report\.txt/ })).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, [file]);
    }
  });

  test('adds and removes date/size filter rows, jumping the date picker to a typed date', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'filter-search');
    const big = `${prefix}report-big.txt`;
    const small = `${prefix}report-small.txt`;
    const folder = `${prefix}archive/`;

    try {
      await putTextObject(client, credentials.bucket, big, 'x'.repeat(12 * 1024 * 1024));
      await putTextObject(client, credentials.bucket, small, 'x');
      await putDirectoryMarker(client, credentials.bucket, folder);
      await connectAndOpenPrefix(page, credentials, prefix);
      await page.getByRole('button', { name: 'Open search' }).click();
      await page.getByText('Advanced options').click();

      // Each new session starts with a Date and a Size filter row.
      await expect(page.getByLabel('Size value')).toBeVisible();
      await expect(page.getByLabel('Date value')).toBeVisible();

      // Size filter: "size > 10" (MB) keeps only the big report.
      await page.getByLabel('Size value').fill('10');
      await page.getByLabel('Search query').fill('report');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByRole('button', { name: /^report-big\.txt/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /^report-small\.txt/ })).toHaveCount(0);

      // Add a new filter row and change its field, then remove it again.
      await page.getByRole('button', { name: 'Add filter' }).click();
      await expect(page.getByLabel('Filter field')).toHaveCount(3);
      await page.getByLabel('Filter field').last().selectOption('size');
      await page.getByRole('button', { name: 'Remove filter' }).last().click();
      await expect(page.getByLabel('Filter field')).toHaveCount(2);

      // A valid typed date makes the picker open on that month.
      const dateInput = page.getByLabel('Date value');
      await dateInput.fill('15.03.2027');
      await page.getByRole('button', { name: 'Pick a date' }).click();
      const picker = page.getByRole('dialog', { name: 'Date picker' });
      await expect(picker).toBeVisible();
      await expect(picker).toContainText('March 2027');
      await page.keyboard.press('Escape');

      // Invalid size values disable the search button.
      await page.getByLabel('Size value').fill('not-a-size');
      await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeDisabled();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, [big, small, folder]);
    }
  });

  test('parses a comma decimal separator in a size filter', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'comma-filter');
    const file = `${prefix}report-comma.txt`;

    try {
      await putTextObject(client, credentials.bucket, file, 'x'.repeat(2 * 1024 * 1024));
      await connectAndOpenPrefix(page, credentials, prefix);
      await page.getByRole('button', { name: 'Open search' }).click();
      await page.getByText('Advanced options').click();
      await page.getByLabel('Size value').fill('1,5'); // = 1.5 MB; 2 MB > 1.5 MB
      await page.getByLabel('Search query').fill('report');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByRole('button', { name: /^report-comma\.txt/ })).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, [file]);
    }
  });
});
