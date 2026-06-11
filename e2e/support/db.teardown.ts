import { test as teardown } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'path';

const stateFile = path.resolve('.playwright/postgres-state.json');

teardown('stop postgres container', async () => {
  try {
    const raw = await fs.readFile(stateFile, 'utf-8');
    const { containerId } = JSON.parse(raw) as { containerId: string };

    execSync(`docker stop ${containerId} && docker rm ${containerId}`, { stdio: 'ignore' });

    await fs.rm(stateFile, { force: true });
  } catch {
    // Ignore missing state file or already-stopped container.
  }
});
