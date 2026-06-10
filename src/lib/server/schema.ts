import { pgTable, text, timestamp, uuid, jsonb, index } from 'drizzle-orm/pg-core';

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
  (table) => [index('user_id_idx').on(table.userId)]
);
