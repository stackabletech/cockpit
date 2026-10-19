import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export async function startPostgres(): Promise<StartedPostgreSqlContainer> {
  const pgStart = Date.now();
  console.log('Starting PostgreSQL testcontainer...');
  const pgContainerBuilder = new PostgreSqlContainer(
    'oci.stackable.tech/stackable/library/postgres:18.4-alpine3.24'
  ).withStartupTimeout(120_000);
  if (process.env.DOCKER_NETWORK) {
    pgContainerBuilder.withNetworkMode(process.env.DOCKER_NETWORK);
  }
  const pgContainer = await pgContainerBuilder.start();
  console.log(`PostgreSQL started in ${Date.now() - pgStart}ms`);

  process.env.DATABASE_HOST = pgContainer.getHost();
  process.env.DATABASE_PORT = pgContainer.getPort().toString();
  process.env.DATABASE_NAME = pgContainer.getDatabase();
  process.env.DATABASE_USER = pgContainer.getUsername();
  process.env.DATABASE_PASSWORD = pgContainer.getPassword();

  return pgContainer;
}
