import { test as setup } from '@playwright/test';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import fs from 'node:fs/promises';
import path from 'path';

const stateFile = path.resolve('.playwright/postgres-state.json');

setup('run database migrations', async () => {
  const raw = await fs.readFile(stateFile, 'utf-8');
  const { connectionUri } = JSON.parse(raw) as { connectionUri: string };

  const db = drizzle(connectionUri);
  await migrate(db, {
    migrationsFolder: path.resolve('src/lib/server/migrations')
  });
});
