import path from 'path';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { createGarageBucketCredentials, createGarageHiddenBucket } from '../garage.js';

export async function startGarage(): Promise<StartedTestContainer> {
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
    .withWaitStrategy(Wait.forHttp('/health', 3902).forStatusCode(200));
  if (process.env.DOCKER_NETWORK) {
    garageContainerBuilder.withNetworkMode(process.env.DOCKER_NETWORK);
  }
  const garageContainer = await garageContainerBuilder.start();
  console.log(`Garage S3 started in ${Date.now() - garageStart}ms`);

  await setupGarageBucket(garageContainer);

  return garageContainer;
}

async function setupGarageBucket(garageContainer: StartedTestContainer): Promise<void> {
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

  // Hidden bucket: no global alias so it does not appear in S3 ListBuckets,
  // but the test key has read and write access.
  const hiddenBucketId = await createGarageHiddenBucket(
    {
      endpoint: garageS3Endpoint,
      region: 'garage',
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      bucket: 'test-bucket'
    },
    credentials.accessKeyId
  );
  process.env.S3_TEST_HIDDEN_BUCKET_ID = hiddenBucketId;
}
