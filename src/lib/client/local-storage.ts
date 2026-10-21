import { browser } from '$app/environment';
import type { z } from 'zod';

/**
 * Load an array from localStorage, dropping entries that do not match `schema`.
 * Returns an empty array if the stored value is missing, corrupt, or not an array.
 */
export function loadFromStorage<T>(key: string, schema: z.ZodType<T>): T[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const result = schema.safeParse(entry);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

export function persistToStorage(key: string, data: unknown[]): void {
  if (!browser) return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Best effort: quota exceeded or storage unavailable.
  }
}
