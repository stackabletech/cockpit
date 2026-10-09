import { browser } from '$app/environment';
import { z } from 'zod';
import type { PinnedLocation, RecentFile, RecentLocation } from './types.js';

// ── localStorage keys ────────────────────────────────────────────────────────

export const LS_PINS = 'pinned_storage_locations';
export const LS_RECENT_FILES = 'recent_storage_files';
export const LS_RECENT_LOCATIONS = 'recent_storage_locations';

// ── Schemas ──────────────────────────────────────────────────────────────────

export const PinnedLocationSchema: z.ZodType<PinnedLocation> = z.object({
  bucket: z.string(),
  prefix: z.string(),
  connectionId: z.string()
});

export const RecentFileSchema: z.ZodType<RecentFile> = z.object({
  key: z.string(),
  bucket: z.string(),
  size: z.number(),
  visitedAt: z.string(),
  connectionId: z.string()
});

export const RecentLocationSchema: z.ZodType<RecentLocation> = z.object({
  bucket: z.string(),
  prefix: z.string(),
  visitedAt: z.string(),
  connectionId: z.string()
});

// ── Utilities ────────────────────────────────────────────────────────────────

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
