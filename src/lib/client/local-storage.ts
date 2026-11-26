import { browser } from '$app/environment';
import { z } from 'zod';

// The only module that touches `localStorage` directly (enforced by ESLint). Even reading the
// global throws a SecurityError when the browser blocks site data, and an uncaught throw during
// hydration takes down the whole app. Persistence is a convenience, so every helper here fails
// silently: reads return null, writes report false.

/** Read a value; null if it is missing, on the server, or storage is unavailable. */
export function readStorage(key: string): string | null {
  if (!browser) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Write a value; false if storage is unavailable or full. */
export function writeStorage(key: string, value: string): boolean {
  if (!browser) return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(key: string): void {
  if (!browser) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing to remove.
  }
}

/**
 * Read a JSON value and validate it against `schema`. Returns null if it is missing, unparsable,
 * does not match, or storage is unavailable. Stored data may come from an older release, so it is
 * never trusted without a schema; callers fall back to their defaults instead.
 */
export function readStorageJson<T>(key: string, schema: z.ZodType<T>): T | null {
  const raw = readStorage(key);
  if (!raw) return null;
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Load an array from localStorage, dropping entries that do not match `schema`.
 * Returns an empty array if the stored value is missing, corrupt, or not an array.
 */
export function loadFromStorage<T>(key: string, schema: z.ZodType<T>): T[] {
  const parsed = readStorageJson(key, z.array(z.unknown()));
  if (!parsed) return [];
  return parsed.flatMap((entry) => {
    const result = schema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
}

export function persistToStorage(key: string, data: unknown[]): void {
  writeStorage(key, JSON.stringify(data));
}
