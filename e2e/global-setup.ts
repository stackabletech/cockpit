import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function globalSetup() {
  process.loadEnvFile(path.join(__dirname, '..', '.env.test'));

  // Run database migration with all test env vars so the OIDC plugin tables are created
  execSync('npx @better-auth/cli migrate --yes', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  });
}
