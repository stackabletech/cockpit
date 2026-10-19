/** `merge` and `keepBoth` are offered for transfers only. */
export type Resolution = 'replace' | 'skip' | 'rename' | 'merge' | 'keepBoth';

export type RenameState = 'idle' | 'editing' | 'checking' | 'ok' | 'conflict';

export interface ConflictEntry {
  id: string;
  originalName: string;
  conflict: boolean;
  resolution: Resolution | null;
  customName: string;
  renameState: RenameState;
  /** Source S3 key (set for paste/move operations, undefined for uploads). */
  sourceKey?: string;
  /** Transfers only: a folder offers Merge instead of Replace. */
  kind?: 'file' | 'folder';
  /** Transfers only: offer Keep both. */
  allowKeepBoth?: boolean;
  /** Transfers only: the folder a renamed item lands in, so the full key length can be checked. */
  destPrefix?: string;
}

/** An item the server refused at plan time, shown with its reason. */
export interface RefusedEntry {
  name: string;
  reason: string;
}
