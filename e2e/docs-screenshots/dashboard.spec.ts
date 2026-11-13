import path from 'path';
import { test, expect } from '../support/fixtures.js';
import { waitForHydration } from '../support/helpers';
import { resetBookmarks } from '../support/bookmarks.js';

const imagesDir = path.join(import.meta.dirname, '../../docs/modules/cockpit/images');

// The global bookmarks from .env.test ("Cluster Logs", "Team Wiki") show up as well.
test('dashboard with bookmarks', async ({ page }) => {
  await resetBookmarks(page, [
    {
      productId: 'trino',
      name: 'Trino',
      url: 'https://trino.example.com',
      environment: 'production',
      pinned: true
    },
    {
      productId: 'superset',
      name: 'Sales dashboards',
      url: 'https://superset.example.com',
      environment: 'production',
      pinned: true
    },
    {
      productId: 'airflow',
      name: 'Airflow',
      url: 'https://airflow.example.com',
      environment: 'production'
    },
    {
      productId: 'nifi',
      name: 'Ingestion',
      url: 'https://nifi.example.com',
      environment: 'staging'
    },
    {
      productId: 'spark',
      name: 'Spark History',
      url: 'https://spark-history.example.com',
      environment: 'production'
    },
    {
      productId: 'druid',
      name: 'Druid',
      url: 'https://druid.example.com',
      environment: 'production'
    }
  ]);
  try {
    await page.goto('/');
    await waitForHydration(page);
    // Product logos load lazily.
    await page.waitForLoadState('networkidle');
    await expect(page.getByLabel('Bookmarks').getByText('Sales dashboards').first()).toBeVisible();
    await page.screenshot({ path: path.join(imagesDir, 'dashboard.png') });
  } finally {
    await resetBookmarks(page);
  }
});
