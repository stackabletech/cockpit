import type { z } from 'zod';
import type { StorageConnectionSchema } from './schemas.js';

type StoredConnection = z.infer<typeof StorageConnectionSchema>;

const STORAGE_KEY = 'stackable_storage_connections';
const LEGACY_KEY = 'stackable_storage_connection';

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
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as StoredConnection;
      localStorage.removeItem(LEGACY_KEY);
      const connections = [parsed];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
      return connections;
    }
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
