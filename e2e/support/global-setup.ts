import fs from 'node:fs';
import path from 'path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

let pgContainer: StartedPostgreSqlContainer | undefined;

export default async function globalSetup() {
  process.loadEnvFile(path.join(import.meta.dirname, '../..', '.env.test'));

  // Optionally load S3 credentials written by the Garage setup step in CI.
  // When present, storage S3 tests run; when absent, they are skipped.
  // The admin URL/token from s3-config.json override .env.test values so that
  // the permissions tests connect to the correct Garage admin port in CI.
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
    if (cfg.garageAdminUrl) {
      process.env.GARAGE_ADMIN_URL = cfg.garageAdminUrl;
    }
    if (cfg.garageAdminToken) {
      process.env.GARAGE_ADMIN_TOKEN = cfg.garageAdminToken;
    }
  }

  // Start a PostgreSQL testcontainer and run database migrations so that
  // database E2E tests always have a clean, migrated schema available.
  pgContainer = await new PostgreSqlContainer('postgres:18.4-alpine3.23').start();

  process.env.DATABASE_HOST = pgContainer.getHost();
  process.env.DATABASE_PORT = pgContainer.getPort().toString();
  process.env.DATABASE_NAME = pgContainer.getDatabase();
  process.env.DATABASE_USER = pgContainer.getUsername();
  process.env.DATABASE_PASSWORD = pgContainer.getPassword();

  const db = drizzle(pgContainer.getConnectionUri());
  await migrate(db, {
    migrationsFolder: path.join(import.meta.dirname, '../..', 'src/lib/server/migrations')
  });

  return async () => {
    await pgContainer?.stop();
  };
}
