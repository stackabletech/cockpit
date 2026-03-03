import path from 'path';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseEnvFile(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, 'utf-8');
  const vars: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    vars[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
  }
  return vars;
}

export default async function globalSetup() {
  const testEnv = parseEnvFile(path.join(__dirname, '..', '.env.test'));

  // Run database migration with all test env vars so the OIDC plugin tables are created
  execSync('npx @better-auth/cli@latest migrate --yes', {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      ...testEnv
    },
    stdio: 'inherit'
  });
}
