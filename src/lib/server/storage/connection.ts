import { error } from '@sveltejs/kit';
import { StorageConnectionSchema } from '$lib/storage/schemas.js';
import { STORAGE_CONNECTION_HEADER } from '$lib/storage/connection-storage.js';
import type { S3ConnectionConfig } from './types.js';
import { logger } from '$lib/server/logging';

const log = logger.child({ module: 'storage-connection' });

/**
 * Parse and validate a base64-encoded JSON connection payload from a request header value.
 * Throws a 400 HTTP error if the payload is malformed or fails schema validation.
 * Throws a 400 HTTP error if the connection type is not 's3'.
 */
function parseConnectionPayload(raw: string): S3ConnectionConfig {
  let data: unknown;
  try {
    data = JSON.parse(atob(raw));
  } catch {
    throw error(400, 'Invalid storage connection header');
  }

  const parsed = StorageConnectionSchema.safeParse(data);
  if (!parsed.success) {
    log.debug({ issues: parsed.error.issues }, 'storage connection header validation failed');
    throw error(400, 'Invalid storage connection configuration');
  }

  if (parsed.data.type !== 's3') {
    throw error(400, 'Storage backend not supported');
  }

  return {
    type: 's3',
    endpoint: parsed.data.endpoint || undefined,
    pathStyle: parsed.data.pathStyle,
    region: parsed.data.region,
    accessKeyId: parsed.data.accessKeyId || undefined,
    secretAccessKey: parsed.data.secretAccessKey || undefined
  };
}

/**
 * Extract the storage connection config from the `X-Storage-Connection` request header.
 * Returns `null` if the header is absent. Throws 400 on malformed or invalid payloads.
 *
 * Used by the `handleStorageConnection` middleware in `hooks.server.ts` to populate
 * `event.locals.storageConfig` before any storage API handler runs.
 */
export function getConnectionFromHeader(request: Request): S3ConnectionConfig | null {
  const header = request.headers.get(STORAGE_CONNECTION_HEADER);
  if (!header) return null;
  return parseConnectionPayload(header);
}
