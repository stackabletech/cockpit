/**
 * Shared types for the upload modal sub-components.
 * Resolution and RenameState are re-exported from the shared conflict types.
 */

import type { Resolution, RenameState } from '../shared/conflict-types.js';

export type { Resolution, RenameState };

export type FileEntry = {
  id: string;
  file: File;
  /** Relative display path (without bucket prefix). */
  displayPath: string;
  /** Full object key in the bucket. */
  targetKey: string;
  conflict: boolean;
  resolution: Resolution | null;
  /** Editable filename when the user chooses to rename. */
  customName: string;
  renameState: RenameState;
  status: 'pending' | 'uploading' | 'done' | 'error' | 'skipped';
  progress: number;
  errorMessage?: string;
};

export type Phase = 'idle' | 'selected' | 'checking' | 'review' | 'uploading' | 'complete';
