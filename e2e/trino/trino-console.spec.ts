import { test, expect } from '@playwright/test';
import { waitForHydration } from '../support/helpers';

// Layer 2 spike (iframe-spike §5.1): the embedded Trino Web UI page. We assert the page shell
// and that it frames the configured Trino UI URL — not that the (mock) UI actually loads.
test.describe('Trino Console (embedded UI)', () => {
  test.use({ locale: 'en-US' });

  test('nav item is present and links to the console', async ({ page }) => {
    await page.goto('/');
    const link = page.getByRole('link', { name: 'Trino Console' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/trino-console');
  });

  test('console page embeds the Trino UI in an iframe', async ({ page }) => {
    await page.goto('/trino-console');
    await waitForHydration(page);

    await expect(page.getByRole('heading', { name: 'Trino Console' })).toBeVisible();

    const frame = page.locator('iframe[title="Trino Web UI"]');
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute('src', /\/ui\/?$/);
  });
});
