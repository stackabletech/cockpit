import * as m from '$lib/paraglide/messages.js';
import {
  ConflictRenameNameSchema,
  StorageObjectKeySchema,
  StorageObjectNameSchema,
  hasEmptyPathSegment
} from '$lib/storage/schemas.js';

interface ObjectNameOptions {
  /** The existing folder the name is created or renamed in; empty for the bucket root. */
  prefix: string;
  /** Whether the result is a folder, so the key gets a trailing `/`. */
  folder: boolean;
  /** A rename keeps the item in its folder, so its name is a single path segment. */
  singleSegment?: boolean;
}

/**
 * Explains why a name the user typed cannot be created or renamed to, or returns null when it is
 * valid. The typed name is checked with the strict name policy; the folder it lands in may hold any
 * key S3 accepts, so the full key is only checked against S3's own limits.
 */
export function objectNameError(name: string, options: ObjectNameOptions): string | null {
  const trimmed = name.trim();
  if (!trimmed) return m.storage_name_required();

  // A rename refuses any `/`, which its own message already explains.
  if (!options.singleSegment && hasEmptyPathSegment(trimmed)) return m.storage_name_empty_segment();

  const nameSchema = options.singleSegment ? ConflictRenameNameSchema : StorageObjectNameSchema;
  if (!nameSchema.safeParse(trimmed).success) {
    return options.singleSegment
      ? m.storage_conflict_rename_invalid_name()
      : m.storage_create_invalid_name();
  }

  const key = options.prefix + trimmed + (options.folder ? '/' : '');
  if (!StorageObjectKeySchema.safeParse(key).success) return m.storage_name_too_long();

  return null;
}
