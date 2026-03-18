import { test as setup, expect } from '@playwright/test';
import path from 'path';
import { waitForHydration } from './helpers.js';

// Each Playwright project runs its own auth setup, producing a unique
// session. The mock OIDC server issues a different `sub` per token so
// parallel browser projects get isolated server-side state (e.g. the
// in-memory Trino connection store is keyed by userId).

setup('authenticate via mock OIDC', async ({ page }, testInfo) => {
  const authFile = path.join(import.meta.dirname, `.auth/user-${testInfo.project.name}.json`);

  // Navigate to the app — auth guard redirects to /auth/login
  await page.goto('/');
  await expect(page).toHaveURL(/\/auth\/login/);

  // Wait for hydration so the button's onclick handler is attached
  await waitForHydration(page);

  // Click "Sign in with SSO"
  await page.getByRole('button', { name: /sign in with sso/i }).click();

  // Mock OIDC server auto-redirects — no form interaction needed
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // Save authenticated storage state
  await page.context().storageState({ path: authFile });
});
