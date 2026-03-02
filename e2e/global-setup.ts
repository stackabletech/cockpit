import path from 'path';
import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { startMockOidc } from './mock-oidc-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function globalSetup() {
  await startMockOidc();

  // Ensure the .data directory exists for the SQLite database
  mkdirSync(path.join(__dirname, '..', '.data'), { recursive: true });

  // Run database migration with test env vars
  execSync('npx @better-auth/cli@latest migrate --yes', {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      STACKABLE_UI_SQLITE_PATH: '.data/test-auth.db'
    },
    stdio: 'inherit'
  });
}
