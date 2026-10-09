export type Resolution = 'replace' | 'skip' | 'rename';

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
}
