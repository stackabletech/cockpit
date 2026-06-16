import fsPromises from 'node:fs/promises';
import path from 'path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { createGarageBucketCredentials } from './garage.js';

const stateFile = path.resolve('.playwright/postgres-state.json');

let pgContainer: StartedPostgreSqlContainer;
let garageContainer: StartedTestContainer;

export default async function globalSetup() {
  process.loadEnvFile(path.join(import.meta.dirname, '../..', '.env.test'));

  // Start PostgreSQL testcontainer — must run in globalSetup (main process) so
  // that DATABASE_* env vars are inherited by the webServer subprocess.
  const pgStart = Date.now();
  console.log('Starting PostgreSQL testcontainer...');
  const pgContainerBuilder = new PostgreSqlContainer('postgres:18.4-alpine3.23').withStartupTimeout(
    120_000
  );
  if (process.env.DOCKER_NETWORK) {
    pgContainerBuilder.withNetworkMode(process.env.DOCKER_NETWORK);
  }
  pgContainer = await pgContainerBuilder.start();
  console.log(`PostgreSQL started in ${Date.now() - pgStart}ms`);

  process.env.DATABASE_HOST = pgContainer.getHost();
  process.env.DATABASE_PORT = pgContainer.getPort().toString();
  process.env.DATABASE_NAME = pgContainer.getDatabase();
  process.env.DATABASE_USER = pgContainer.getUsername();
  process.env.DATABASE_PASSWORD = pgContainer.getPassword();

  // Start Garage S3 testcontainer using the same image and config as CI.
  // The entrypoint is the bare /garage binary (no shell in this image), started
  // in single-node mode with the dev config bind-mounted into the container.
  const garageStart = Date.now();
  console.log('Starting Garage S3 testcontainer...');
  const garageContainerBuilder = new GenericContainer(
    'oci.stackable.tech/stackable/dxflrs/garage:v2.3.0'
  )
    .withEntrypoint(['/garage'])
    .withCommand(['server', '--single-node'])
    .withEnvironment({ GARAGE_CONFIG_FILE: '/etc/garage/garage.toml' })
    .withBindMounts([
      {
        source: path.resolve('dev/garage/garage.toml'),
        target: '/etc/garage/garage.toml',
        mode: 'ro'
      }
    ])
    .withExposedPorts(3900, 3902)
    .withStartupTimeout(120_000)
    .withWaitStrategy(Wait.forHttp('/', 3900).forStatusCode(200));
  if (process.env.DOCKER_NETWORK) {
    garageContainerBuilder.withNetworkMode(process.env.DOCKER_NETWORK);
  }
  garageContainer = await garageContainerBuilder.start();
  console.log(`Garage S3 started in ${Date.now() - garageStart}ms`);

  const garageHost = garageContainer.getHost();
  const garageS3Endpoint = `http://${garageHost}:${garageContainer.getMappedPort(3900)}`;
  const garageAdminUrl = `http://${garageHost}:${garageContainer.getMappedPort(3902)}`;
  // Admin token is defined in dev/garage/garage.toml.
  const garageAdminToken = 'stackable-cockpit-e2e-admin-token';

  process.env.GARAGE_ADMIN_URL = garageAdminUrl;
  process.env.GARAGE_ADMIN_TOKEN = garageAdminToken;

  // Create the test bucket and access key via the Garage admin API.
  const bucketStart = Date.now();
  console.log('Creating Garage test bucket and credentials...');
  const credentials = await createGarageBucketCredentials(
    {
      endpoint: garageS3Endpoint,
      region: 'garage',
      accessKeyId: '',
      secretAccessKey: '',
      bucket: 'test-bucket'
    },
    {
      bucketName: 'test-bucket',
      keyName: 'e2e-test-app',
      permissions: { owner: true, read: true, write: true }
    }
  );
  console.log(`Garage setup complete in ${Date.now() - bucketStart}ms`);

  process.env.S3_TEST_ENDPOINT = garageS3Endpoint;
  process.env.S3_TEST_REGION = 'garage';
  process.env.S3_TEST_ACCESS_KEY_ID = credentials.accessKeyId;
  process.env.S3_TEST_SECRET_ACCESS_KEY = credentials.secretAccessKey;
  process.env.S3_TEST_BUCKET = 'test-bucket';

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
