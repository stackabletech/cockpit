import { defineConfig } from '@playwright/test';
import path from 'path';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  workers: process.env.CI ? 1 : undefined,
  testDir: path.join(import.meta.dirname, 'e2e'),
  outputDir: path.join(import.meta.dirname, 'e2e/test-results'),
  globalSetup: path.join(import.meta.dirname, 'e2e/support/global-setup.ts'),
  timeout: 60_000,
  globalTimeout: 20 * 60_000,
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
      reuseExistingServer: !process.env.CI
    },
    {
      command: 'npx tsx e2e/support/start-mock-trino.ts',
      url: 'http://localhost:8080',
      reuseExistingServer: !process.env.CI
    },
    {
      command: 'node --env-file=.env.test node_modules/.bin/vite preview --host --port 4173',
      url: baseURL,
      reuseExistingServer: !process.env.CI
    }
  ],
  projects: [
    // Runs database migrations against the PostgreSQL container started by globalSetup.
    // All browser projects depend on this so tests never run on an unmigrated DB.
    // Container teardown is handled by the function returned from globalSetup.
    {
      name: 'setup-db',
      testMatch: /db-migrations\.setup\.ts/
    },
    // Each browser project gets its own auth setup so that parallel workers
    // log in as different users. This prevents cross-worker races on shared
    // server-side state (e.g. the in-memory Trino connection store).
    {
      name: 'setup-chromium',
      testMatch: /auth\.setup\.ts/,
      dependencies: ['setup-db'],
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 }
      }
    },
    {
      name: 'setup-firefox',
      testMatch: /auth\.setup\.ts/,
      dependencies: ['setup-db'],
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
