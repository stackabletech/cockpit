# Drizzle ORM Database Setup Guide

This project uses **Drizzle ORM** with PostgreSQL 18 for database management.

## Environment Variables

The following environment variables are required for database connection:

```env
DATABASE_HOST=localhost          # PostgreSQL host
DATABASE_PORT=31432              # PostgreSQL port (default: 31432)
DATABASE_NAME=cockpit            # Database name
DATABASE_USER=cockpit            # Database user
DATABASE_PASSWORD=cockpit-dev-password  # Database password
DATABASE_TLS_MODE=disable        # Optional: verify-full, require or disable (see below)
DATABASE_TLS_CA_CERT=/path/ca.crt  # Optional: CA certificate for verify-full
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

The current migration history is a single baseline migration. Existing databases
created with the prior migration sequence must be reset before applying it.

## NPM Scripts

All Drizzle commands load `.env.development` by default through Node.js `process.loadEnvFile` in `drizzle.config.ts`. The database connection variables are required; commands fail rather than falling back to another database.

```bash
npm run db:generate        # Generate new migrations from schema changes
npm run db:migrate         # Run pending migrations (via drizzle-kit)
npm run db:migrate:run     # Run pending migrations (via Node script, used by setup.sh)
npm run db:studio          # Open Drizzle Studio (web-based DB preview/management)
```

**Override env file**: Use `DRIZZLE_ENV_FILE` to select a different environment file:

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

`DATABASE_TLS_MODE` selects how the connection is secured:

| Mode          | Behaviour                                                                            |
| ------------- | ------------------------------------------------------------------------------------ |
| `verify-full` | TLS with certificate and host name verification. Default in production.              |
| `require`     | TLS without certificate verification. Encrypts, but doesn't authenticate the server. |
| `disable`     | No TLS. Default when `NODE_ENV` isn't `production`.                                  |

With `verify-full`, the certificate must chain to `DATABASE_TLS_CA_CERT` if it is set, otherwise to the CA certificates bundled with Node.js (the public Mozilla CAs, not the operating system's trust store). Set `DATABASE_TLS_CA_CERT` for any private CA, such as the one that signs AWS RDS certificates. It replaces the bundled CAs and is only accepted with `verify-full`; any other mode fails at startup.

The same settings apply to the application runtime (`src/lib/server/db.ts`) and to `drizzle.config.ts` (migrations and Drizzle Studio).

Only use `require` or `disable` in production when the network path to the database is otherwise protected. The application logs a warning when certificate verification is off in production.
