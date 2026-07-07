// ── Modal types ─────────────────────────────────────────────────────────────

export type ModalType = 'delete' | 'preview' | 'upload';

export interface ModalPayloads {
  delete: { keys: string[] };
  preview: { key: string };
  upload: { bucket: string; prefix: string };
}

export type ActiveModal = {
  [K in ModalType]: { type: K; payload: ModalPayloads[K] };
}[ModalType];

// ── Context menu ─────────────────────────────────────────────────────────────

export interface ContextMenuState {
  x: number;
  y: number;
  key: string;
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
  | 'copy-path';

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
