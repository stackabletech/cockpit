import { test as setup, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authFile = path.join(__dirname, '.auth/user.json');

setup('authenticate via mock OIDC', async ({ page }) => {
  // Navigate to the app — auth guard redirects to /auth/login
  await page.goto('/');
  await expect(page).toHaveURL(/\/auth\/login/);

  // Click "Sign in with SSO"
  await page.getByRole('button', { name: /sign in with sso/i }).click();

  // mock-oauth2-server presents a simple username form (input[name="username"], no label text)
  await page.locator('input[name="username"]').fill('testuser');
  await page.locator('input[type="submit"]').click();

  // Should land back on the app dashboard
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // Save authenticated storage state
  await page.context().storageState({ path: authFile });
});
