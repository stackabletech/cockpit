import type { z } from 'zod';
import type { StorageConnectionSchema } from './schemas.js';

export type StoredConnection = z.infer<typeof StorageConnectionSchema>;

/**
 * HTTP header name used to pass the S3 connection config from the browser to
 * the backend API endpoints. Defined here (client-safe module) so both client
 * and server code can import it without leaking server-only code to the browser.
 */
export const STORAGE_CONNECTION_HEADER = 'x-storage-connection';

const STORAGE_KEY = 'stackable_storage_connections';

/** Unique key for deduplicating connections by type, endpoint, and access key. */
function connectionKey(c: StoredConnection): string {
  return `${c.type}|${c.endpoint ?? ''}|${c.accessKeyId ?? ''}`;
}

/**
 * Load all stored connections, migrating from the legacy single-connection
 * format if present. Returns connections oldest-first (most recent is last).
 */
function getConnections(): StoredConnection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredConnection[];
  } catch {
    return [];
  }
}

/**
 * Save a connection. If a connection with the same type, endpoint, and access
 * key already exists it is replaced and moved to the end (most recently used).
 */
export function saveConnectionLocally(data: StoredConnection): void {
  try {
    const all = getConnections();
    const key = connectionKey(data);
    const filtered = all.filter((c) => connectionKey(c) !== key);
    filtered.push(data);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // localStorage may be unavailable (e.g. private browsing quota exceeded)
  }
}

/** Return the most recently used connection (last in the list), or null. */
export function loadConnectionLocally(): StoredConnection | null {
  const all = getConnections();
  return all.length > 0 ? all[all.length - 1] : null;
}

/** Return all stored connections in stored order (oldest first). */
export function loadAllConnectionsLocally(): StoredConnection[] {
  return getConnections();
}

/** Remove a specific connection from storage without clearing others. */
export function removeConnectionLocally(data: StoredConnection): void {
  try {
    const all = getConnections();
    const key = connectionKey(data);
    const filtered = all.filter((c) => connectionKey(c) !== key);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // localStorage may be unavailable
  }
}

/**
 * Encode a connection config as a base64 JSON string suitable for the
 * `X-Storage-Connection` request header sent to the backend.
 */
export function getConnectionHeader(connection: StoredConnection): string {
  return btoa(JSON.stringify(connection));
}
