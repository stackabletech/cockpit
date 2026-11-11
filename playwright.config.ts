import { defineConfig } from '@playwright/test';
import path from 'path';
import { APP_VARIANTS } from './e2e/support/app-variants.js';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';
const appPort = new URL(baseURL).port || '80';
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const browsers = {
  firefox: { browserName: 'firefox' },
  chromium: {
    browserName: 'chromium',
    ...(chromiumExecutablePath && { launchOptions: { executablePath: chromiumExecutablePath } })
  }
} as const;
// Specs of the further app instances (see e2e/support/app-variants.ts).
const variants = Object.entries(APP_VARIANTS).map(([name, { port, specs }]) => ({
  name,
  baseURL: `http://localhost:${port}`,
  specs
}));
const variantSpecs = variants.map((variant) => variant.specs);

export default defineConfig({
  // Each worker logs in as its own user (see e2e/support/fixtures.ts), so
  // tests can run in parallel without racing on per-user server-side state.
  fullyParallel: true,
  // CI runners have few cores; keep their load low.
  workers: process.env.CI ? 2 : 4,
  testDir: path.join(import.meta.dirname, 'e2e'),
  outputDir: path.join(import.meta.dirname, 'e2e/test-results'),
  globalSetup: path.join(import.meta.dirname, 'e2e/support/global-setup.ts'),
  timeout: 20_000,
  globalTimeout: 40 * 60_000,
  retries: 2,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL,
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: [
    {
      command: 'npx tsx e2e/support/start-mock-oidc.ts',
      url: 'http://localhost:19090/.well-known/openid-configuration',
      reuseExistingServer: false
    },
    {
      command: 'npx tsx e2e/support/start-mock-trino.ts',
      url: 'http://localhost:18080',
      reuseExistingServer: false
    },
    {
      command: 'npx tsx e2e/support/start-app.ts',
      env: { PORT: appPort },
      url: baseURL,
      timeout: 300_000,
      // App logs drown out the test output; set E2E_SERVER_LOGS=1 to see them.
      stdout: process.env.E2E_SERVER_LOGS ? 'pipe' : 'ignore',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 30_000 },
      reuseExistingServer: false
    },
    ...variants.map((variant) => ({
      command: 'npx tsx e2e/support/start-app-variant.ts',
      env: { APP_VARIANT: variant.name, MAIN_APP_URL: baseURL },
      url: variant.baseURL,
      timeout: 300_000,
      stdout: process.env.E2E_SERVER_LOGS ? ('pipe' as const) : ('ignore' as const),
      gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 30_000 },
      reuseExistingServer: false
    }))
  ],
  projects: [
    ...Object.entries(browsers).map(([name, browser]) => ({
      name,
      testIgnore: variantSpecs,
      use: { ...browser, viewport: { width: 1280, height: 720 } }
    })),
    ...variants.flatMap((variant) =>
      Object.entries(browsers).map(([name, browser]) => ({
        name: `${name}-${variant.name}`,
        testMatch: variant.specs,
        use: { ...browser, baseURL: variant.baseURL, viewport: { width: 1280, height: 720 } }
      }))
    )
  ]
});
