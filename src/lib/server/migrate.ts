import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './db.js';
import { logger } from './logging/index.js';

const log = logger.child({ module: 'migrations' });

export async function runMigrations() {
  try {
    log.info('Running database migrations...');
    await migrate(db, { migrationsFolder: './src/lib/server/migrations' });
    log.info('Database migrations completed successfully');
    return true;
  } catch (error) {
    log.error({ error }, 'Database migrations failed');
    return false;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error('Migration error:', error);
      process.exit(1);
    });
}
