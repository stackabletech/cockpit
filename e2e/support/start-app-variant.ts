// Further E2E app instance with the configuration of APP_VARIANT (see
// app-variants.ts). It shares PostgreSQL and Garage with the main instance
// (see start-app.ts), which owns the containers.

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_VARIANTS, type AppVariant } from './app-variants.js';
import { productionBodySizeLimit } from './body-size-limit.js';

const variant = process.env.APP_VARIANT as AppVariant;
if (!(variant in APP_VARIANTS)) throw new Error(`Unknown APP_VARIANT: ${variant}`);

const port = APP_VARIANTS[variant].port;
const baseUrl = `http://localhost:${port}`;
const mainAppUrl = process.env.MAIN_APP_URL ?? 'http://localhost:4173';
const stateFile = path.resolve('.playwright/test-env.json');

process.loadEnvFile(path.join(import.meta.dirname, '../..', '.env.test'));

let app: ChildProcess | undefined;

async function waitFor(check: () => Promise<boolean>, what: string, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function main() {
  // The main instance publishes the container environment and runs the
  // migrations; waiting for it avoids two instances migrating at once.
  await waitFor(async () => (await fs.stat(stateFile)).isFile(), 'the test environment');
  await waitFor(async () => (await fetch(`${mainAppUrl}/healthz`)).ok, 'the main E2E app');

  const testEnv = JSON.parse(await fs.readFile(stateFile, 'utf-8')) as Record<string, string>;

  app = spawn(process.execPath, ['build/index.js'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...testEnv,
      PORT: port,
      ORIGIN: baseUrl,
      STACKABLE_COCKPIT_BASE_URL: baseUrl,
      BETTER_AUTH_URL: baseUrl,
      BODY_SIZE_LIMIT: await productionBodySizeLimit(),
      ...APP_VARIANTS[variant].env
    }
  });
  app.on('error', (err) => {
    console.error(`Failed to start the ${variant} E2E app server:`, err);
    process.exit(1);
  });
  app.on('exit', (code) => process.exit(code ?? 1));
}

function stop() {
  if (app && app.exitCode === null && app.signalCode === null) app.kill('SIGTERM');
  else process.exit(0);
}

process.on('SIGTERM', stop);
process.on('SIGINT', stop);

main().catch((err) => {
  console.error(`Failed to start the ${variant} E2E app:`, err);
  process.exit(1);
});
