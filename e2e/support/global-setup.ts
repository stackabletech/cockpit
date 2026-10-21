import fs from 'node:fs/promises';
import path from 'node:path';

export default async function globalSetup() {
  process.loadEnvFile(path.join(import.meta.dirname, '../..', '.env.test'));

  // Playwright starts webServer before globalSetup. The app launcher creates
  // the containers first and publishes their environment for the test workers.
  const raw = await fs.readFile(path.resolve('.playwright/test-env.json'), 'utf-8');
  const env = JSON.parse(raw) as Record<string, string>;
  Object.assign(process.env, env);
}
