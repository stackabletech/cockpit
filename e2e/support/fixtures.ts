import { test as base, expect } from '@playwright/test';
import path from 'path';
import { waitForHydration } from './helpers.js';

export * from '@playwright/test';

// Each worker logs in once and reuses that session for all of its tests. The
// mock OIDC server issues a different `sub` per login, so parallel workers act
// as different users and cannot race on per-user server-side state (saved and
// active storage connections, the Trino connection store, recent items).
// Playwright recommends this pattern for tests that modify server-side state:
// https://playwright.dev/docs/auth#moderate-one-account-per-parallel-worker
export const test = base.extend<object, { workerStorageState: string }>({
  storageState: ({ workerStorageState }, use) => use(workerStorageState),

  workerStorageState: [
    async ({ browser }, use, workerInfo) => {
      const authFile = path.join(
        import.meta.dirname,
        `../.auth/user-${workerInfo.project.name}-${workerInfo.parallelIndex}.json`
      );

      // Always log in afresh: sessions live in the per-run database, so a file
      // from an earlier run would point at a session that no longer exists.
      const context = await browser.newContext({
        baseURL: workerInfo.project.use.baseURL,
        storageState: { cookies: [], origins: [] }
      });
      const page = await context.newPage();

      // Navigate to the app — auth guard redirects to /auth/login
      await page.goto('/');
      await expect(page).toHaveURL(/\/auth\/login/);

      // Wait for hydration so the button's onclick handler is attached
      await waitForHydration(page);

      // Mock OIDC server auto-redirects — no form interaction needed
      await page.getByRole('button', { name: /sign in with sso/i }).click();
      await expect(page).toHaveURL('/');
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

      await context.storageState({ path: authFile });
      await context.close();

      await use(authFile);
    },
    { scope: 'worker' }
  ]
});
