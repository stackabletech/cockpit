import { rm } from 'node:fs/promises';

const TEST_DB = '.data/test-auth.db';

export default async function globalTeardown() {
  await rm(TEST_DB, { force: true });
}
