import { createRequire } from 'node:module';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

// Fixed so that playwright.config.ts can point the docs project at it.
export const PLAYWRIGHT_BROWSER_SERVER_PORT = 19300;

/**
 * Starts a Playwright browser server in the official Playwright image, so the
 * docs screenshots use the same browser build and fonts on every machine.
 * Client and server must run the same Playwright version.
 */
export async function startPlaywrightBrowserServer(): Promise<StartedTestContainer> {
  const { version } = createRequire(import.meta.url)('@playwright/test/package.json') as {
    version: string;
  };
  const start = Date.now();
  console.log(`Starting Playwright ${version} browser server testcontainer...`);
  const container = await new GenericContainer(`mcr.microsoft.com/playwright:v${version}-noble`)
    .withUser('pwuser')
    .withWorkingDir('/home/pwuser')
    .withCommand([
      'npx',
      '-y',
      `playwright@${version}`,
      'run-server',
      '--port',
      '3000',
      '--host',
      '0.0.0.0'
    ])
    .withExposedPorts({ container: 3000, host: PLAYWRIGHT_BROWSER_SERVER_PORT })
    .withStartupTimeout(300_000)
    .withWaitStrategy(Wait.forLogMessage(/Listening on/))
    .start();
  console.log(`Playwright browser server started in ${Date.now() - start}ms`);
  return container;
}
