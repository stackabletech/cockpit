import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { StartedTestContainer } from 'testcontainers';
import { startPostgres } from './containers/postgres.setup.js';
import { startGarage } from './containers/garage.setup.js';

process.loadEnvFile(path.join(import.meta.dirname, '../..', '.env.test'));

const stateFile = path.resolve('.playwright/test-env.json');
const containers: StartedTestContainer[] = [];
let app: ChildProcess | undefined;
let stopping = false;

async function stop(exitCode: number) {
  if (stopping) return;
  stopping = true;
  if (app && app.exitCode === null && app.signalCode === null) {
    const exited = new Promise<void>((resolve) => app!.once('exit', () => resolve()));
    app.kill('SIGTERM');
    await exited;
  }
  console.log('Tearing down testcontainers...');
  await Promise.allSettled(containers.map((container) => container.stop()));
  await fs.rm(stateFile, { force: true });
  process.exit(exitCode);
}

async function main() {
  // Own the containers in the webServer process so both direct Playwright runs
  // and npm run test:e2e use the same startup order and automatic teardown.
  containers.push(await startPostgres());
  containers.push(await startGarage());

  const testEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        key.startsWith('DATABASE_') || key.startsWith('S3_TEST_') || key.startsWith('GARAGE_')
    )
  );
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify(testEnv), { mode: 0o600 });

  // The server's init hook runs migrations before it starts accepting requests.
  app = spawn(process.execPath, ['build/index.js'], {
    stdio: 'inherit',
    env: process.env
  });
  app.on('error', (err) => {
    console.error('Failed to start the E2E app server:', err);
    void stop(1);
  });
  app.on('exit', (code) => void stop(code ?? 1));
}

process.on('SIGTERM', () => void stop(0));
process.on('SIGINT', () => void stop(0));

main().catch((err) => {
  console.error('Failed to start the E2E environment:', err);
  void stop(1);
});
