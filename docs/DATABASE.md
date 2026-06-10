# Drizzle ORM Database Setup Guide

This project uses **Drizzle ORM** with PostgreSQL 18 for database management.

## Environment Variables

The following environment variables are required for database connection:

```env
DATABASE_HOST=localhost          # PostgreSQL host
DATABASE_PORT=31432              # PostgreSQL port (default: 5432)
DATABASE_NAME=cockpit            # Database name
DATABASE_USER=cockpit            # Database user
DATABASE_PASSWORD=cockpit-dev-password  # Database password
```

These are automatically set in `.env.development` by `./dev/setup.sh`.

## Database Setup

### 1. Automatic Setup (Recommended)

Run the setup script to deploy PostgreSQL and automatically run migrations:

```bash
./dev/setup.sh              # Deploy Keycloak, Trino, Garage, PostgreSQL + migrations
./dev/setup.sh --skip-trino  # Skip Trino if not needed
./dev/setup.sh --skip-postgresql  # Skip PostgreSQL if already running
```

The script will:

1. Deploy PostgreSQL to the Kubernetes cluster
2. Wait for it to be ready
3. Automatically run all pending migrations

### 2. Manual Setup

If you have PostgreSQL running elsewhere, just set the environment variables in `.env.development`.

## Schema Management

### Define Tables

Edit [src/lib/server/schema.ts](../src/lib/server/schema.ts) to define your database schema:

```typescript
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull()
});
```

### Generate & Run Migrations

```bash
# Generate migration files from schema
npm run db:generate

# Run migrations against the database (manual)
npm run db:migrate

# Or run via Node script (same as setup.sh uses)
npm run db:migrate:run
```

**Automatic Migrations**: When you run `./dev/setup.sh`, migrations are automatically applied after PostgreSQL is deployed. You don't need to run them manually in that case.

Migrations are stored in `src/lib/server/migrations/`.

## NPM Scripts

All Drizzle commands automatically load `.env.development` via `dotenv` in `drizzle.config.ts`.

```bash
npm run db:generate        # Generate new migrations from schema changes
npm run db:migrate         # Run pending migrations (via drizzle-kit)
npm run db:migrate:run     # Run pending migrations (via Node script, used by setup.sh)
npm run db:studio          # Open Drizzle Studio (web-based DB preview/management)
```

**Override env file**: Use `DRIZZLE_ENV_FILE` to use a different environment file:

```bash
DRIZZLE_ENV_FILE=.env.production npm run db:generate
```

**Drizzle Studio**: Open a visual editor and preview of your database:

```bash
npm run db:studio
# Opens http://local.drizzle.studio in your browser
# Shows schema, tables, relationships, and allows data browsing
```

## Database Preview & Management

Perfect for inspecting your database during development without leaving your editor.

## Using the Database

### In Server-Side Code

```typescript
// In +page.server.ts or +server.ts
import { db } from '$lib/server/db';

export const load: PageServerLoad = async ({ locals }) => {
  const log = locals.logger;

  try {
    // Query example
    const users = await db.query.users.findMany();
    log.info({ count: users.length }, 'Loaded users');
    return { users };
  } catch (error) {
    log.error({ error }, 'Database query failed');
    throw error;
  }
};
```

### Connection Testing

The database connection is tested automatically when the server starts. Check the logs for connection status:

```bash
npm run dev   # Check terminal output for "Database connection successful"
```

## Documentation

- [Drizzle ORM Docs](https://orm.drizzle.team/docs/overview)
- [PostgreSQL Driver](https://orm.drizzle.team/docs/get-started-postgresql)
- [Query API](https://orm.drizzle.team/docs/select)

## Troubleshooting

### Connection Failed

1. Ensure PostgreSQL is running: `kubectl get pod -l app=postgresql`
2. Check environment variables: `env | grep DATABASE_`
3. Verify the database exists: `psql -h localhost -U cockpit -d cockpit`
4. Check logs: `kubectl logs -l app=postgresql`

### Schema Sync Issues

If schema changes aren't reflected:

```bash
npm run db:generate    # Regenerate migrations
npm run db:migrate     # Apply migrations
npm run dev            # Restart dev server
```

### View Database State

To inspect the current database state:

```bash
npm run db:studio      # Opens Drizzle Studio for visual inspection
```

Or use psql directly:

```bash
psql -h localhost -U cockpit -d cockpit
# Once connected:
\dt                    # List all tables
\d <table_name>        # Describe a table
SELECT * FROM <table>; # View data
```

## Security

### SSL/TLS Configuration

- **Development** (`NODE_ENV != production`): SSL is **disabled** by default for local Kubernetes
- **Production** (`NODE_ENV = production`): SSL is **always enabled** for security

This is configured automatically in both:

- `drizzle.config.ts` - for migrations and Drizzle Studio
- `src/lib/server/db.ts` - for the application runtime

**Never disable SSL in production.** Unencrypted database connections expose credentials and data to network attacks.
