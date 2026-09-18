/* eslint-disable security/detect-non-literal-fs-filename */
import fs from 'node:fs';
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

  // Optionally load S3 credentials written by the Garage setup step in CI.
  const s3ConfigPath = path.join(import.meta.dirname, '../..', 's3-config.json');
  if (fs.existsSync(s3ConfigPath)) {
    const raw = fs.readFileSync(s3ConfigPath, 'utf-8');
    const cfg = JSON.parse(raw) as {
      awsEndpoint: string;
      awsRegion: string;
      awsAccessKeyId: string;
      awsSecretAccessKey: string;
      bucket: string;
      garageAdminUrl?: string;
      garageAdminToken?: string;
    };
    process.env.S3_TEST_ENDPOINT = cfg.awsEndpoint;
    process.env.S3_TEST_REGION = cfg.awsRegion;
    process.env.S3_TEST_ACCESS_KEY_ID = cfg.awsAccessKeyId;
    process.env.S3_TEST_SECRET_ACCESS_KEY = cfg.awsSecretAccessKey;
    process.env.S3_TEST_BUCKET = cfg.bucket;
    if (cfg.garageAdminUrl) process.env.GARAGE_ADMIN_URL = cfg.garageAdminUrl;
    if (cfg.garageAdminToken) process.env.GARAGE_ADMIN_TOKEN = cfg.garageAdminToken;
  }

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
