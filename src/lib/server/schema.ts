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
 * Immutable user download-history metadata. Connection credentials remain solely
 * in user_storage_connections.
 */
export const storageDownloadManifests = pgTable(
  'storage_download_manifests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    bucket: text('bucket').notNull(),
    prefix: text('prefix').notNull(),
    entries: jsonb('entries').notNull(),
    format: text('format').notNull(),
    archive: text('archive'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull()
  },
  (table) => [index('storage_download_manifests_user_expiry_idx').on(table.userId, table.expiresAt)]
);
