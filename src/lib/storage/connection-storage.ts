import type { z } from 'zod';
import type { StorageConnectionSchema } from './schemas.js';

type StoredConnection = z.infer<typeof StorageConnectionSchema>;

const STORAGE_KEY = 'stackable_storage_connection';

export function saveConnectionLocally(data: StoredConnection): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage may be unavailable (e.g. private browsing quota exceeded)
  }
}

export function loadConnectionLocally(): StoredConnection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredConnection;
  } catch {
    return null;
  }
}

export function clearConnectionLocally(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage may be unavailable
  }
}
