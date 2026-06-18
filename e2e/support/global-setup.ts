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

  // Start testcontainers — must run in globalSetup (main process) so
  // that env vars are inherited by the webServer subprocess.
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
