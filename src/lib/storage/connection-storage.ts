import type { z } from 'zod';
import type { StorageConnectionSchema } from './schemas.js';

/** Raw form data — `id` may be absent when creating a new connection. */
export type StoredConnection = z.infer<typeof StorageConnectionSchema>;

/**
 * A connection that has been persisted to localStorage and always has an `id`.
 * All load/update/remove functions work with this type.
 */
export type SavedConnection = StoredConnection & { id: string };

/**
 * HTTP header name used to pass the S3 connection config from the browser to
 * the backend API endpoints. Defined here (client-safe module) so both client
 * and server code can import it without leaking server-only code to the browser.
 */
export const STORAGE_CONNECTION_HEADER = 'x-storage-connection';

const STORAGE_KEY = 'stackable_storage_connections';

/**
 * Load all stored connections. Connections without an `id` field (created
 * before the UUID-identity migration) are silently dropped.
 * Returns connections oldest-first (most recent is last).
 */
function getConnections(): SavedConnection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    return parsed.filter(
      (c): c is SavedConnection => typeof c === 'object' && c !== null && 'id' in c
    );
  } catch {
    return [];
  }
}

/**
 * Save a new connection. Generates a UUID `id` if one is not already set.
 * Connections are stored oldest-first; the new connection is appended (most recently used).
 */
export function saveConnectionLocally(data: StoredConnection): void {
  try {
    const connection: SavedConnection = {
      ...data,
      id: data.id ?? crypto.randomUUID()
    };
    const all = getConnections();
    const filtered = all.filter((c) => c.id !== connection.id);
    filtered.push(connection);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // localStorage may be unavailable (e.g. private browsing quota exceeded)
  }
}

/**
 * Update an existing connection in-place by its `id`, preserving its position
 * in the list. If no connection with that `id` exists, this is a no-op.
 */
export function updateConnectionLocally(id: string, data: Partial<StoredConnection>): void {
  try {
    const all = getConnections();
    const idx = all.findIndex((c) => c.id === id);
    if (idx === -1) return;
    all[idx] = { ...all[idx], ...data, id };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // localStorage may be unavailable
  }
}

/** Return the most recently used connection (last in the list), or null. */
export function loadConnectionLocally(): SavedConnection | null {
  const all = getConnections();
  return all.length > 0 ? all[all.length - 1] : null;
}

/** Return all stored connections in stored order (oldest first). */
export function loadAllConnectionsLocally(): SavedConnection[] {
  return getConnections();
}

/** Remove a specific connection from storage by its `id`. */
export function removeConnectionLocally(data: SavedConnection): void {
  try {
    const all = getConnections();
    const filtered = all.filter((c) => c.id !== data.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // localStorage may be unavailable
  }
}

/** Remove a connection from storage by its `id` string. */
export function removeConnectionById(id: string): void {
  try {
    const all = getConnections();
    const filtered = all.filter((c) => c.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // localStorage may be unavailable
  }
}

/** Return a single connection by its `id`, or null if not found. */
export function loadConnectionById(id: string): SavedConnection | null {
  return getConnections().find((c) => c.id === id) ?? null;
}

/**
 * Encode a connection config as a base64 JSON string suitable for the
 * `X-Storage-Connection` request header sent to the backend.
 */
export function getConnectionHeader(connection: StoredConnection): string {
  return btoa(JSON.stringify(connection));
}
