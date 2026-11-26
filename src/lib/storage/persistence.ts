import { z } from 'zod';
import type { PinnedLocation, RecentFile, RecentLocation, StorageOperation } from './types.js';

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

export const PersistedTabsStateSchema = z.object({
  tabs: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      bucket: z.string(),
      prefix: z.string(),
      connection: z.string().optional()
    })
  ),
  activeTabId: z.string(),
  /** Fingerprint of the connection that saved these tabs. */
  connectionId: z.string().nullable().optional()
});

export type PersistedTabsState = z.infer<typeof PersistedTabsStateSchema>;

export const StorageOperationSchema: z.ZodType<StorageOperation> = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(['running', 'done', 'error', 'cancelled', 'interrupted', 'unknown']),
  type: z.enum(['paste', 'move', 'rename', 'delete', 'download']),
  itemCount: z.number(),
  completedCount: z.number(),
  errorMessage: z.string().optional(),
  startedAt: z.number(),
  completedAt: z.number().optional(),
  destPath: z.string().optional(),
  sourceNames: z.array(z.string()).optional(),
  totalBytes: z.number(),
  completedBytes: z.number(),
  currentFileName: z.string().optional(),
  fileJobIds: z.array(z.string()).optional()
});
