import { rm } from 'node:fs/promises';
import { stopMockOidc } from './mock-oidc-server.js';

const TEST_DB = '.data/test-auth.db';

export default async function globalTeardown() {
  await stopMockOidc();
  await rm(TEST_DB, { force: true });
}
