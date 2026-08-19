import type { Component } from 'svelte';

// ── Modal types ─────────────────────────────────────────────────────────────

export type ModalType =
  | 'delete'
  | 'preview'
  | 'upload'
  | 'details'
  | 'rename'
  | 'confirm-move'
  | 'resolve-conflicts'
  | 'create';

export interface ModalPayloads {
  delete: { keys: string[] };
  preview: {
    key: string;
    archiveKey?: string;
    archivePath?: string;
    nestedArchivePath?: string;
  };
  upload: { bucket: string; prefix: string };
  details: {
    type: 'file' | 'directory' | 'bucket';
    bucket: string;
    key?: string;
    prefix?: string;
  };
  rename: { key: string };
  'confirm-move': {
    keys: string[];
    destPrefix: string;
    /** Per-item metadata for display in the confirmation dialog. */
    items: Array<{ key: string; name: string; isDirectory: boolean; size?: number }>;
  };
  'resolve-conflicts': {
    /** Conflict entries to resolve. */
    entries: Array<{
      id: string;
      originalName: string;
      conflict: boolean;
      resolution: 'replace' | 'skip' | 'rename' | null;
      customName: string;
      renameState: 'idle' | 'editing' | 'checking' | 'ok' | 'conflict';
    }>;
    bucket: string;
    /** Destination prefix for rename-conflict checking. */
    destPrefix: string;
    /** Optional: label for the confirm button (e.g. "Paste" or "Move"). */
    confirmLabel?: string;
  };
  create: { type: 'file' | 'folder' };
}

export type ActiveModal = {
  [K in ModalType]: { type: K; payload: ModalPayloads[K] };
}[ModalType];

// ── Context menu ─────────────────────────────────────────────────────────────

export interface ContextMenuAction {
  key: string;
  icon: Component;
  label: string;
  disabled?: boolean;
  hidden?: boolean;
  class?: string;
}

export interface ContextMenuState {
  x: number;
  y: number;
  /** The item key that was right-clicked, or undefined for empty-space context menu. */
  key?: string;
}

// ── Navigation ───────────────────────────────────────────────────────────────

export type NavigateFn = (
  prefix: string,
  continuationToken?: string | null,
  pageSize?: number | null
) => void;

// ── Action names ─────────────────────────────────────────────────────────────

export type ActionName =
  | 'download'
  | 'upload'
  | 'preview'
  | 'delete'
  | 'pin'
  | 'unpin'
  | 'copy-filename'
  | 'copy-path'
  | 'details'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'rename'
  | 'create-file'
  | 'create-folder';

// ── Clipboard state (cut / copy) ────────────────────────────────────────────

/** Tracks items stored in the virtual clipboard for cut/copy + paste operations. */
export interface ClipboardData {
  /** 'cut' items are rendered shaded; 'copy' items are not. */
  action: 'cut' | 'copy';
  /** S3 keys of the items in the clipboard. */
  keys: string[];
  /** Bucket the items belong to. */
  sourceBucket: string;
  /** Prefix where the items were cut from (used to invalidate source tabs). */
  sourcePrefix: string;
  /** File sizes keyed by S3 key (for recent files tracking). */
  fileSizes: Record<string, number>;
}

// ── Operations (paste / move / rename progress tracking) ─────────────────────

export type OperationStatus = 'running' | 'done' | 'error' | 'cancelled' | 'interrupted';

export type OperationType = 'paste' | 'move' | 'rename' | 'delete' | 'download';

export interface StorageOperation {
  id: string;
  label: string;
  status: OperationStatus;
  type: OperationType;
  itemCount: number;
  completedCount: number;
  errorMessage?: string;
  startedAt: number;
  completedAt?: number;
  /** Destination bucket/path for paste, move, and rename operations. */
  destPath?: string;
  /** Source file names being processed (shown while running). */
  sourceNames?: string[];
  /** Total bytes across all items in this operation. */
  totalBytes: number;
  /** Bytes transferred so far (sum of completed items). */
  completedBytes: number;
  /** Name of the file currently being transferred (single-item copy/move/paste). */
  currentFileName?: string;
  /** Names of files currently being transferred in parallel (downloads). */
  activeFiles?: string[];
  /** Progress phase for archive downloads: download or compression. */
  phase?: 'downloading' | 'compressing';
  /** Server-side job IDs per file for recovering results after reload. */
  fileJobIds?: string[];
  /** Epoch milliseconds when a completed download artefact expires. */
  cacheExpiresAt?: number;
}

// ── Storage locations ────────────────────────────────────────────────────────

export interface StorageLocation {
  bucket: string;
  prefix: string;
}

export interface PinnedLocation extends StorageLocation {
  connectionId: string;
}

// ── Recent items ─────────────────────────────────────────────────────────────

export interface RecentFile {
  key: string;
  bucket: string;
  size: number;
  visitedAt: string;
  connectionId: string;
}

export interface RecentLocation {
  bucket: string;
  prefix: string;
  visitedAt: string;
  connectionId: string;
}

// ── Storage objects ──────────────────────────────────────────────────────────

/** A single object (file or directory) returned from a storage listing. */
export interface StorageObject {
  key: string;
  size: number;
  lastModified: Date;
  isDirectory: boolean;
  contentType: string | undefined;
}

/** Full metadata for a single object. */
export interface StorageMetadata {
  size: number;
  lastModified: Date;
  contentType: string | undefined;
  etag: string | undefined;
  customMetadata: Record<string, string> | undefined;
  versionId?: string | undefined;
  storageClass?: string | undefined;
  isDeleteMarker?: boolean;
}

/** A page of listed objects from a storage provider. */
export interface StoragePage {
  objects: StorageObject[];
  hasNextPage: boolean;
  currentPage: number;
  pageSize: number;
  /** Continuation token for the current page (if provided). */
  continuationToken?: string | null;
  /** Token to request the next page from the provider (if any). */
  nextContinuationToken?: string | null;
}

/** Result of a bulk-delete operation. `failed` lists keys that could not be deleted. */
export interface DeleteObjectsResult {
  failed: Array<{ key: string; code?: string; message?: string }>;
}

// ── Archive navigation ───────────────────────────────────────────────────────

export const ARCHIVE_EXTENSIONS = ['.zip', '.tar.gz', '.tgz', '.tar', '.rar', '.7z'] as const;

export type ArchiveFormat = (typeof ARCHIVE_EXTENSIONS)[number] extends `${string}${infer F}`
  ? F
  : string;

/** A single entry inside an archive (file or directory). */
export interface ArchiveEntry {
  key: string;
  size: number;
  lastModified: Date;
  isDirectory: boolean;
}

/** Response from the archive listing API. */
export interface ArchiveListingResponse {
  entries: ArchiveEntry[];
  hasMore: boolean;
  /** When true, the archive was too large to open for preview. */
  tooLarge?: boolean;
}

/** State when browsing inside an archive. */
export interface ArchiveContext {
  /** S3 key of the archive file being browsed. */
  archiveKey: string;
  /** Virtual path within the archive (empty string = archive root). */
  archivePrefix: string;
  /** The S3 prefix the user was at before entering the archive. */
  previousS3Prefix: string;
}
