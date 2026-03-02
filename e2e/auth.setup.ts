import { test as setup, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForHydration } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authFile = path.join(__dirname, '.auth/user.json');

setup('authenticate via mock OIDC', async ({ page }) => {
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
