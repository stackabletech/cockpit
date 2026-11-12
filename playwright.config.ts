import { defineConfig } from '@playwright/test';
import path from 'path';
import { PLAYWRIGHT_BROWSER_SERVER_PORT } from './e2e/support/containers/playwright-browser.setup.js';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';
const appPort = new URL(baseURL).port || '80';
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
// The specs that write the screenshots of the Antora docs run only in the docs
// project, which `npm run docs:screenshots` enables, not in the normal E2E run.
const docsScreenshotSpecs = '**/e2e/docs-screenshots/*.spec.ts';
const docsProject = {
  name: 'docs',
  testMatch: docsScreenshotSpecs,
  retries: 0,
  use: {
    browserName: 'chromium' as const,
    viewport: { width: 1280, height: 800 },
    colorScheme: 'light' as const,
    locale: 'en-US',
    // The browser runs in the official Playwright image (started by
    // e2e/support/start-app.ts), so the screenshots don't depend on the
    // browser build and fonts of the machine. It reaches the app on the
    // host's loopback interface through the Playwright connection.
    connectOptions: {
      wsEndpoint: `ws://127.0.0.1:${PLAYWRIGHT_BROWSER_SERVER_PORT}/`,
      exposeNetwork: '<loopback>'
    }
  }
};

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
    }
  ],
  projects: [
    {
      name: 'firefox',
      testIgnore: docsScreenshotSpecs,
      use: {
        browserName: 'firefox',
        viewport: { width: 1280, height: 720 }
      }
    },
    {
      name: 'chromium',
      testIgnore: docsScreenshotSpecs,
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 },
        ...(chromiumExecutablePath && { launchOptions: { executablePath: chromiumExecutablePath } })
      }
    },
    ...(process.env.DOCS_SCREENSHOTS ? [docsProject] : [])
  ]
});
