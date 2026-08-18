import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  index,
  unique,
  boolean,
  integer
} from 'drizzle-orm/pg-core';

/**
 * User storage connections table.
 * Stores encrypted credentials and configuration for S3-compatible storage buckets.
 * Multiple connections can be stored per user.
 */
export const userStorageConnections = pgTable(
  'user_storage_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    // Display name for this connection (e.g., "Primary S3", "Backup Storage")
    name: text('name').notNull(),
    // Encrypted payload containing connection details and hash
    encryptedPayload: text('encrypted_payload').notNull(),
    hash: text('hash').notNull(),
    // Array of additional bucket names accessible with these credentials
    additionalBuckets: jsonb('additional_buckets').notNull().default('[]'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull()
  },
  (table) => [
    index('user_id_idx').on(table.userId),
    unique('user_storage_connections_user_id_name_unique').on(table.userId, table.name)
  ]
);

/**
 * Recent storage searches table.
 * Stores the most recently executed storage searches per user and connection.
 * A single row represents one logical search — the query and advanced options
 * plus the ordered list of buckets it ran against. Buckets are kept sorted so
 * the unique key below is order-independent. Postgres treats NULLs as distinct
 * in unique constraints by default, so identical searches with a NULL
 * `max_depth` ("no limit") would not conflict; the migration recreates this
 * constraint with `NULLS NOT DISTINCT` so they always resolve to a single row.
 * The modifier is not modelled in the Drizzle schema.
 */
export const userRecentSearches = pgTable(
  'user_recent_searches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => userStorageConnections.id, { onDelete: 'cascade' }),
    buckets: jsonb('buckets').$type<string[]>().notNull().default([]),
    query: text('query').notNull(),
    useRegex: boolean('use_regex').notNull().default(false),
    excludePatterns: text('exclude_patterns').array().notNull().default([]),
    searchPath: text('search_path').notNull().default(''),
    maxDepth: integer('max_depth'),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull()
  },
  (table) => [
    unique('user_recent_searches_connection_query').on(
      table.userId,
      table.connectionId,
      table.query,
      table.useRegex,
      table.excludePatterns,
      table.searchPath,
      table.maxDepth,
      table.buckets
    ),
    index('user_recent_searches_connection_idx').on(table.userId, table.connectionId)
  ]
);
