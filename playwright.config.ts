import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';

export default defineConfig({
  testDir: path.join(__dirname, 'e2e'),
  outputDir: path.join(__dirname, 'e2e/test-results'),
  globalSetup: path.join(__dirname, 'e2e/global-setup.ts'),
  globalTeardown: path.join(__dirname, 'e2e/global-teardown.ts'),
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure'
  },
  webServer: {
    command: `npm run dev -- --mode test --port 4173`,
    url: baseURL,
    reuseExistingServer: false
  },
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
        storageState: 'e2e/.auth/user.json'
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
        storageState: 'e2e/.auth/user.json'
      },
      dependencies: ['setup']
    }
  ]
});
