import { defineConfig } from '@playwright/test';
import path from 'path';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';
const appPort = new URL(baseURL).port || '80';
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  // Tests share mock-service state, so parallel workers can race even outside CI.
  workers: 1,
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
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: [
    {
      command: 'npx tsx e2e/support/start-mock-oidc.ts',
      url: 'http://localhost:9090/.well-known/openid-configuration',
      reuseExistingServer: false
    },
    {
      command: 'npx tsx e2e/support/start-mock-trino.ts',
      url: 'http://localhost:8080',
      reuseExistingServer: false
    },
    {
      command: 'npx tsx e2e/support/start-app.ts',
      env: { PORT: appPort },
      url: baseURL,
      timeout: 300_000,
      stdout: 'pipe',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 30_000 },
      reuseExistingServer: false
    }
  ],
  projects: [
    // Each browser project gets its own auth setup so that parallel workers
    // log in as different users. This prevents cross-worker races on shared
    // server-side state (e.g. the in-memory Trino connection store).
    {
      name: 'setup-chromium',
      testMatch: /auth\.setup\.ts/,
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 }
      }
    },
    {
      name: 'setup-firefox',
      testMatch: /auth\.setup\.ts/,
      use: {
        browserName: 'firefox',
        viewport: { width: 1280, height: 720 }
      }
    },
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        viewport: { width: 1280, height: 720 },
        storageState: 'e2e/.auth/user-setup-firefox.json'
      },
      dependencies: ['setup-firefox']
    },
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 },
        storageState: 'e2e/.auth/user-setup-chromium.json',
        ...(chromiumExecutablePath && { launchOptions: { executablePath: chromiumExecutablePath } })
      },
      dependencies: ['setup-chromium']
    }
  ]
});
