import { test, expect } from '../support/fixtures.js';
import { hasGarageCredentials, requireGarageCredentials } from '../support/garage.js';
import { connectToStorage } from './helpers.js';

test.describe('Storage S3 — Sidebar resizing', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('bucket list width is restored before hydration', async ({ page }) => {
    await connectToStorage(page, requireGarageCredentials());
    const buckets = page.getByRole('navigation', { name: 'Buckets' });
    const width = async () => (await buckets.boundingBox())?.width;
    await expect.poll(width).toBe(192);

    await buckets.getByRole('separator', { name: 'Resize sidebar' }).focus();
    await page.keyboard.press('Shift+ArrowRight'); // +20px
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(width).toBe(232);

    // Without the app's JavaScript only the inline script in app.html can restore the width.
    await page.route('**/_app/immutable/**/*.js', (route) => route.abort());
    await page.reload();
    expect(await width()).toBe(232);
  });
});
