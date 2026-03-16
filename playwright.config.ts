import { defineConfig } from '@playwright/test';
import path from 'path';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: path.join(import.meta.dirname, 'e2e'),
  outputDir: path.join(import.meta.dirname, 'e2e/test-results'),
  globalSetup: path.join(import.meta.dirname, 'e2e/global-setup.ts'),
  globalTeardown: path.join(import.meta.dirname, 'e2e/global-teardown.ts'),
  timeout: 30_000,
  retries: 2,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'npx tsx e2e/start-mock-oidc.ts',
      url: 'http://localhost:9090/.well-known/openid-configuration',
      reuseExistingServer: false
    },
    {
      command: `npm run dev -- --mode test --port 4173`,
      url: baseURL,
      reuseExistingServer: false
    }
  ],
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 }
      }
    },
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        viewport: { width: 1280, height: 720 },
        storageState: 'e2e/.auth/user.json'
      },
      dependencies: ['setup']
    },
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 },
        storageState: 'e2e/.auth/user.json',
        ...(chromiumExecutablePath && { launchOptions: { executablePath: chromiumExecutablePath } })
      },
      dependencies: ['setup']
    },
    {
      name: 'mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 393, height: 851 },
        isMobile: true,
        hasTouch: true,
        storageState: 'e2e/.auth/user.json',
        ...(chromiumExecutablePath && { launchOptions: { executablePath: chromiumExecutablePath } })
      },
      dependencies: ['setup']
    }
  ]
});
