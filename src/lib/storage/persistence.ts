import { z } from 'zod';
import type { PinnedLocation, RecentFile, RecentLocation } from './types.js';

// ── localStorage keys ────────────────────────────────────────────────────────

export const LS_PINS = 'pinned_storage_locations';
export const LS_RECENT_FILES = 'recent_storage_files';
export const LS_RECENT_LOCATIONS = 'recent_storage_locations';
export const LS_TABS = 'storage_tabs';

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
