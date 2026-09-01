import { pgTable, text, timestamp, uuid, jsonb, index, unique } from 'drizzle-orm/pg-core';

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
 * Stores the most recently executed storage searches per user and connection,
 * keyed by the unique combination of user, connection, bucket and query.
 */
export const userRecentSearches = pgTable(
  'user_recent_searches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => userStorageConnections.id, { onDelete: 'cascade' }),
    bucket: text('bucket').notNull(),
    query: text('query').notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull()
  },
  (table) => [
    unique('user_recent_searches_user_connection_bucket_query').on(
      table.userId,
      table.connectionId,
      table.bucket,
      table.query
    ),
    index('user_recent_searches_connection_idx').on(table.userId, table.connectionId)
  ]
);
