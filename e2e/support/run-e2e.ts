/**
 * Wrapper script that starts testcontainers BEFORE launching Playwright.
 *
 * Playwright's startup order is:
 *   1. webServer plugin processes are spawned
 *   2. globalSetup runs
 *   3. Tests run
 *
 * This means env vars set in globalSetup are not inherited by the webServer
 * subprocess.  By starting the containers here — before `playwright test` is
 * spawned — the child process inherits DATABASE_* and S3_* env vars and the
 * SvelteKit app server can connect to the database on first query.
 */

import { spawn } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { startPostgres } from './containers/postgres.setup.js';
import { startGarage } from './containers/garage.setup.js';

process.loadEnvFile(path.join(import.meta.dirname, '../..', '.env.test'));

const stateFile = path.resolve('.playwright/postgres-state.json');

async function main() {
  console.log('Starting test containers...');
  const [pgContainer, garageContainer] = await Promise.all([startPostgres(), startGarage()]);

  await fsPromises.mkdir(path.dirname(stateFile), { recursive: true });
  await fsPromises.writeFile(
    stateFile,
    JSON.stringify({ connectionUri: pgContainer.getConnectionUri() }),
    'utf-8'
  );

  // Signal to globalSetup that containers are already running so it skips
  // the fallback startup path.
  process.env.TESTCONTAINERS_STARTED = 'true';

  let exitCode = 0;
  try {
    exitCode = await runPlaywright(process.argv.slice(2));
  } finally {
    console.log('Tearing down testcontainers...');
    await Promise.allSettled([garageContainer.stop(), pgContainer.stop()]);
    await fsPromises.rm(stateFile, { force: true });
    console.log('Testcontainers stopped.');
  }

  process.exit(exitCode);
}

function runPlaywright(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const pw = spawn('npx', ['playwright', 'test', ...args], {
      stdio: 'inherit',
      env: process.env
    });
    pw.on('error', reject);
    pw.on('close', (code) => resolve(code ?? 0));
  });
}

main().catch((err) => {
  console.error('Failed to run E2E tests:', err);
  process.exit(1);
});
