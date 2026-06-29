import type { LayoutServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { storageBrowserEnabled } from '$lib/server/feature-flags.js';
import { db } from '$lib/server/db.js';
import { userStorageConnections } from '$lib/server/schema.js';
import { decrypt } from '$lib/server/storage/encryption.js';
import { storageEncryptionKey } from '$lib/server/storage/encryption-key.js';
import type { ConnectionListItem } from '$lib/storage/connection-store.svelte.js';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!storageBrowserEnabled) {
    throw error(404, 'Not found');
  }

  locals.logger.debug('loading storage layout');

  const userId = locals.user?.id;
  if (!userId) {
    return { connected: false, buckets: [] as string[], connectionType: null, connections: [] };
  }

  const rows = await db
    .select()
    .from(userStorageConnections)
    .where(eq(userStorageConnections.userId, userId))
    .orderBy(desc(userStorageConnections.updatedAt));

  const connections: ConnectionListItem[] = rows.map((row) => {
    let endpoint: string | null = null;
    try {
      const payload = JSON.parse(decrypt(row.encryptedPayload, storageEncryptionKey())) as {
        endpoint?: string;
      };
      endpoint = payload.endpoint ?? null;
    } catch {
      // Return entry without endpoint if decryption fails.
    }
    return {
      id: row.id,
      name: row.name,
      endpoint,
      additionalBuckets: (row.additionalBuckets as string[]) ?? [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  });

  return {
    connected: false,
    buckets: [] as string[],
    connectionType: null,
    connections,
    activeConnectionId: locals.session?.activeStorageConnectionId ?? null
  };
};
