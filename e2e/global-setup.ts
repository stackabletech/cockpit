import path from 'path';
import { execSync } from 'child_process';

export default async function globalSetup() {
  process.loadEnvFile(path.join(import.meta.dirname, '..', '.env.test'));

  // Run database migration with all test env vars so the OIDC plugin tables are created
  execSync('npx @better-auth/cli migrate --yes', {
    cwd: path.join(import.meta.dirname, '..'),
    stdio: 'inherit'
  });
}
