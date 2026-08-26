import { pgTable, text, timestamp, uuid, jsonb, index, unique, integer } from 'drizzle-orm/pg-core';

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
 * Saved SQL diagram queries.
 * Stores the full serialised diagram state (nodes + edges + context) so a
 * visual query can be reloaded later. One name per user (upsert on save).
 */
export const savedDiagramQueries = pgTable(
  'saved_diagram_queries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    catalog: text('catalog').notNull(),
    schema: text('schema').notNull(),
    // Serialised { nodes, edges } diagram state
    diagram: jsonb('diagram').notNull(),
    // Assembled SQL preview at save time (informational)
    sqlPreview: text('sql_preview').notNull(),
    nodeCount: integer('node_count').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull()
  },
  (table) => [
    index('saved_diagram_queries_user_id_idx').on(table.userId),
    unique('saved_diagram_queries_user_id_name_unique').on(table.userId, table.name)
  ]
);
