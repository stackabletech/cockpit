import fsPromises from 'node:fs/promises';
import path from 'path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedTestContainer } from 'testcontainers';
import { startPostgres } from './containers/postgres.setup.js';
import { startGarage } from './containers/garage.setup.js';

const stateFile = path.resolve('.playwright/postgres-state.json');

let pgContainer: StartedPostgreSqlContainer;
let garageContainer: StartedTestContainer;

export default async function globalSetup() {
  process.loadEnvFile(path.join(import.meta.dirname, '../..', '.env.test'));

  // When invoked via `npm run test:e2e`, the run-e2e.ts wrapper starts
  // containers before spawning Playwright so that the webServer subprocess
  // inherits DATABASE_* and S3_* env vars.  Nothing to do here in that case.
  if (process.env.TESTCONTAINERS_STARTED === 'true') {
    return;
  }

  // Fallback for direct `playwright test` invocations (e.g. from the IDE).
  // Note: in this path the webServer process is already running before
  // containers are ready, so connection errors are possible unless
  // reuseExistingServer is true and an existing server is already up.
  pgContainer = await startPostgres();
  garageContainer = await startGarage();

  await fsPromises.mkdir(path.dirname(stateFile), { recursive: true });
  await fsPromises.writeFile(
    stateFile,
    JSON.stringify({
      connectionUri: pgContainer.getConnectionUri()
    }),
    'utf-8'
  );

  // Return a teardown function — runs in the main process after all tests,
  // so we can call .stop() directly instead of shelling out to Docker CLI.
  return async () => {
    console.log('Tearing down testcontainers...');
    await Promise.allSettled([garageContainer.stop(), pgContainer.stop()]);
    await fsPromises.rm(stateFile, { force: true });
    console.log('Testcontainers stopped.');
  };
}
