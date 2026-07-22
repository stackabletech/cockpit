/**
 * Shared types for the upload modal sub-components.
 */

export type Resolution = 'replace' | 'skip' | 'rename';

/**
 * Tracks the two-stage rename confirmation flow.
 * idle      - rename not selected for this entry
 * editing   - rename selected, text field is editable
 * checking  - async conflict check in progress
 * ok        - new name confirmed available
 * conflict  - new name already exists in the bucket
 */
export type RenameState = 'idle' | 'editing' | 'checking' | 'ok' | 'conflict';

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
