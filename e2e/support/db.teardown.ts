import { test as teardown } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'path';

const stateFile = path.resolve('.playwright/postgres-state.json');

teardown('stop test containers', async () => {
  try {
    const raw = await fs.readFile(stateFile, 'utf-8');
    const { pgContainerId, garageContainerId } = JSON.parse(raw) as {
      pgContainerId: string;
      garageContainerId: string;
    };

    for (const id of [pgContainerId, garageContainerId]) {
      if (id) {
        execSync(`docker stop ${id} && docker rm ${id}`, { stdio: 'ignore' });
      }
    }

    await fs.rm(stateFile, { force: true });
  } catch {
    // Ignore missing state file or already-stopped containers.
  }
});
